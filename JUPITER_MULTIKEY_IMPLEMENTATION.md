# Jupiter API Multi-Key Rotation Implementation

## Overview
Implemented a robust Jupiter Price API client that rotates between multiple API keys, each optionally bound to a dedicated proxy IP. This prevents rate limiting and provides redundancy for price feeds.

## Features

### 1. Multi-Key Support
- Supports up to 10 API keys (`JUPITER_API_KEY1` through `JUPITER_API_KEY10`)
- Falls back to legacy `JUPITER_API_KEY` if no numbered keys are configured
- Works with no keys (public rate limits)

### 2. Proxy Support
- Each API key can have a corresponding proxy (`JUPITER_PROXY1` through `JUPITER_PROXY10`)
- Uses `https-proxy-agent` for proxy connections
- Format: `http://user:pass@host:port`

### 3. Health-Aware Rotation
- Round-robin rotation between healthy endpoints
- Automatic failover on errors or rate limits
- Cooldown periods:
  - 30 seconds after 429 (rate limit)
  - 5 minutes after 401/403 (auth errors)
  - 1 minute after 3 consecutive failures

### 4. Performance Tracking
- Latency tracking with rolling average
- Success rate calculation
- Request/failure counters per endpoint

### 5. API Version Support
- Supports both Jupiter API v2 and v3
- Default uses v3 (current production version)

## Configuration

### Environment Variables
```bash
# Legacy single key (still supported)
JUPITER_API_KEY=your_api_key

# Multi-key setup (recommended)
JUPITER_API_KEY1=jup_xxxxx1
JUPITER_API_KEY2=jup_xxxxx2
# ... up to JUPITER_API_KEY10

# Proxy configuration (optional)
JUPITER_PROXY1=http://user:pass@dc1.proxy-cheap.com:10001
JUPITER_PROXY2=http://user:pass@dc2.proxy-cheap.com:10002
# ... up to JUPITER_PROXY10
```

### Proxy-Cheap Setup Example
For Proxy-Cheap static datacenter proxies:
1. Purchase 10 static datacenter IPs
2. Each proxy gets a unique static IP
3. Bind each proxy to one API key consistently

## API Endpoints

### Health Status
```bash
GET /api/price-status/jupiter-health
```
Returns detailed health information for all endpoints:
```json
{
  "success": true,
  "data": {
    "total": 10,
    "healthy": 8,
    "apiVersion": "v3",
    "endpoints": [
      {
        "id": 1,
        "healthy": true,
        "consecutiveFailures": 0,
        "totalRequests": 1523,
        "totalFailures": 2,
        "avgLatencyMs": 145,
        "hasProxy": true,
        "cooldownRemainingMs": null,
        "successRate": "99.9%"
      }
    ]
  },
  "timestamp": 1704913200000
}
```

### Reset Endpoints
```bash
POST /api/price-status/jupiter-reset
```
Manually resets all endpoints to healthy status.

### Test Specific Endpoint
```bash
GET /api/price-status/jupiter-test/1
```
Tests a specific endpoint by ID.

## Implementation Details

### Files Modified
1. **jupiter-client.ts** - Core multi-key client implementation
2. **fast-price-monitor.ts** - Updated to use jupiter-client
3. **price.service.ts** - Updated to use jupiter-client
4. **price-status.ts** - Added health endpoints
5. **index.ts** - Added startup logging
6. **.env.example** - Added multi-key configuration

### Key Classes

#### JupiterApiClient
- Manages endpoint rotation and health
- Handles automatic failover
- Tracks performance metrics
- Supports both API v2 and v3

### Error Handling
- 429 (Rate Limit): 30-second cooldown
- 401/403 (Auth Error): 5-minute cooldown
- Other failures: 1-minute cooldown after 3 consecutive failures

## Monitoring

### Startup Logs
```
🔑 Jupiter client initialized: 10 keys, 10 with proxies
🔑 Jupiter API Status: 10/10 endpoints healthy
✅ Jupiter endpoint test successful (145ms)
```

### Security Events
The client logs security events for:
- Rate limiting (PRICE_API_RATE_LIMITED)
- Authentication failures (JUPITER_API_ERROR)
- All failures are logged via securityMonitor

## Testing

### Verify Setup
```bash
# Check health status
curl http://localhost:3001/api/price-status/jupiter-health

# Test individual endpoints
for i in {0..9}; do
  curl http://localhost:3001/api/price-status/jupiter-test/$i
done

# Monitor rotation in logs
tail -f apps/server/logs/*.log | grep -E "(Endpoint|429|rotating)"
```

### Load Testing
The system automatically handles load distribution:
- Each request uses the next healthy endpoint
- Failed endpoints are automatically removed from rotation
- Endpoints recover automatically after cooldown

## Benefits

1. **Reliability**: No single point of failure
2. **Performance**: Distributed load across endpoints
3. **Cost-effective**: Maximize free tier across multiple keys
4. **Monitoring**: Full visibility into endpoint health
5. **Automatic recovery**: Self-healing with cooldowns

## Troubleshooting

### All Endpoints Unhealthy
- Check API keys are valid
- Verify proxy configurations
- Use `/jupiter-reset` to force reset
- Check security logs for auth failures

### High Latency
- Check proxy performance
- Review avgLatencyMs per endpoint
- Consider removing slow proxies

### Rate Limiting Still Occurring
- Verify rotation is working (check logs)
- Ensure proxies have unique IPs
- Check if all endpoints are healthy