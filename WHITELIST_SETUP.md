# Manual Whitelist System Setup

This document explains how to configure and use the manual token whitelist system that was added to the memecoin lending protocol.

## Overview

The manual whitelist system allows administrators to bypass the PumpFun verification requirements and manually approve tokens for lending. This is useful for:
- Pre-launch tokens that haven't been listed on PumpFun yet
- Special partnerships or strategic tokens
- Tokens that meet lending criteria but fail automated verification
- Emergency overrides for technical issues

## Features

- **Admin-only access**: Only authorized administrators can add/remove tokens
- **Full CRUD operations**: Create, read, update, and delete whitelist entries
- **Audit logging**: All changes are logged with admin address and reason
- **Tier system**: Support for Bronze (50% LTV), Silver (60% LTV), and Gold (70% LTV)
- **Priority system**: Manual whitelist takes priority over PumpFun verification
- **Rich metadata**: Support for token name, symbol, reason, notes, external URLs, logos, and tags

## Database Schema

The system adds two new tables to your database:

### ManualWhitelist Table
- `id`: Unique identifier
- `mint`: Token mint address (unique)
- `symbol`: Token symbol (optional)
- `name`: Token name (optional)
- `tier`: Token tier (bronze/silver/gold)
- `ltvBps`: Custom LTV in basis points (optional, defaults based on tier)
- `interestRateBps`: Custom interest rate in basis points (optional)
- `minLoanAmount`: Minimum loan amount (optional)
- `maxLoanAmount`: Maximum loan amount (optional)
- `enabled`: Whether the token is currently enabled
- `addedBy`: Admin address who added the token
- `addedAt`: Timestamp when added
- `updatedAt`: Timestamp when last updated
- `reason`: Reason for whitelisting (optional)
- `notes`: Additional notes (optional)
- `externalUrl`: External URL for more info (optional)
- `logoUrl`: Token logo URL (optional)
- `tags`: Array of tags for categorization (optional)

### WhitelistAuditLog Table
- `id`: Unique identifier
- `entryId`: Reference to ManualWhitelist entry
- `action`: Action performed (ADD/UPDATE/REMOVE/ENABLE/DISABLE)
- `adminAddress`: Admin who performed the action
- `changes`: JSON object with change details
- `timestamp`: When the action occurred
- `reason`: Reason for the action

## Environment Variables

Add these to your server's `.env` file:

```env
# Token Verification Settings
MIN_LIQUIDITY_USD=0  # Set to 0 for testing, 100000 for production
TOKEN_CACHE_TTL_MS=300000  # 5 minutes in milliseconds
DEXSCREENER_API_TIMEOUT=10000  # 10 seconds

# Admin Settings (implement your own auth system)
ADMIN_PRIVATE_KEY=""  # Private key for admin authentication
```

Add these to your web app's `.env` file:

```env
# Feature Flags
VITE_ENABLE_ADMIN_PANEL="true"
VITE_ENABLE_TOKEN_VERIFICATION="true"
VITE_ENABLE_WHITELIST_FEATURES="true"
```

## API Endpoints

All admin endpoints are protected and require authentication:

### GET /api/admin/whitelist
List whitelist entries with filtering and pagination.

Query parameters:
- `mint`: Filter by mint address (partial match)
- `tier`: Filter by tier (bronze/silver/gold)
- `enabled`: Filter by enabled status (true/false)
- `addedBy`: Filter by admin address
- `tags`: Filter by tags (comma-separated)
- `search`: Search in mint, symbol, or name
- `sortBy`: Sort field (addedAt/updatedAt/symbol/tier)
- `sortOrder`: Sort order (asc/desc)
- `page`: Page number (1-based)
- `limit`: Items per page (max 100)

### POST /api/admin/whitelist
Add a new token to the whitelist.

Required fields:
- `mint`: Token mint address
- `tier`: Token tier (bronze/silver/gold)

Optional fields:
- `symbol`, `name`, `ltvBps`, `interestRateBps`, `minLoanAmount`, `maxLoanAmount`
- `reason`, `notes`, `externalUrl`, `logoUrl`, `tags`

### PUT /api/admin/whitelist/:mint
Update an existing whitelist entry.

### DELETE /api/admin/whitelist/:mint
Remove a token from the whitelist (requires `reason` in body).

