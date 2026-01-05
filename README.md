# Memecoin Lending Protocol

A complete full-stack memecoin lending protocol built on Solana, featuring a Rust program, TypeScript backend, and SolidJS frontend.

## 🏗️ Architecture

This monorepo contains:

- **Solana Program** (Rust/Anchor): On-chain lending logic with PDAs
- **Backend Server** (TypeScript): REST API, WebSocket, liquidation bot, price monitoring
- **Frontend DApp** (SolidJS): Web interface for borrowing and loan management
- **Shared Packages**: Types, SDK, configuration, and utilities

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- Rust & Anchor CLI (for program development)
- Solana CLI

### Development Setup

1. **Clone and setup:**
```bash
git clone <repository-url>
cd memecoin-lending
pnpm run setup:dev
```

2. **Get devnet SOL:**
```bash
solana config set --url devnet
solana airdrop 2 --keypair keys/admin.json
solana airdrop 2 --keypair keys/deployer.json
```

3. **Deploy program (optional - for local development):**
```bash
pnpm --filter scripts deploy-program --network devnet
pnpm --filter scripts initialize-protocol --network devnet
pnpm --filter scripts whitelist-token --all --network devnet
pnpm --filter scripts fund-treasury --amount 100 --network devnet
```

4. **Start development servers:**
```bash
# Terminal 1 - Backend
pnpm --filter @memecoin-lending/server dev

# Terminal 2 - Frontend  
pnpm --filter @memecoin-lending/web dev

```

5. **Access the application:**
- Web App: http://localhost:3000
- API: http://localhost:3001
- Database: postgresql://memecoin:password@localhost:5432/memecoin_lending

## 📦 Project Structure

```
memecoin-lending/
├── packages/                     # Shared packages
│   ├── sdk/                     # @memecoin-lending/sdk
│   ├── types/                   # @memecoin-lending/types  
│   └── config/                  # @memecoin-lending/config
├── apps/
│   ├── web/                     # SolidJS frontend
│   └── server/                  # Backend API + services
├── programs/                    # Solana programs (Anchor)
│   └── memecoin-lending/
├── scripts/                     # Deployment scripts
├── infrastructure/              # Nginx, Redis configs
└── docker-compose.yml           # All services
```

## 🎯 Features

### Core Protocol
- ✅ SOL borrowing against memecoin collateral
- ✅ Tiered LTV ratios (Bronze/Silver/Gold)
- ✅ Time and price-based liquidations
- ✅ Real-time price monitoring
- ✅ Automatic liquidation bot

### Web Interface
- ✅ Wallet connection (Phantom)
- ✅ Create loans with real-time estimates
- ✅ Loan management dashboard
- ✅ Repayment interface
- ✅ Real-time price updates

### Backend Services
- ✅ REST API with rate limiting
- ✅ WebSocket real-time updates
- ✅ Background job processing
- ✅ Price feed integration
- ✅ Liquidation automation

## 🛠️ Development

### Building Packages
```bash
# Build all packages
pnpm run build

# Build specific package
pnpm --filter @memecoin-lending/sdk build
```

### Database Operations
```bash
# Generate Prisma client
pnpm --filter @memecoin-lending/server db:generate

# Push schema changes
pnpm --filter @memecoin-lending/server db:push

# Reset database
pnpm --filter @memecoin-lending/server db:push --force-reset
```

### Testing
```bash
# Run all tests
pnpm run test

# Test specific package
pnpm --filter @memecoin-lending/server test
```

## 🚀 Deployment

### Development
```bash
pnpm run scripts deploy --environment development
```

### Production
```bash
# Set environment variables
export DB_PASSWORD="secure_password"
export PROGRAM_ID="your_program_id"
export API_URL="https://api.yourdomain.com"

# Deploy with SSL domain
pnpm run scripts deploy --environment production --domain yourdomain.com
```

### Docker Services
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild containers
docker-compose build
```

## 🔧 Configuration

### Environment Variables

Create `.env` file (use `.env.example` as template):

```bash
# Core
DB_PASSWORD=your_secure_password
PROGRAM_ID=your_program_id

# Solana
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
ADMIN_WALLET=your_admin_wallet
LIQUIDATOR_WALLET=your_liquidator_wallet

