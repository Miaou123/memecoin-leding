# 🔒 **Security Verification Checklist**

## **📋 Pre-Deployment Testing Guide**

### **🦀 Phase 1: On-Chain Security Tests**

#### ✅ **Test 1: UserExposure Account Creation**
```bash
# Create a loan and verify UserExposure account
cd scripts && npm run mcl -- create-loan \
  --token <TOKEN_MINT> \
  --amount 1000 \
  --duration 86400

# Then check UserExposure account was created:
solana account <USER_EXPOSURE_PDA> --output json
```

#### ✅ **Test 2: Per-Token Exposure Limit (10%)**
```bash
# Try to exceed 10% of treasury per token - should fail
# 1. Check current treasury balance
cd scripts && npm run mcl -- get-protocol-state

# 2. Calculate 10% of treasury
# 3. Try to create loans totaling >10% for same token
cd scripts && npm run mcl -- create-loan \
  --token <TOKEN_MINT> \
  --amount <LARGE_AMOUNT> \
  --duration 86400
# Expected: LendingError::TokenExposureTooHigh
```

#### ✅ **Test 3: Per-User Exposure Limit (30%)**
```bash
# Try to exceed 30% of treasury per user - should fail  
# Create multiple loans from same user exceeding 30% total
for i in {1..5}; do
  cd scripts && npm run mcl -- create-loan \
    --token <TOKEN_MINT_$i> \
    --amount <AMOUNT> \
    --duration 86400
done
# Expected: LendingError::UserExposureTooHigh on final loan
```

#### ✅ **Test 4: Single Loan Limit (10%)**
```bash
# Try to create single loan >10% of treasury - should fail
cd scripts && npm run mcl -- create-loan \
  --token <TOKEN_MINT> \
  --amount <TREASURY_BALANCE * 0.11> \
  --duration 86400
# Expected: LendingError::SingleLoanTooLarge
```

#### ✅ **Test 5: Minimum Loan Amount (0.01 SOL)**
```bash
# Try to create loan <0.01 SOL - should fail
cd scripts && npm run mcl -- create-loan \
  --token <TOKEN_MINT> \
  --amount 1 \
  --duration 86400
# Expected: LendingError::LoanAmountTooLow
```

#### ✅ **Test 6: Exposure Tracking on Repay**
```bash
# 1. Create loan and note UserExposure.total_borrowed
# 2. Repay loan
cd scripts && npm run mcl -- repay-loan --loan <LOAN_PUBKEY>
# 3. Verify UserExposure.total_borrowed decremented
# 4. Verify UserExposure.loans_repaid incremented
```

---

### **⚡ Phase 2: Backend Performance Tests**

#### ✅ **Test 7: Fast Liquidation Intervals (5s)**
```bash
# Check server logs for liquidation job frequency
docker logs memecoin-server | grep "Checking for liquidatable loans"
# Expected: ~Every 5 seconds
```

#### ✅ **Test 8: Fast Price Monitoring (3s)**
```bash
# Check server logs for price update frequency  
docker logs memecoin-server | grep "Updated prices"
# Expected: ~Every 3 seconds
```

#### ✅ **Test 9: WebSocket Connection**
```bash
# Check WebSocket connection logs
docker logs memecoin-server | grep "Jupiter WebSocket connected"
# Expected: ✅ Connection established

# Check price streaming
docker logs memecoin-server | grep "Real-time price update"
# Expected: Regular price updates from WebSocket
```

#### ✅ **Test 10: Token Tracking**
```bash
# Create a loan and verify automatic WebSocket tracking
docker logs memecoin-server | grep "Added .* to real-time tracking"
# Expected: Token automatically subscribed to WebSocket
```

#### ✅ **Test 11: Urgent Liquidation Trigger**
```bash
# Simulate price drop below liquidation threshold
# Check for immediate liquidation trigger (not waiting for 5s job)
docker logs memecoin-server | grep "URGENT.*liquidation"
# Expected: Immediate liquidation attempt
```

---

### **🔄 Phase 3: SDK Retry Tests**

#### ✅ **Test 12: Slippage Escalation (6 Levels)**
```bash
# Test liquidation with intentionally low slippage to force retries
cd scripts && npm run mcl -- liquidate-loan \
  --loan <LIQUIDATABLE_LOAN> \
  --initial-slippage 50  # Very low slippage to force retries

# Expected log output:
# 🔄 Liquidation attempt 1/6 with 3% slippage
# 🔄 Liquidation attempt 2/6 with 5% slippage  
# 🔄 Liquidation attempt 3/6 with 7% slippage
# 🔄 Liquidation attempt 4/6 with 9% slippage
# 🔄 Liquidation attempt 5/6 with 11% slippage
# 🔄 Liquidation attempt 6/6 with 15% slippage
```

