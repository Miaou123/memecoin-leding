# Memecoin Lending Protocol - Solana Program

A collateralized lending protocol built on Solana that allows memecoin holders to borrow SOL against their tokens without selling.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Protocol State (PDA)                        │
│  - Admin authority                                               │
│  - Treasury (SOL pool)                                           │
│  - Fee configuration (protocol, liquidation splits)             │
│  - Buyback & Operations wallet addresses                        │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Token Config  │    │ Token Config  │    │ Token Config  │
│    (PDA)      │    │    (PDA)      │    │    (PDA)      │
│               │    │               │    │               │
│ - Mint        │    │ - Mint        │    │ - Mint        │
│ - Tier        │    │ - Tier        │    │ - Tier        │
│ - LTV         │    │ - LTV         │    │ - LTV         │
│ - Pool addr   │    │ - Pool addr   │    │ - Pool addr   │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   Loan (PDA)  │    │   Loan (PDA)  │    │   Loan (PDA)  │
│   + Vault     │    │   + Vault     │    │   + Vault     │
└───────────────┘    └───────────────┘    └───────────────┘
```

## 🎯 Features

### Token Tiers
| Tier | LTV | Protocol Fee |
|------|-----|-------------|
| Gold | 70% | 2% flat |
| Silver | 60% | 2% flat |
| Bronze | 50% | 2% flat |

### Auto-Liquidation System
1. **Time-based**: Loan expires (past due date)
2. **Price-based**: Token price falls below liquidation threshold
3. **Automated**: Protocol automatically liquidates via PumpFun bonding curve or Jupiter aggregator
4. **No manual liquidators**: System handles liquidation without external liquidators

### Fee Distribution
- 90% → Treasury (protocol reserves)
- 5% → Buyback wallet (for token buyback and burn)
- 5% → Operations wallet (team/costs)

## 📦 Program Structure

```
programs/memecoin-lending/
├── Cargo.toml
├── Xargo.toml
└── src/
    ├── lib.rs              # Program entry point
    ├── state.rs            # Account structures
    ├── error.rs            # Custom errors
    ├── utils.rs            # Price reading, math utilities
    └── instructions/
        ├── mod.rs
        ├── initialize.rs       # Initialize protocol
        ├── whitelist_token.rs  # Whitelist tokens
        ├── update_token_config.rs
        ├── create_loan.rs      # Core lending logic
        ├── repay_loan.rs       # Repayment logic
        ├── liquidate.rs        # Liquidation logic
        └── admin.rs            # Admin functions
```

## 🔧 Instructions

### Protocol Management
- `initialize` - Set up the protocol with admin and fee wallets
- `pause_protocol` / `resume_protocol` - Emergency controls
- `fund_treasury` - Add SOL liquidity
- `withdraw_treasury` - Admin withdrawal
- `update_fees` - Modify fee configuration
- `update_wallets` - Change admin/fee wallets

### Token Management
- `whitelist_token` - Add a token with tier and pool config
- `update_token_config` - Modify LTV and other settings

### Loan Operations
- `create_loan` - Deposit collateral, receive SOL
- `repay_loan` - Return SOL + 2% fee, get collateral back
- `liquidate` - Auto-liquidate expired/underwater loans via DEX

## 🔑 PDAs (Program Derived Addresses)

| Account | Seeds |
|---------|-------|
| Protocol State | `["protocol_state"]` |
| Treasury | `["treasury"]` |
| Token Config | `["token_config", mint]` |
| Loan | `["loan", borrower, mint, index]` |
| Vault | `["vault", loan_pda]` |

## 💰 Loan Flow

### Creating a Loan
1. User deposits memecoin collateral
2. Protocol reads price from AMM pool (Raydium/Pumpfun)
3. Calculates SOL amount based on LTV
4. Applies 2% flat protocol fee
5. Transfers SOL from treasury to borrower
6. Creates loan account with liquidation parameters

### Repaying a Loan
1. User sends SOL (principal + 2% protocol fee)
2. Protocol transfers collateral back to user
3. Updates loan status to `Repaid`
4. Closes vault account (rent returned)

### Auto-Liquidating a Loan
1. Protocol automatically liquidates expired OR underwater loans
2. Collateral sold via PumpFun bonding curve or Jupiter aggregator
3. SOL proceeds distributed according to fee splits
4. Loan marked as `LiquidatedTime` or `LiquidatedPrice`

## 🧮 Math Formulas

### SOL to Lend
```
sol_amount = (collateral_amount × price × LTV) / 10000
```

### Protocol Fee
```
protocol_fee = sol_amount × 200 / 10000  // 2% flat fee
total_owed = sol_amount + protocol_fee
```

### Liquidation Price
```
liquidation_price = total_owed / (collateral_amount × (LTV + buffer_bps) / 10000)
```

## 🛡️ Security Considerations

1. **Price Oracle**: Currently reads from AMM pools on-chain
   - Risk: Flash loan manipulation
   - Mitigation: Use TWAP or signed price checkpoints

2. **Admin Keys**: Single admin can pause/modify protocol
   - Consider: Multisig or timelock for mainnet

3. **Integer Overflow**: All math uses checked operations
   - Returns errors instead of wrapping

## 🚀 Deployment

### Build
```bash
anchor build
```

### Test
```bash
anchor test
```

### Deploy
```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet-beta
```

### Initialize Protocol
```typescript
await program.methods
  .initialize(adminPubkey, buybackWallet, operationsWallet)
  .accounts({
    protocolState: protocolStatePda,
    treasury: treasuryPda,
    payer: adminPubkey,
    systemProgram: SystemProgram.programId,
  })
  .signers([adminKeypair])
  .rpc();
```

### Whitelist Token
```typescript
await program.methods
  .whitelistToken(
    { gold: {} },           // tier
    poolAddress,            // AMM pool
    { raydium: {} },        // pool type
    new BN(0.1 * LAMPORTS_PER_SOL),  // min loan
    new BN(100 * LAMPORTS_PER_SOL)   // max loan
  )
  .accounts({
    protocolState: protocolStatePda,
    tokenConfig: tokenConfigPda,
    tokenMint: mintAddress,
    poolAccount: poolAddress,
    admin: adminPubkey,
    systemProgram: SystemProgram.programId,
  })
  .signers([adminKeypair])
  .rpc();
```

## 📝 Environment Variables

```bash
# .env
ANCHOR_PROVIDER_URL=https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
ANCHOR_WALLET=~/.config/solana/id.json
PROGRAM_ID=MCLend1111111111111111111111111111111111111
```

## 🗺️ Roadmap

- [x] Core lending/borrowing logic
- [x] Time-based liquidation
- [x] Price-based liquidation
- [x] Admin controls
- [x] PumpFun auto-liquidation integration
- [x] Jupiter aggregator integration for liquidations
- [x] Flat 2% fee system (replaces interest rates)
- [ ] TWAP oracle for price manipulation protection
- [ ] Governance token integration
- [ ] LP yield distribution

## 📄 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Submit a pull request

## ⚠️ Disclaimer

This protocol is experimental and unaudited. Use at your own risk. Always start with small amounts on devnet before mainnet deployment.