# Domains
API_URL=https://api.yourdomain.com
WS_URL=wss://api.yourdomain.com/ws
WEB_APP_URL=https://yourdomain.com
```

### Supported Networks
- `mainnet-beta`: Production
- `devnet`: Development/testing
- `localnet`: Local validator

## 📋 API Documentation

### REST Endpoints

**Protocol**
- `GET /api/protocol/stats` - Protocol statistics
- `GET /api/protocol/treasury` - Treasury balance

**Tokens**
- `GET /api/tokens` - List supported tokens
- `GET /api/tokens/:mint` - Token details
- `GET /api/tokens/:mint/price` - Current price

**Loans**
- `GET /api/loans` - All loans (paginated)
- `GET /api/loans/:pubkey` - Loan details
- `GET /api/loans/user/:wallet` - User loans
- `POST /api/loans/estimate` - Estimate loan terms
- `POST /api/loans` - Create loan (auth required)
- `POST /api/loans/:pubkey/repay` - Repay loan (auth required)

**WebSocket**
- `ws://localhost:3001/ws` - Real-time updates
- Events: `loan:created`, `loan:repaid`, `loan:liquidated`, `price:update`

## 🔐 Security

### Authentication
- Solana wallet signature verification
- Time-bound signatures (5-minute expiry)
- Rate limiting on all endpoints

### Authorization
- User-specific loan access
- Admin-only protocol operations

## 🏦 Protocol Operations

### Initialize Protocol
```bash
pnpm --filter scripts initialize-protocol --network devnet --admin-keypair ./keys/admin.json
```

### Whitelist Tokens
```bash
# Whitelist all default tokens
pnpm --filter scripts whitelist-token --all --network devnet

# Whitelist single token
pnpm --filter scripts whitelist-token \
  --mint 7xKXtg2CW87d96PXXf5VqGFL6NZmdrMEWY5sM4CcM8G8 \
  --tier gold \
  --pool PoolAddressHere \
  --symbol EXAMPLE \
  --network devnet
```

### Fund Treasury
```bash
pnpm --filter scripts fund-treasury --amount 1000 --network devnet
```

## 📊 Monitoring

### Health Checks
- `GET /health` - API health
- `GET /api/protocol/stats` - Protocol status
- Docker health checks on all services

### Logging
- Structured JSON logs
- Request/response logging
- Error tracking and alerts
- Performance monitoring

## 🛡️ Risk Management

### Token Tiers

| Tier | Liquidity Requirement | LTV Ratio |
|------|----------------------|-----------|
| Bronze | > $0 | 25% |
| Silver | > $100,000 | 35% |
| Gold | > $300,000 | 50% |

**Protocol Token:** Always receives 50% LTV regardless of tier.

### Duration-Based LTV Scaling

The protocol dynamically adjusts LTV based on loan duration to optimize risk:

| Duration | LTV Modifier | Example (Bronze 25%) | Silver (35%) | Gold (50%) |
|----------|--------------|---------------------|--------------|------------|
| 12h | +25% | 31.25% | 43.75% | 62.5% |
| 24h | +12.5% | 28.13% | 39.38% | 56.25% |
| 48h | 0% (base) | 25% | 35% | 50% |
| 4d | -12.5% | 21.88% | 30.63% | 43.75% |
| 7d | -25% | 18.75% | 26.25% | 37.5% |

### Loan Parameters
- **Protocol Fee**: 2% flat fee (all tiers)
- **Liquidation Buffer**: 0.5% price threshold
- **Duration Range**: 12 hours to 7 days

### Auto-Liquidation
- Automated liquidation via PumpFun/Jupiter
- Time-based liquidation (overdue loans)
- Price-based liquidation (below threshold)
- No manual liquidation bonuses (system handles liquidation automatically)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Code Style
- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- Conventional commits

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/memecoin-lending/issues)
- **Discord**: [Community Chat](https://discord.gg/your-server)
- **Email**: support@yourdomain.com

## 🗺️ Roadmap

- [ ] Multi-token collateral
- [ ] Flash loans
- [ ] Governance token
- [ ] Mobile app
- [ ] Additional DEX integrations
- [ ] Cross-chain support