### POST /api/admin/whitelist/:mint/enable
Enable a disabled whitelist entry.

### POST /api/admin/whitelist/:mint/disable
Disable a whitelist entry (requires `reason` in body).

### GET /api/admin/whitelist/stats
Get whitelist statistics (total, enabled, by tier, recently added).

### GET /api/admin/whitelist/:mint/audit-logs
Get audit logs for a specific token.

### GET /api/admin/whitelist/audit-logs/all
Get all audit logs with optional filtering.

## Admin Panel

Access the admin panel at `/admin` in your web application. The panel provides:

1. **Authentication**: Simple admin authentication (implement your own system)
2. **Statistics Dashboard**: Overview of whitelist entries and activity
3. **Token Management**: Add, edit, enable/disable, and remove tokens
4. **Filtering and Search**: Advanced filtering and search capabilities
5. **Real-time Updates**: Live updates when tokens are modified

## Integration

### Frontend Components

The system automatically integrates with existing token verification components:

- `TokenVerificationBadge`: Shows "Manually Whitelisted" for admin tokens
- `TokenInput`: Displays whitelist source and admin badge
- All existing verification flows work transparently

### Token Verification Flow

1. User enters token mint address
2. System checks manual whitelist first
3. If found and enabled, returns whitelist result with admin metadata
4. If not found or disabled, falls back to PumpFun verification
5. Manual whitelist always takes priority

## Authentication

  **Important**: The current implementation uses placeholder authentication. You must implement proper admin authentication:

1. **Message Signing**: Implement Solana wallet message signing
2. **Admin Verification**: Verify admin addresses against an allowlist
3. **Session Management**: Add proper session handling
4. **Rate Limiting**: Implement rate limiting for admin endpoints

Example implementation in `src/routes/admin/whitelist.ts`:

```typescript
const requireAdmin = async (c: any, next: any) => {
  const adminAddress = c.req.header('x-admin-address');
  const signature = c.req.header('x-signature');
  const timestamp = c.req.header('x-timestamp');
  
  // TODO: Verify signature and admin status
  // 1. Verify the signature is valid for the timestamp + admin address
  // 2. Check that adminAddress is in your admin allowlist
  // 3. Verify timestamp is recent (within 5 minutes)
  
  c.set('adminAddress', adminAddress);
  await next();
};
```

## Production Deployment

Before deploying to production:

1. **Set Minimum Liquidity**: Update `MIN_LIQUIDITY_USD` to appropriate value (e.g., 100000)
2. **Implement Admin Auth**: Replace placeholder authentication with secure system
3. **Configure Rate Limiting**: Set appropriate rate limits for admin endpoints
4. **Monitor Audit Logs**: Set up monitoring and alerting for admin actions
5. **Backup Database**: Ensure proper backup procedures for whitelist data
6. **Test Thoroughly**: Test all whitelist operations in staging environment

## SDK Usage

The SDK provides admin methods for programmatic access:

```typescript
import { MemecoinLendingClient } from '@memecoin-lending/sdk';

const client = new MemecoinLendingClient(connection, wallet);

// Add token to whitelist
await client.addToWhitelist({
  mint: 'TokenMintAddress...',
  symbol: 'TKN',
  name: 'Token Name',
  tier: 'gold',
  reason: 'Strategic partnership'
}, adminPrivateKey);

// Check if token is whitelisted
const verification = await client.verifyToken('TokenMintAddress...');
console.log(verification.isWhitelisted); // true
console.log(verification.whitelistSource); // 'manual'
```

## Troubleshooting

### Common Issues

1. **Admin Panel Not Loading**: Check `VITE_ENABLE_ADMIN_PANEL=true` in web app env
2. **Authentication Errors**: Implement proper signature verification
3. **Database Errors**: Ensure database migration was run successfully
4. **Cache Issues**: Clear token verification cache after whitelist changes

### Monitoring

Monitor these metrics:
- Whitelist entry count and growth
- Admin action frequency and patterns
- Failed authentication attempts
- Token verification cache hit rates
- Loan creation success rates for whitelisted tokens

## Migration

If you're adding this to an existing system, run the Prisma migration:

```bash
cd apps/server
npx prisma migrate dev --name add-manual-whitelist
```

The system will automatically start working with existing tokens and gradually populate the whitelist as needed.