# Jupiter API 3-Key Setup Guide

## Overview
This guide configures Jupiter Price API with 3 keys for rate limit distribution and redundancy:
- **Key 1**: Direct connection (uses server's IP)
- **Key 2**: Via Austria proxy #1
- **Key 3**: Via Austria proxy #2

## Configuration

### 1. Update your `.env` file

```properties
# ================================
# Jupiter Multi-Key Configuration
# ================================
# Key 1 - No proxy (uses server's IP)
JUPITER_API_KEY1=your_first_jupiter_key

# Key 2 - Via Proxy 1 (Austria)
JUPITER_API_KEY2=your_second_jupiter_key
JUPITER_PROXY2=http://USERNAME:PASSWORD@45.85.14.3:46831

# Key 3 - Via Proxy 2 (Austria)
JUPITER_API_KEY3=your_third_jupiter_key
JUPITER_PROXY3=http://USERNAME:PASSWORD@45.85.14.102:PORT_FROM_DASHBOARD

# Legacy key (optional, for backward compatibility)
# JUPITER_API_KEY=your_old_key
```

### 2. Get Your Proxy Ports

1. Log into your proxy provider dashboard
2. Find the specific port assigned to IP `45.85.14.102`
3. Replace `PORT_FROM_DASHBOARD` with that port number
4. Replace `USERNAME` and `PASSWORD` with your proxy credentials

### 3. Verify Setup

Start the server and check the logs:
```bash
🔑 Jupiter client initialized: 3 keys (2 with proxies)
   Key 1: direct (no proxy)
   Key 2: via proxy
   Key 3: via proxy
🔑 Jupiter API: 3/3 endpoints ready
✅ Jupiter endpoint test successful (145ms)
```

## Monitoring

### Health Check Endpoint
```bash
curl http://localhost:3001/api/price-status/jupiter-health
```

Response shows each key's status:
```json
{
  "success": true,
  "data": {
    "total": 3,
    "healthy": 3,
    "endpoints": [
      {
        "id": 1,
        "healthy": true,
        "hasProxy": false,
        "successRate": "100.0%",
        "avgLatencyMs": 120
      },
      {
        "id": 2,
        "healthy": true,
        "hasProxy": true,
        "successRate": "99.8%",
        "avgLatencyMs": 180
      },
      {
        "id": 3,
        "healthy": true,
        "hasProxy": true,
        "successRate": "99.9%",
        "avgLatencyMs": 175
      }
    ]
  }
}
```

### Manual Recovery
If all endpoints are unhealthy:
```bash
curl -X POST http://localhost:3001/api/price-status/jupiter-reset
```

## How It Works

1. **Round-Robin Rotation**: Each price request uses the next healthy endpoint
2. **Automatic Failover**: If an endpoint fails, it's marked unhealthy and skipped
3. **Cooldown Periods**:
   - 30 seconds after rate limit (429)
   - 5 minutes after auth failure (401/403)
   - 1 minute after 3 consecutive failures
4. **Self-Recovery**: Endpoints automatically become healthy after cooldown

## Troubleshooting

### "No Jupiter API keys configured"
- Ensure at least one `JUPITER_API_KEY1` or `JUPITER_API_KEY` is set
- Check for typos in environment variable names

### High Latency on Proxy Keys
- Proxy adds ~50-100ms latency (normal)
- Check proxy provider status
- Consider using geographically closer proxies

### All Keys Rate Limited
- Each key has independent rate limits
- Proxies ensure different IPs
- Check if proxy IPs are truly unique

### Auth Failures (401/403)
- Verify API keys are correct
- Check if keys are active on https://portal.jup.ag
- Ensure proxy credentials are correct

## Benefits

1. **3x Rate Limit**: Each key has its own rate limit quota
2. **High Availability**: Automatic failover between keys
3. **No Single Point of Failure**: Server continues if 1-2 keys fail
4. **Geographic Distribution**: Different IPs prevent IP-based rate limiting

## Future Expansion

To add more keys (up to 10):
```properties
JUPITER_API_KEY4=another_key
JUPITER_PROXY4=http://user:pass@another-proxy:port
```

The system automatically detects and uses keys 1-10 on startup.