# Memecoin Lending Protocol - Claude Code Context Document

> **Purpose**: This document provides comprehensive context for Claude Code to understand the codebase structure, architecture, frameworks, and conventions used in this project. Always refer to this document when starting new conversations to ensure consistent and accurate code assistance.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Solana Program (Rust/Anchor)](#solana-program-rustanchor)
5. [Backend Server (TypeScript/Hono)](#backend-server-typescripthono)
6. [Frontend (SolidJS)](#frontend-solidjs)
7. [Shared Packages](#shared-packages)
8. [Database Schema (Prisma)](#database-schema-prisma)
9. [Key Services & Business Logic](#key-services--business-logic)
10. [API Routes](#api-routes)
11. [Background Jobs](#background-jobs)
12. [Deployment & Configuration](#deployment--configuration)
13. [Development Workflow](#development-workflow)
14. [Coding Conventions](#coding-conventions)
15. [Security Considerations](#security-considerations)
16. [Common Tasks & Patterns](#common-tasks--patterns)

---

## Project Overview

**Memecoin Lending Protocol** is a full-stack decentralized lending platform built on Solana that allows users to borrow SOL using memecoin tokens as collateral.

### Core Features

- **SOL Borrowing**: Users deposit memecoins as collateral to borrow SOL
- **Tiered LTV System**: Bronze (25%), Silver (35%), Gold (50%) loan-to-value ratios
- **Time & Price Liquidations**: Loans are liquidated if duration expires OR if collateral price drops below threshold
- **Real-time Price Monitoring**: 5-second polling for price updates with fast liquidation triggers
- **Staking System**: Users can stake governance tokens to earn protocol fees
- **Fee Distribution**: Automated fee collection and distribution to stakeholders
- **Telegram Integration**: Notifications and token verification requests via Telegram bot

### Protocol Flow

```
User deposits memecoin collateral → Backend creates loan transaction with price approval
→ On-chain program validates and escrows collateral → SOL sent to borrower from treasury
→ User repays SOL + 2% fee → Collateral returned
OR
→ Time expires / Price drops → Liquidation triggered → Collateral sold via PumpFun/Jupiter
```

---

## Technology Stack

### Blockchain Layer
| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Solana | Latest |
| Framework | Anchor | 0.31.1 |
| Language | Rust | 2021 Edition |
| Token Standard | SPL Token + Token-2022 | - |

### Backend
| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 20+ |
| Framework | Hono | - |
| Database | PostgreSQL | - |
| ORM | Prisma | - |
| Cache/Queue | Redis + BullMQ | - |
| WebSocket | Built-in Hono | - |

### Frontend
| Component | Technology | Version |
|-----------|------------|---------|
| Framework | SolidJS | - |
| Routing | @solidjs/router | - |
| State Management | @tanstack/solid-query | - |
| Build Tool | Vite | - |
| Styling | Tailwind CSS | - |

### Package Manager
- **pnpm** (version 9+) - Monorepo workspace management

---

## Project Structure

```
memecoin-lending/
├── programs/                          # Solana on-chain programs
│   └── memecoin-lending/
│       ├── src/
│       │   ├── lib.rs                # Program entrypoint
│       │   ├── state.rs              # Account structures & enums
│       │   ├── error.rs              # Custom error codes
│       │   ├── utils.rs              # Helper functions
│       │   └── instructions/         # Instruction handlers
│       │       ├── mod.rs
│       │       ├── initialize.rs
│       │       ├── create_loan.rs
│       │       ├── repay_loan.rs
│       │       ├── liquidate_loan.rs
│       │       ├── staking.rs
│       │       └── ...
│       └── Cargo.toml
│
├── packages/                          # Shared TypeScript packages
│   ├── types/                        # @memecoin-lending/types
│   │   └── src/
│   │       ├── index.ts              # Export barrel
│   │       ├── protocol.ts           # Core protocol types
│   │       ├── api.ts                # API request/response types
│   │       ├── events.ts             # WebSocket event types
│   │       ├── security.ts           # Security event types
│   │       ├── token-verification.ts # Token verification types
│   │       └── manual-whitelist.ts   # Whitelist management types
│   │
│   ├── sdk/                          # @memecoin-lending/sdk
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts             # Main SDK client class
│   │       ├── pda.ts                # PDA derivation functions
│   │       ├── accounts/             # Account fetching utilities
│   │       ├── instructions/         # Instruction builders
│   │       ├── pool-price.ts         # Pool price reading logic
│   │       └── utils.ts
│   │
│   └── config/                       # @memecoin-lending/config
│       └── src/
│           ├── index.ts
│           ├── constants.ts          # Program IDs, PDAs, seeds
│           ├── tokens.ts             # Token definitions
│           ├── networks.ts           # Network configurations
│           └── deployment.ts         # Deployment config loading
│
├── apps/
│   ├── web/                          # SolidJS Frontend
│   │   ├── src/
│   │   │   ├── index.tsx             # App entrypoint & routes
│   │   │   ├── App.tsx               # Root component
│   │   │   ├── routes/               # Page components
│   │   │   │   ├── index.tsx         # Dashboard
│   │   │   │   ├── borrow.tsx        # Borrow page
│   │   │   │   ├── loans.tsx         # User loans
│   │   │   │   ├── staking.tsx       # Staking page
│   │   │   │   ├── repay/[id].tsx    # Repayment page
│   │   │   │   └── admin.tsx         # Admin panel
│   │   │   ├── components/
│   │   │   │   ├── ui/               # Reusable UI components
│   │   │   │   ├── layout/           # Layout components
│   │   │   │   ├── wallet/           # Wallet connection
│   │   │   │   ├── loans/            # Loan-related components
│   │   │   │   └── tokens/           # Token selection components
│   │   │   ├── hooks/                # SolidJS hooks
│   │   │   ├── lib/                  # Utilities (api, utils, transactions)
│   │   │   ├── config/               # Frontend config
│   │   │   └── utils/                # Helper utilities
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── server/                       # Backend API Server
│       ├── src/
│       │   ├── index.ts              # Server entrypoint
│       │   ├── api/                  # API route handlers
│       │   │   ├── loans.ts
│       │   │   ├── tokens.ts
│       │   │   ├── protocol.ts
│       │   │   ├── user.ts
│       │   │   ├── admin.ts
│       │   │   ├── health.ts
│       │   │   └── ...
│       │   ├── services/             # Business logic services
│       │   │   ├── loan.service.ts
│       │   │   ├── token-verification.service.ts
│       │   │   ├── price.service.ts
│       │   │   ├── fast-price-monitor.ts
│       │   │   ├── security-monitor.service.ts
│       │   │   └── ...
│       │   ├── jobs/                 # BullMQ background jobs
│       │   │   ├── index.ts          # Job initialization
│       │   │   ├── liquidation.job.ts
│       │   │   ├── price-monitor.job.ts
│       │   │   └── ...
│       │   ├── middleware/           # Hono middleware
│       │   ├── websocket/            # WebSocket handlers
│       │   ├── db/                   # Database client
│       │   ├── config/               # Server configuration
│       │   ├── validators/           # Zod validators
│       │   └── utils/                # Server utilities
│       ├── prisma/
│       │   └── schema.prisma         # Database schema
│       └── package.json
│
├── scripts/                          # Deployment & management scripts
│   ├── deploy-full.ts                # Full deployment script
│   ├── initialize-protocol.ts
│   ├── whitelist-token.ts
│   ├── fund-treasury.ts
│   ├── emergency-shutdown.ts
│   └── ...
│
├── deployments/                      # Network-specific deployment configs
│   ├── devnet-latest.json
│   └── mainnet-latest.json
│
├── keys/                             # Keypairs (gitignored)
│   ├── admin.json
│   └── deployer.json
│
├── target/                           # Anchor build outputs
│   ├── idl/
│   │   └── memecoin_lending.json     # Program IDL
│   └── deploy/
│
├── infrastructure/                   # Nginx, Redis configs
├── tests/                            # Test files
├── docker-compose.yml
├── Anchor.toml
├── pnpm-workspace.yaml
└── package.json
```

---

## Solana Program (Rust/Anchor)

### Program ID Management

The program ID is stored in multiple places and must be synchronized:

1. **Anchor.toml** - Program ID per network
2. **programs/memecoin-lending/src/lib.rs** - `declare_id!()` macro
3. **deployments/{network}-latest.json** - Deployment config

### Core State Accounts

```rust
// Protocol State - Global singleton
#[account]
pub struct ProtocolState {
    pub admin: Pubkey,
    pub buyback_wallet: Pubkey,
    pub operations_wallet: Pubkey,
    pub authorized_liquidator: Pubkey,
    pub price_authority: Pubkey,
    pub paused: bool,
    pub total_loans_created: u64,
    pub total_sol_borrowed: u64,
    pub total_fees_earned: u64,
    pub active_loans_count: u64,
    pub protocol_fee_bps: u16,  // Always 200 (2%)
    pub bump: u8,
}

// Token Configuration - Per whitelisted token
#[account]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub tier: TokenTier,           // Bronze/Silver/Gold
    pub enabled: bool,
    pub blacklisted: bool,
    pub pool_address: Pubkey,      // AMM pool for price
    pub pool_type: PoolType,       // Raydium/Orca/PumpFun/PumpSwap
    pub ltv_bps: u16,              // Loan-to-value in basis points
    pub min_loan_amount: u64,
    pub max_loan_amount: u64,
    pub is_protocol_token: bool,   // Higher LP limits
    pub bump: u8,
}

// Loan Account - Per active loan
#[account]
pub struct Loan {
    pub borrower: Pubkey,
    pub token_mint: Pubkey,
    pub collateral_amount: u64,
    pub sol_borrowed: u64,
    pub entry_price: u64,          // Scaled by 1e9
    pub liquidation_price: u64,    // Scaled by 1e9
    pub created_at: i64,
    pub due_at: i64,
    pub status: LoanStatus,
    pub index: u64,
    pub bump: u8,
    pub vault_bump: u8,
}
```

### Enums

```rust
pub enum TokenTier {
    Bronze = 0,  // 25% LTV
    Silver = 1,  // 35% LTV
    Gold = 2,    // 50% LTV
}

pub enum PoolType {
    Raydium = 0,
    Orca = 1,
    Pumpfun = 2,
    PumpSwap = 3,
}

pub enum LoanStatus {
    Active = 0,
    Repaid = 1,
    LiquidatedTime = 2,
    LiquidatedPrice = 3,
}
```

### PDA Seeds

```rust
pub const PROTOCOL_STATE_SEED: &[u8] = b"protocol_state";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TOKEN_CONFIG_SEED: &[u8] = b"token_config";
pub const LOAN_SEED: &[u8] = b"loan";
pub const VAULT_SEED: &[u8] = b"vault";
pub const STAKING_POOL_SEED: &[u8] = b"staking_pool";
pub const REWARD_VAULT_SEED: &[u8] = b"reward_vault";
pub const USER_STAKE_SEED: &[u8] = b"user_stake";
pub const FEE_RECEIVER_SEED: &[u8] = b"fee_receiver";
```

### Key Instructions

1. **initialize** - Sets up protocol state and treasury
2. **whitelist_token** - Adds a token to the whitelist with tier
3. **create_loan** - Creates loan with collateral deposit
4. **repay_loan** - Repays SOL + fee, returns collateral
5. **liquidate_loan** - Liquidates overdue or underwater loans
6. **stake** / **unstake** - Staking system
7. **claim_rewards** - Claim staking rewards
8. **distribute_creator_fees** - Distribute collected fees

---

## Backend Server (TypeScript/Hono)

### Server Architecture

The backend uses **Hono** as the web framework with the following structure:

```typescript
// Main server setup (apps/server/src/index.ts)
const app = new Hono();

// Middleware stack (order matters!)
app.use('*', requestIdMiddleware);
app.use('*', trustedProxyMiddleware);
app.use('*', apiSecurityHeaders);
app.use('*', defaultBodyLimit);
app.use('*', globalRateLimitMiddleware);
app.use('*', cors({ /* config */ }));
app.use('*', logger());

// API routes
app.route('/api/loans', loansRouter);
app.route('/api/tokens', tokensRouter);
app.route('/api/protocol', protocolRouter);
app.route('/api/user', userRouter);
app.route('/api/admin', adminRouter);
app.route('/api/loan', loanPrepareRouter);
app.route('/api/staking', stakingRoutes);
app.route('/api/monitoring', monitoringRouter);
app.route('/api', healthRouter);
app.route('/api', rpcProxyRouter);
```

### Key Services

#### LoanService (`loan.service.ts`)
- Creates and manages loans
- Checks liquidation conditions
- Executes liquidations via PumpFun or Jupiter
- Syncs on-chain state with database

#### TokenVerificationService (`token-verification.service.ts`)
- Verifies token eligibility for loans
- Checks liquidity, pool balance, token age
- Integrates with DexScreener API
- Handles manual whitelist entries

#### FastPriceMonitor (`fast-price-monitor.ts`)
- Real-time price monitoring (5-second intervals)
- Maintains liquidation thresholds per loan
- Triggers immediate liquidations on price drops
- Uses Jupiter price API

#### SecurityMonitor (`security-monitor.service.ts`)
- Logs security events to database
- Sends alerts via Telegram
- Tracks suspicious activities
- Rate limiting and anomaly detection

### API Authentication

- **Public endpoints**: No auth required (read operations)
- **User endpoints**: Wallet signature verification via `authMiddleware`
- **Admin endpoints**: API key via `requireAdminApiKey` middleware

---

## Frontend (SolidJS)

### Application Structure

```typescript
// Entry point (apps/web/src/index.tsx)
render(() => (
  <Router root={App}>
    <Route path="/" component={Home} />
    <Route path="/borrow" component={Borrow} />
    <Route path="/loans" component={Loans} />
    <Route path="/staking" component={Staking} />
    <Route path="/repay/:id" component={Repay} />
  </Router>
), root!);
```

### Key Components

#### WalletProvider
Provides wallet context throughout the app:
```typescript
const wallet = useWallet();
// Access: wallet.publicKey(), wallet.connected(), wallet.connect(), wallet.disconnect()
```

#### Hooks Pattern
Uses SolidJS signals and TanStack Query:
```typescript
// Query hook pattern
const userLoans = createQuery(() => ({
  queryKey: ['user-loans', wallet.publicKey()?.toString()],
  queryFn: () => api.getUserLoans(walletAddress),
  enabled: () => wallet.connected(),
}));

// Mutation hook pattern
const repayMutation = createMutation(() => ({
  mutationFn: async () => { /* ... */ },
  onSuccess: () => { /* invalidate queries */ },
}));
```

### UI Components

Located in `apps/web/src/components/ui/`:
- `Button` - Styled button with variants
- `SuccessModal` - Transaction success modal
- `Toast` / `ToastContainer` - Notifications
- `CopyButton` - Copy to clipboard utility

### Styling

- **Tailwind CSS** with custom theme
- Terminal/hacker aesthetic (green accent, dark background)
- Custom CSS classes in `globals.css`

### Environment Variables (Frontend)

```bash
VITE_SOLANA_NETWORK=devnet          # Network selection
VITE_PROGRAM_ID=...                  # Program ID
VITE_API_URL=http://localhost:3001   # Backend API URL
```

---

## Shared Packages

### @memecoin-lending/types

Core TypeScript interfaces and enums shared across packages:

```typescript
// Protocol types
export enum PoolType { Raydium, Orca, Pumpfun, PumpSwap }
export enum TokenTier { Bronze, Silver, Gold }
export enum LoanStatus { Active, Repaid, LiquidatedTime, LiquidatedPrice }

// API types
export interface ApiResponse<T> { success: boolean; data?: T; error?: string; }
export interface PaginatedResponse<T> { items: T[]; total: number; page: number; }
export interface CreateLoanRequest { tokenMint: string; collateralAmount: string; durationSeconds: number; }
export interface LoanEstimate { solAmount: string; ltv: number; liquidationPrice: string; }

// Event types
export enum WebSocketEvent {
  LOAN_CREATED, LOAN_REPAID, LOAN_LIQUIDATED,
  PRICE_UPDATE, PROTOCOL_UPDATE,
  SUBSCRIBE_LOANS, SUBSCRIBE_PRICES
}

// Security types
export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface SecurityEvent { id: string; timestamp: Date; severity: SecuritySeverity; ... }
```

### @memecoin-lending/sdk

Client library for interacting with the protocol:

```typescript
import { MemecoinLendingClient } from '@memecoin-lending/sdk';

const client = new MemecoinLendingClient(connection, wallet, programId, idl);

// PDA derivation
const [protocolState, bump] = client.getProtocolStatePDA();
const [tokenConfig] = client.getTokenConfigPDA(mint);
const [loanPda] = client.getLoanPDA(borrower, mint, index);

// Instructions
await client.initializeProtocol(admin, buybackWallet, operationsWallet);
await client.whitelistToken({ mint, tier, poolType, poolAddress, ... });
await client.createLoan(tokenMint, collateralAmount, durationSeconds);
await client.repayLoan(loanPubkey);
```

### @memecoin-lending/config

Configuration and constants:

```typescript
import { 
  PROGRAM_ID, 
  getNetworkConfig, 
  getAllTokenDefinitions,
  getProtocolStatePDA,
  getTreasuryPDA 
} from '@memecoin-lending/config';

const config = getNetworkConfig('devnet');
// { network: 'devnet', programId: '...', rpcUrl: '...', cluster: 'devnet' }
```

---

## Database Schema (Prisma)

### Core Models

```prisma
model Token {
  id              String    @id  // mint address
  symbol          String
  name            String
  decimals        Int
  tier            String         // 'bronze', 'silver', 'gold'
  poolAddress     String
  poolType        String?        // 'raydium', 'pumpswap', etc.
  enabled         Boolean   @default(true)
  blacklisted     Boolean   @default(false)
  loans           Loan[]
  priceHistory    PriceHistory[]
}

model Loan {
  id                String    @id  // loan PDA
  borrower          String
  tokenMint         String
  token             Token     @relation(fields: [tokenMint], references: [id])
  collateralAmount  String
  solBorrowed       String
  entryPrice        String
  liquidationPrice  String
  status            String
  createdAt         DateTime
  dueAt             DateTime
  repaidAt          DateTime?
  liquidatedAt      DateTime?
  txSignature       String?
  
  @@index([borrower])
  @@index([status])
  @@index([dueAt])
}

model ManualWhitelist {
  id              String    @id @default(uuid())
  mint            String    @unique
  symbol          String?
  name            String?
  tier            String
  ltvBps          Int
  enabled         Boolean   @default(true)
  addedBy         String
  addedAt         DateTime  @default(now())
  auditLogs       WhitelistAuditLog[]
}

model SecurityEvent {
  id          String    @id @default(uuid())
  timestamp   DateTime  @default(now())
  severity    String
  category    String
  eventType   String
  message     String
  details     Json?
  source      String
  resolved    Boolean   @default(false)
  
  @@index([severity])
  @@index([eventType])
}
```

### Database Commands

```bash
# Generate Prisma client
pnpm --filter @memecoin-lending/server db:generate

# Push schema changes (dev)
pnpm --filter @memecoin-lending/server db:push

# Create migration
pnpm --filter @memecoin-lending/server db:migrate dev --name <name>

# Reset database
pnpm --filter @memecoin-lending/server db:push --force-reset
```

---

## Key Services & Business Logic

### Loan Creation Flow

1. **Frontend** calls `POST /api/loan/prepare` with token, amount, duration
2. **Backend** validates token, checks liquidity, fetches price from Jupiter
3. **Backend** builds unsigned transaction with price signature
4. **Frontend** signs transaction with wallet
5. **Frontend** submits to Solana
6. **Backend** syncs loan to database

### Price Monitoring & Liquidation

```
FastPriceMonitor (5s polling)
    ↓
Fetches prices for all active loan tokens via Jupiter
    ↓
Compares current price vs liquidation price per loan
    ↓
If below threshold → triggers immediate liquidation
    ↓
Also: BullMQ liquidation job runs every 5s as backup
```

### Token Verification Flow

1. Check manual whitelist first
2. Query DexScreener for pool data
3. Validate:
   - Pool liquidity > $1,000
   - Pool balance ratio (min 20% SOL)
   - Token age > 24 hours
   - Not blacklisted
4. Return tier and LTV parameters

---

## API Routes

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness check |
| GET | `/api/ready` | Readiness check with dependencies |
| GET | `/api/protocol/stats` | Protocol statistics |
| GET | `/api/tokens` | List whitelisted tokens |
| GET | `/api/tokens/:mint` | Token details |
| GET | `/api/loans` | Paginated loans list |
| GET | `/api/loans/:id` | Single loan details |
| GET | `/api/loans/recent` | Recent loans for dashboard |

### Protected Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/loan/prepare` | Prepare loan transaction |
| POST | `/api/loans/:id/repay` | Repay loan |
| GET | `/api/user/:wallet/stats` | User statistics |
| GET | `/api/user/:wallet/history` | User loan history |
| GET | `/api/staking/stats` | Staking pool statistics |
| POST | `/api/staking/stake` | Stake tokens |
| POST | `/api/staking/unstake` | Unstake tokens |

### Admin Endpoints (API Key Required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/tokens/:mint/blacklist` | Blacklist token |
| POST | `/api/admin/tokens/:mint/unblacklist` | Remove blacklist |
| GET | `/api/admin/security/events` | Security events |
| POST | `/api/admin/whitelist` | Add to whitelist |
| PUT | `/api/admin/whitelist/:mint` | Update whitelist entry |

---

## Background Jobs

Uses **BullMQ** with Redis for job queues:

### Job Queues

| Queue | Job | Interval | Description |
|-------|-----|----------|-------------|
| liquidation | check-liquidations | 5s | Check and execute liquidations |
| price-monitor | update-prices | 3s | Fetch and broadcast prices |
| price-monitor | check-price-alerts | 15s | Check price alerts |
| sync | sync-protocol-state | 120s | Sync on-chain protocol state |
| sync | sync-loans | 60s | Sync loan statuses |
| notification | check-due-notifications | 60s | Send loan due notifications |
| distribution-crank | distribution-tick | 30s | Process fee distribution |

### Job Initialization

```typescript
// apps/server/src/jobs/index.ts
export async function initializeJobs() {
  initializeRedlock(redis);
  await setupRepeatableJobs(liquidationQueue, [...]);
  await setupRepeatableJobs(priceMonitorQueue, [...]);
  // ...
}
```

---

## Deployment & Configuration

### Deployment Files

Located in `/deployments/{network}-latest.json`:

```json
{
  "programId": "2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S",
  "network": "mainnet",
  "deployedAt": "2024-01-01T00:00:00.000Z",
  "pdas": {
    "protocolState": "...",
    "treasury": "...",
    "feeReceiver": "...",
    "stakingPool": "...",
    "rewardVault": "..."
  },
  "tokens": {
    "whitelisted": [...]
  }
}
```

### Environment Variables

#### Backend (.env)

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/memecoin_lending

# Redis
REDIS_URL=redis://localhost:6379

# Solana
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
PROGRAM_ID=...

# Keys (file paths)
ADMIN_KEYPAIR_PATH=./keys/admin.json
LIQUIDATOR_KEYPAIR_PATH=./keys/liquidator.json
PRICE_AUTHORITY_KEYPAIR_PATH=./keys/price-authority.json

# API
PORT=3001
ADMIN_API_KEY=your_secret_key

# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# External APIs
JUPITER_API_KEY1=...
JUPITER_API_KEY2=...
```

#### Frontend (.env.local)

```bash
VITE_SOLANA_NETWORK=devnet
VITE_PROGRAM_ID=...
VITE_API_URL=http://localhost:3001
```

### Deployment Commands

```bash
# Full deployment (generates keypair, builds, deploys, initializes)
pnpm run scripts deploy-full --network devnet

# Individual steps
pnpm --filter scripts deploy-program --network devnet
pnpm --filter scripts initialize-protocol --network devnet
pnpm --filter scripts whitelist-token --all --network devnet
pnpm --filter scripts fund-treasury --amount 100 --network devnet
```

---

## Development Workflow

### Initial Setup

```bash
# Clone and install
git clone <repo>
cd memecoin-lending
pnpm install

# Setup development environment
pnpm run setup:dev

# Fund devnet wallets
solana config set --url devnet
solana airdrop 2 --keypair keys/admin.json
```

### Running Development Servers

```bash
# Terminal 1: Backend
pnpm --filter @memecoin-lending/server dev

# Terminal 2: Frontend
pnpm --filter @memecoin-lending/web dev
```

### Building

```bash
# Build all packages
pnpm run build

# Build specific package
pnpm --filter @memecoin-lending/sdk build
pnpm --filter @memecoin-lending/types build
pnpm --filter @memecoin-lending/config build

# Build Anchor program
anchor build
```

### Testing

```bash
# Run Anchor tests
anchor test

# Run specific test file
anchor test tests/memecoin-lending.ts
```

---

## Coding Conventions

### TypeScript

- Use strict mode
- Prefer `const` over `let`
- Use explicit types for function parameters and return values
- Use barrel exports (`index.ts`) in packages
- Use `.js` extension in imports (ES modules)

### SolidJS Patterns

```typescript
// Signals for state
const [value, setValue] = createSignal(initialValue);

// Memos for derived state
const derivedValue = createMemo(() => computeFrom(value()));

// Effects for side effects
createEffect(() => {
  if (someCondition()) {
    doSomething();
  }
});

// Queries with TanStack Query
const query = createQuery(() => ({
  queryKey: ['key', dep()],
  queryFn: async () => fetchData(dep()),
  enabled: () => Boolean(dep()),
}));
```

### API Response Format

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: "Error message" }

// Paginated
{
  success: true,
  data: {
    items: [...],
    total: 100,
    page: 1,
    pageSize: 20,
    hasMore: true
  }
}
```

### Error Handling

```typescript
// API handlers
try {
  const result = await service.doSomething();
  return c.json({ success: true, data: result });
} catch (error: any) {
  logger.error('Operation failed:', error);
  return c.json({ success: false, error: error.message }, 500);
}
```

### Logging

```typescript
// Use structured logging
logger.info('Loan created', { loanId, borrower, amount });
logger.error('Liquidation failed', { loanId, error: error.message });

// Console for development
console.log('🚀 Server starting...');
console.error('❌ Error:', error);
console.warn('⚠️ Warning:', message);
```

---

## Security Considerations

### Input Validation

- All API inputs validated with Zod schemas
- Solana addresses validated with regex: `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/`
- Amounts validated as positive numbers
- Rate limiting on all endpoints

### Transaction Security

- Price signatures from backend authority
- Transaction simulation before submission
- Blockhash validation
- Signer verification

### Admin Security

- API key authentication for admin endpoints
- Multi-key setup for critical operations
- Security event logging
- Telegram alerts for critical events

### Smart Contract Security

- Reentrancy protection
- Authority checks on all admin functions
- Overflow/underflow protection
- PDA derivation for account ownership

---

## Common Tasks & Patterns

### Adding a New API Endpoint

1. Create route handler in `apps/server/src/api/`
2. Add Zod validators in `apps/server/src/validators/`
3. Implement service logic in `apps/server/src/services/`
4. Register route in `apps/server/src/index.ts`
5. Add types to `packages/types/src/`

### Adding a New Frontend Route

1. Create page component in `apps/web/src/routes/`
2. Add route to `apps/web/src/index.tsx`
3. Create any needed hooks in `apps/web/src/hooks/`
4. Add API calls to `apps/web/src/lib/api.ts`

### Whitelisting a New Token

```bash
# Via script
pnpm --filter scripts whitelist-token \
  --mint <MINT_ADDRESS> \
  --tier gold \
  --pool-address <POOL_ADDRESS> \
  --pool-type pumpswap \
  --network devnet

# Or via admin API
curl -X POST http://localhost:3001/api/admin/whitelist \
  -H "X-Admin-Key: your_key" \
  -H "Content-Type: application/json" \
  -d '{"mint": "...", "tier": "gold", ...}'
```

### Debugging Liquidations

1. Check `FastPriceMonitor` status via `/api/monitoring/price-status`
2. Check BullMQ jobs in Redis
3. Review security events in database
4. Check Telegram alerts
5. Verify on-chain loan status

### Adding a New Instruction

1. Define accounts in `programs/memecoin-lending/src/instructions/`
2. Implement handler logic
3. Export from `mod.rs`
4. Build with `anchor build`
5. Update SDK instruction builders
6. Update types package if needed

---

## Quick Reference

### Important File Locations

| Purpose | Location |
|---------|----------|
| Program ID | `Anchor.toml`, `lib.rs`, `deployments/*.json` |
| IDL | `target/idl/memecoin_lending.json` |
| Database schema | `apps/server/prisma/schema.prisma` |
| API routes | `apps/server/src/api/` |
| Frontend routes | `apps/web/src/routes/` |
| Type definitions | `packages/types/src/` |
| SDK client | `packages/sdk/src/client.ts` |
| Config constants | `packages/config/src/constants.ts` |

### Common Commands

```bash
# Development
pnpm dev                              # Start all dev servers (if configured)
pnpm --filter @memecoin-lending/server dev
pnpm --filter @memecoin-lending/web dev

# Building
pnpm build                            # Build all packages
anchor build                          # Build Solana program

# Database
pnpm --filter @memecoin-lending/server db:generate
pnpm --filter @memecoin-lending/server db:push

# Deployment
pnpm run scripts deploy-full --network devnet
anchor deploy --provider.cluster devnet

# Testing
anchor test
pnpm test
```

### Key External Dependencies

- **Solana RPC**: Helius, QuickNode, or public endpoints
- **Jupiter API**: Price feeds and swaps
- **DexScreener API**: Token pool information
- **PumpFun SDK**: Token trading on PumpFun
- **Redis**: Job queues and caching
- **PostgreSQL**: Primary database

---

## Notes for Claude Code

When working with this codebase:

1. **Always check deployment config** before making changes that depend on addresses
2. **Build packages in order**: types → config → sdk → apps
3. **Use pnpm filter** for package-specific commands
4. **PDA derivation** must use correct seeds from constants
5. **Token amounts** are typically in base units (lamports for SOL, raw for tokens)
6. **Prices** are scaled by 1e9 in the on-chain program
7. **Error handling** should use the established patterns
8. **Security events** should be logged for audit trails
9. **Test on devnet** before mainnet deployment
10. **Keep IDL in sync** after program changes

---

*Last updated: January 2025*
*Protocol Version: 0.1.0*