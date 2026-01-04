# Fee Claimer Service Documentation

The Fee Claimer Service automatically claims creator fees from PumpFun and distributes them according to the protocol's fee distribution model (40% Treasury, 40% Staking Rewards, 20% Operations).

## Configuration

The service is configured via environment variables:

```env
# Enable/disable the fee claimer (default: true)
ENABLE_FEE_CLAIMER=true

# Claim interval in milliseconds (default: 300000 = 5 minutes)
FEE_CLAIM_INTERVAL_MS=300000

# Minimum fee balance to trigger a claim in SOL (default: 0.01)
MIN_FEE_CLAIM_THRESHOLD=0.01

# Admin keypair - use one of these:
# Development: path to keypair file
ADMIN_KEYPAIR_PATH=./keys/admin.json
# Production: base64 encoded private key
ADMIN_PRIVATE_KEY=base64_encoded_private_key

# Admin API key for protected endpoints
ADMIN_API_KEY=your_secure_api_key_here
```

## API Endpoints

All endpoints require the `X-Admin-Key` header with the value of `ADMIN_API_KEY`.

### POST /api/admin/fees/claim

Manually trigger a fee claim and distribution.

**Request:**
```bash
curl -X POST http://localhost:3002/api/admin/fees/claim \
  -H "X-Admin-Key: your_secure_api_key_here"
```

**Response:**
```json
{
  "success": true,
  "claimed": 0.045,
  "distributed": 0.044,
  "breakdown": {
    "treasury": 0.0176,
    "staking": 0.0176,
    "operations": 0.0088
  },
  "signatures": {
    "collect": "5xyz...",
    "transfer": "5abc...",
    "distribute": "5def..."
  },
  "timestamp": "2025-01-04T12:00:00Z"
}
```

### GET /api/admin/fees/balances

Get current balances for all fee-related accounts.

**Request:**
```bash
curl http://localhost:3002/api/admin/fees/balances \
  -H "X-Admin-Key: your_secure_api_key_here"
```

**Response:**
```json
{
  "creatorFees": 0.045,
  "adminWallet": 0.123,
  "feeReceiver": 0.0,
  "treasury": 2.456,
  "rewardVault": 1.234,
  "timestamp": "2025-01-04T12:00:00Z"
}
```

### GET /api/admin/fees/status

Get the current status of the fee claimer service.

**Request:**
```bash
curl http://localhost:3002/api/admin/fees/status \
  -H "X-Admin-Key: your_secure_api_key_here"
```

**Response:**
```json
{
  "enabled": true,
  "running": true,
  "intervalMs": 3600000,
  "lastClaimAttempt": "2025-01-04T11:00:00Z",
  "lastClaimSuccess": true,
  "totalClaimsToday": 5,
  "totalDistributedToday": 0.225,
  "consecutiveFailures": 0,
  "timestamp": "2025-01-04T12:00:00Z"
}
```

## How It Works

1. **Automatic Claims**: When enabled, the service runs every `FEE_CLAIM_INTERVAL_MS` milliseconds (default: 5 minutes).

2. **Claim Process**:
   - Checks creator fee balance in PumpFun vaults
   - If balance >= `MIN_FEE_CLAIM_THRESHOLD`, proceeds with claim
   - Collects fees from PumpFun to admin wallet
   - Transfers collected fees to FeeReceiver PDA
   - Calls `distributeCreatorFees` to split funds 40/40/20

3. **Retry Logic**: Failed claims are retried up to 3 times with exponential backoff.

4. **Monitoring**: The service tracks:
   - Last claim attempt and success status
   - Daily claim count and total distributed
   - Consecutive failure count (alerts at 5+ failures)

5. **Graceful Shutdown**: The service properly stops when the server shuts down.

## Security Considerations

1. **Admin Keypair**: Store securely. In production, use `ADMIN_PRIVATE_KEY` with base64 encoding rather than a file.

2. **API Key**: Use a strong, randomly generated API key for `ADMIN_API_KEY`.

3. **Wallet Balance**: Ensure the admin wallet maintains at least 0.01 SOL for transaction fees.

4. **Rate Limiting**: The service respects PumpFun's rate limits and includes retry logic.

## Troubleshooting

### Service Not Starting
- Check if `ENABLE_FEE_CLAIMER` is set to `true`
- Verify admin keypair is accessible
- Ensure IDL file exists at the configured path

### Claims Failing
- Check admin wallet balance (needs SOL for fees)
- Verify PumpFun SDK connectivity
- Check program deployment and PDAs
- Review logs for specific error messages

### No Fees to Claim
- Verify the admin wallet is set as creator for tokens
- Check if balance meets minimum threshold
- Use `/api/admin/fees/balances` to check creator fee balance

## Monitoring

Monitor the service health via:
- `/api/admin/fees/status` endpoint
- Server logs (look for `💰` emoji for fee claimer logs)
- Daily distributed amount tracking
- Consecutive failure alerts