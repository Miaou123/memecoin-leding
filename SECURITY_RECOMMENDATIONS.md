# Security Recommendations for Mainnet Deployment

## 🛡️ Critical Security Improvements

### 1. Oracle Security (HIGH PRIORITY)
**Current State**: Uses backend-signed prices with timestamp validation
**Risk**: Single point of failure, potential manipulation
**Recommendation**: 
- Integrate Pyth Network or Switchboard for decentralized price feeds
- Keep backend prices as fallback only
- Implement price deviation checks between sources

### 2. Admin Key Management (HIGH PRIORITY)
**Current State**: Single admin key controls protocol
**Risk**: Key compromise = total protocol control
**Recommendation**:
- Implement Squads Protocol or Realms for multi-sig
- Require 3/5 or 4/7 signatures for critical operations
- Use different multi-sigs for different operations:
  - Protocol updates (5/7 signatures)
  - Treasury management (3/5 signatures)  
  - Token whitelisting (3/5 signatures)
  - Emergency pause (2/3 signatures for speed)

### 3. Liquidation Bot Security
**Current State**: Single authorized liquidator
**Risk**: Bot failure = no liquidations
**Recommendation**:
- Run multiple liquidator instances
- Implement liquidator rotation mechanism
- Add public liquidation after grace period
- Monitor liquidator performance

### 4. Treasury Exposure Limits
**Current State**: Good limits implemented (10% per token, 30% per user)
**Recommendation**: Keep these limits and:
- Add daily/weekly volume limits
- Implement progressive limits based on token age/liquidity
- Add circuit breakers for unusual activity

### 5. Emergency Response
**Current State**: Pause functionality exists
**Recommendation**:
- Create detailed runbooks for:
  - Oracle failures
  - Price manipulation attempts
  - Liquidation cascades
  - Smart contract bugs
- Set up PagerDuty/OpsGenie for 24/7 alerts
- Practice emergency drills before mainnet

### 6. Token Whitelisting Process
**Recommendation**:
- Start with only top 10 established memecoins
- Require minimum $1M liquidity for Bronze tier
- Manual review for all new tokens
- Implement gradual limit increases

### 7. Monitoring & Detection
**Essential Monitoring**:
```typescript
// Price Monitoring
- Price deviation > 10% in 5 minutes
- Repeated failed price updates
- Large price gaps between sources

// Loan Monitoring  
- Loans approaching liquidation threshold
- Unusual borrowing patterns
- Concentration risk alerts

// System Health
- RPC node response times
- Database query performance
- API rate limit hits
- WebSocket connection stability

// Security Events
- Failed authentication attempts
- Unusual admin operations
- Blacklisted token usage attempts
```

### 8. Rate Limiting Strategy
```typescript
// Recommended Limits
- Loan Creation: 1 per wallet per 5 minutes
- Price Queries: 10 per second per IP
- API Calls: 100 per minute per wallet
- WebSocket: 1 connection per IP
- Admin Operations: 1 per minute
```

### 9. Gradual Rollout Plan
**Week 1-2**: 
- Start with $100k treasury
- Whitelist only BONK, WIF, POPCAT
- Max loan $1,000
- Monitor closely

**Week 3-4**:
- Increase to $500k treasury
- Add 5 more established tokens
- Max loan $5,000
- Analyze patterns

**Month 2+**:
- Scale based on metrics
- Gradually increase limits
- Add more tokens with community input

### 10. Audit Checklist
Before mainnet, ensure audit covers:
- [ ] Reentrancy protection
- [ ] Integer overflow/underflow
- [ ] Access control bypasses
- [ ] Price manipulation vectors
- [ ] Liquidation edge cases
- [ ] Fee calculation accuracy
- [ ] PDA seed collisions
- [ ] Upgrade authority risks

## 🚨 Red Flags to Watch

1. **Borrowing Patterns**
   - Same wallet creating multiple loans quickly
   - Loans just below liquidation threshold
   - Coordinated borrowing across multiple wallets

2. **Price Anomalies**
   - Backend price significantly different from DEX
   - Rapid price movements before large loans
   - Stale price data being accepted

3. **System Behavior**
   - Increasing API response times
   - Database connection pool exhaustion
   - Memory leaks in backend services
   - WebSocket disconnections spike

## 📋 Pre-Launch Security Checklist

- [ ] Multi-sig wallets deployed and tested
- [ ] All team members trained on security procedures
- [ ] Incident response plan documented and rehearsed
- [ ] Monitoring dashboards configured
- [ ] Alert escalation paths defined
- [ ] Security audit completed and fixes implemented
- [ ] Penetration testing performed
- [ ] Load testing completed
- [ ] Disaster recovery plan tested
- [ ] Insurance/coverage evaluated

## 🔐 Operational Security

1. **Key Management**
   - Use hardware wallets for all keys
   - Implement key rotation schedule
   - Document key recovery procedures
   - Never store keys in code repositories

2. **Access Control**
   - Implement 2FA for all admin accounts
   - Use VPN for infrastructure access
   - Regular access reviews
   - Principle of least privilege

3. **Communication Security**
   - Use Signal/encrypted channels for sensitive discussions
   - Never share keys or sensitive data over email/Slack
   - Implement secure incident communication channel

Remember: **Security is not a one-time task but an ongoing process**. Plan for regular security reviews and updates.