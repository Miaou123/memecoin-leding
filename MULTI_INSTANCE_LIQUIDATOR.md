# Multi-Instance Liquidator Support

## Overview

The memecoin lending protocol now supports running multiple liquidator instances for high availability and performance. This allows you to:

- **Scale horizontally**: Run multiple liquidator instances to handle high loan volumes
- **High availability**: If one instance fails, others continue processing
- **Separate concerns**: One instance serves the API while others focus on liquidations
- **Performance monitoring**: Track metrics across all instances

---

## Architecture

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Instance 1 │    │  Instance 2 │    │  Instance 3 │
│ (Full API)  │    │(Liquidator) │    │(Liquidator) │
├─────────────┤    ├─────────────┤    ├─────────────┤
│ DISABLE_API │    │ DISABLE_API │    │ DISABLE_API │
│   = false   │    │   = true    │    │   = true    │
├─────────────┤    ├─────────────┤    ├─────────────┤
│   Serves    │    │  No API     │    │  No API     │
│  REST API   │    │  endpoints  │    │  endpoints  │
│     +       │    │             │    │             │
│ Liquidator  │    │ Liquidator  │    │ Liquidator  │
│    Jobs     │    │ Jobs Only   │    │ Jobs Only   │
└─────────────┘    └─────────────┘    └─────────────┘
        │                  │                  │
        └──────────────────┴──────────────────┘
                           │
                      ┌─────────┐
                      │  Redis  │
                      │(Metrics)│
                      └─────────┘
```

---

## Configuration

### Instance 1: Full API Server
```env
# Primary instance serves API + runs liquidator
DISABLE_API=false
INSTANCE_ID=primary-api-1
```

### Instance 2+: Liquidator Only
```env
# Secondary instances only run background jobs
DISABLE_API=true
INSTANCE_ID=liquidator-worker-2
```

---

## Features

### 1. Instance Modes

**Full Server Mode** (`DISABLE_API=false`):
- Serves all REST API endpoints
- Runs background liquidation jobs
- WebSocket connections
- Health endpoints

**Liquidator-Only Mode** (`DISABLE_API=true`):
- No API endpoints (except minimal `/health`)
- Only runs background jobs
- Reduced resource usage
- Focused on liquidations

### 2. Performance Metrics

Each instance tracks:
- `lastSuccessfulRun`: Timestamp of last successful liquidation check
- `consecutiveFailures`: Count of consecutive job failures
- `totalLiquidations24h`: Liquidations in past 24 hours
- `totalChecks24h`: Total liquidation checks in past 24 hours
- `avgProcessingTimeMs`: Average job processing time

### 3. Health Monitoring

**Instance Health Checks**:
- Healthy if `consecutiveFailures < 3`
- Healthy if last successful run within 5 minutes
- Automatic alerts via security monitor

**Aggregate Health Endpoint**: `/health/liquidator`
```json
{
  "status": "healthy",
  "instanceId": "server-12345-abc",
  "lastSuccessfulRun": "2024-01-15T10:30:00Z",
  "minutesSinceLastSuccess": 2,
  "consecutiveFailures": 0,
  "totalLiquidations24h": 42,
  "allInstances": [
    {
      "instanceId": "server-12345-abc",
      "isHealthy": true,
      "lastSuccessfulRun": "2024-01-15T10:30:00Z",
      "consecutiveFailures": 0,
      "avgProcessingTimeMs": 145
    },
    {
      "instanceId": "worker-67890-def",
      "isHealthy": true,
      "lastSuccessfulRun": "2024-01-15T10:31:00Z",
      "consecutiveFailures": 0,
      "avgProcessingTimeMs": 132
    }
  ]
}
```

---

## Deployment Examples

### Docker Compose
```yaml
version: '3.8'

services:
  # Primary API server
  api-server:
    image: memecoin-lending:latest
    environment:
      - DISABLE_API=false
      - INSTANCE_ID=api-primary
    ports:
      - "3002:3002"
  
  # Liquidator worker 1
  liquidator-1:
    image: memecoin-lending:latest
    environment:
      - DISABLE_API=true
      - INSTANCE_ID=liquidator-1
  
  # Liquidator worker 2
  liquidator-2:
    image: memecoin-lending:latest
    environment:
      - DISABLE_API=true
      - INSTANCE_ID=liquidator-2
```

### Kubernetes
```yaml
# API Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lending-api
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: api
        env:
        - name: DISABLE_API
          value: "false"

---
# Liquidator Workers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: lending-liquidators
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: liquidator
        env:
        - name: DISABLE_API
          value: "true"
```

---

## Monitoring

### Alerts Configured

1. **Consecutive Failures** (≥3):
   - Severity: HIGH
   - Action: Check logs, restart instance

2. **No Successful Run** (>5 minutes):
   - Severity: HIGH  
   - Action: Check RPC connectivity, loan status

3. **Instance Down** (no heartbeat >90s):
   - Severity: CRITICAL
   - Action: Restart instance immediately

### Grafana Dashboard Example

```
┌─────────────────────────────────┐
│     Liquidator Instances        │
├─────────────────────────────────┤
│ Total: 3  Healthy: 2  Down: 1  │
├─────────────────────────────────┤
│ 24h Liquidations: 156           │
│ 24h Checks: 8,640              │
│ Avg Processing: 142ms          │
└─────────────────────────────────┘
```

---

## Best Practices

### 1. Instance Distribution
- Run 1 API instance + 2-3 liquidator workers
- Distribute across availability zones
- Use container orchestration for auto-restart

### 2. Resource Allocation
- API instance: 2 CPU, 4GB RAM
- Liquidator instance: 1 CPU, 2GB RAM
- Share Redis between all instances

### 3. Monitoring Setup
```bash
# Check aggregate health
curl http://api.yourdomain.com/health/liquidator

# Monitor specific instance
curl http://liquidator-1.internal/health
```

### 4. Scaling Guidelines
- Add liquidators when avg processing time >500ms
- Scale based on active loan count:
  - <100 loans: 1-2 instances
  - 100-500 loans: 2-3 instances
  - 500+ loans: 3-5 instances

---

## Troubleshooting

### Issue: All instances unhealthy
```bash
# Check Redis connectivity
redis-cli ping

# Check job queue status
redis-cli KEYS "bull:liquidation:*"

# Manually reset metrics
curl -X POST http://api/admin/reset-liquidator-metrics
```

### Issue: High processing times
- Check RPC latency
- Verify no rate limiting
- Consider adding more instances

### Issue: Duplicate liquidations
- Verify Redis is shared between instances
- Check job queue locking
- Enable job deduplication

---

## Security Considerations

1. **Network Isolation**: Liquidator-only instances don't need public access
2. **Admin Keys**: Each instance needs liquidator wallet access
3. **Redis Security**: Use AUTH and SSL for Redis connections
4. **Monitoring Access**: Restrict health endpoints to internal network

---

## Future Enhancements

- [ ] Auto-scaling based on queue depth
- [ ] Geographic distribution for global coverage
- [ ] Specialized instances for different token tiers
- [ ] ML-based performance optimization