#### ✅ **Test 13: On-Chain Transaction Confirmation**
```bash
# Verify liquidation waits for on-chain confirmation
cd scripts && npm run mcl -- liquidate-loan --loan <LOAN_PUBKEY>

# Expected log sequence:
# 📤 Transaction sent: <TX_SIGNATURE>
# ✅ Transaction CONFIRMED on-chain: <TX_SIGNATURE>  
# ✅ Loan status confirmed changed after liquidation
# ✅ Liquidation successful and CONFIRMED on attempt X
```

#### ✅ **Test 14: Exponential Backoff**
```bash
# Check retry timing between failed attempts
# Expected delays: 1s, 2s, 4s between retries
docker logs memecoin-server | grep "Waiting.*ms before retry"
```

---

### **🧪 Integration Tests**

#### ✅ **Test 15: Complete Liquidation Flow**
```bash
# End-to-end liquidation test
# 1. Create loan near liquidation threshold
# 2. Wait for price drop (or simulate)
# 3. Verify WebSocket triggers urgent liquidation
# 4. Verify retries with slippage escalation  
# 5. Verify on-chain confirmation
# 6. Verify UserExposure tracking updated
```

#### ✅ **Test 16: Treasury Protection**
```bash
# Attempt to drain treasury via multiple attack vectors:
# 1. Single large loan (blocked by single loan limit)
# 2. Multiple loans same token (blocked by token limit)  
# 3. Multiple loans same user (blocked by user limit)
# 4. Multiple small loans (blocked by minimum)

# Expected: All attacks prevented by exposure limits
```

---

## **🚨 Critical Metrics to Monitor**

### **Performance Metrics**
- Liquidation check interval: **≤ 5 seconds**
- Price update interval: **≤ 3 seconds**  
- WebSocket reconnection: **< 30 seconds**
- Transaction confirmation: **< 60 seconds**

### **Security Metrics**
- Per-token exposure: **≤ 10% of treasury**
- Per-user exposure: **≤ 30% of treasury**
- Single loan size: **≤ 10% of treasury**
- Minimum loan: **≥ 0.01 SOL**

### **Reliability Metrics**  
- Liquidation success rate: **> 95%**
- WebSocket uptime: **> 99%**
- Price data freshness: **< 5 seconds**
- Retry success rate: **> 90%**

---

## **🔧 Environment Variables Required**

```bash
# Required for security features
LIQUIDATOR_WALLET=<LIQUIDATOR_WALLET_ADDRESS>
ADMIN_WALLET=<ADMIN_WALLET_ADDRESS>
JUPITER_API_KEY=<JUPITER_API_KEY>

# Database and Redis
DATABASE_URL=<POSTGRES_URL>
REDIS_URL=<REDIS_URL>

# Solana network
SOLANA_NETWORK=devnet|mainnet-beta
```

---

## **✅ Deployment Readiness Checklist**

- [ ] All 16 tests pass
- [ ] Performance metrics within targets  
- [ ] Security limits enforced
- [ ] WebSocket connections stable
- [ ] Error handling comprehensive
- [ ] Logging detailed and clear
- [ ] Environment variables configured
- [ ] Database schema updated
- [ ] Redis cache operational
- [ ] Monitoring alerts configured

---

## **🚀 Post-Deployment Monitoring**

### **Real-Time Dashboards**
1. **Treasury Health**: Track total exposure vs limits
2. **Liquidation Performance**: Success rates and timing
3. **Price Feed Status**: WebSocket uptime and freshness  
4. **User Activity**: Loan creation and exposure trends

### **Alerts to Configure**
- Treasury exposure > 80% of any limit
- Liquidation failure rate > 5%  
- WebSocket disconnected > 30s
- Price data stale > 10s
- Any security error thrown

---

## **📞 Emergency Response**

### **If Security Breach Detected**
1. **Immediate**: Pause protocol via admin command
2. **Investigate**: Check logs for attack vectors
3. **Assess**: Calculate potential losses
4. **Mitigate**: Deploy hotfix if needed
5. **Resume**: Only after security confirmed

### **Emergency Contacts**
- Dev Team Lead: `@dev-lead`
- Security Auditor: `@security-team`  
- Operations: `@ops-team`

---

**🔐 Remember: Security is paramount. Test thoroughly before deployment!**