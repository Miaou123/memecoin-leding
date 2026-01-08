# 🔐 Security Incident Response Runbook
## Memecoin Lending Protocol

**Last Updated:** January 2026  
**Version:** 1.0  
**Owner:** [Your Name]

---

## Table of Contents

1. [Critical Assets & Credentials](#1-critical-assets--credentials)
2. [Severity Levels](#2-severity-levels)
3. [Incident Response Procedures](#3-incident-response-procedures)
4. [Specific Incident Playbooks](#4-specific-incident-playbooks)
5. [Recovery Procedures](#5-recovery-procedures)
6. [Contact Information](#6-contact-information)
7. [Post-Incident Checklist](#7-post-incident-checklist)

---

## 1. Critical Assets & Credentials

### 1.1 Credential Locations

| Credential | Location | Purpose | Rotation Frequency |
|------------|----------|---------|-------------------|
| **Admin Keypair** | `/keys/admin.json` | Signs transactions, admin operations, fee claiming, liquidations | On compromise only |
| **Database Password** | `.env` → `DATABASE_URL` | PostgreSQL access | Every 90 days |
| **Admin API Key** | `.env` → `ADMIN_API_KEY` | Admin endpoint authentication | Every 90 days |
| **Jupiter API Key** | `.env` → `JUPITER_API_KEY` | Price feeds | On compromise |
| **Telegram Bot Token** | `.env` → `TELEGRAM_BOT_TOKEN` | Security alerts | On compromise |
| **RPC URL** | `.env` → `SOLANA_RPC_URL` | Blockchain access | N/A |

### 1.2 Critical Wallets & PDAs

| Name | Derivation | Purpose |
|------|------------|---------|
| **Admin Wallet** | From `/keys/admin.json` | Protocol authority, fee claiming |
| **Protocol State PDA** | `["protocol_state"]` | Global protocol configuration |
| **Treasury PDA** | `["treasury"]` | Holds protocol fees |
| **Fee Receiver PDA** | `["fee_receiver"]` | Receives creator fees before distribution |
| **Staking Vault PDA** | `["reward_vault"]` | Staking rewards |

### 1.3 External Services

| Service | Purpose | Dashboard |
|---------|---------|-----------|
| PostgreSQL | Database | Direct access or pgAdmin |
| Redis | Rate limiting, caching | redis-cli |
| Cloudflare | CDN, DDoS protection | dash.cloudflare.com |
| Telegram | Security alerts | t.me/your_bot |
| Helius/Triton | RPC provider | dashboard.helius.dev |

---

## 2. Severity Levels

| Level | Response Time | Examples | Notification |
|-------|--------------|----------|--------------|
| 🔴 **CRITICAL** | Immediate (< 15 min) | Private key compromise, active exploit, treasury drain | Phone call + Telegram |
| 🟠 **HIGH** | < 1 hour | Auth bypass detected, unusual withdrawals, RPC failure | Telegram |
| 🟡 **MEDIUM** | < 4 hours | Rate limit abuse, failed liquidations, service degradation | Telegram |
| 🔵 **LOW** | < 24 hours | Single failed auth, minor errors | Log only |

---

## 3. Incident Response Procedures

### 3.1 General Response Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. DETECT → 2. ASSESS → 3. CONTAIN → 4. ERADICATE → 5. RECOVER │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 1: Detect
- Telegram alert received
- User report
- Monitoring dashboard anomaly
- Log analysis

#### Step 2: Assess
- [ ] Determine severity level
- [ ] Identify affected systems
- [ ] Estimate impact (users, funds)
- [ ] Document initial findings

#### Step 3: Contain
- [ ] Pause affected systems if needed
- [ ] Block malicious IPs/addresses
- [ ] Preserve logs and evidence
- [ ] Notify stakeholders

#### Step 4: Eradicate
- [ ] Identify root cause
- [ ] Remove threat
- [ ] Patch vulnerability
- [ ] Update credentials if compromised

#### Step 5: Recover
- [ ] Restore services
- [ ] Verify security
- [ ] Monitor closely
- [ ] Document lessons learned

---

## 4. Specific Incident Playbooks

### 4.1 🔴 CRITICAL: Admin Private Key Compromise

**Detection:**
- Unauthorized transactions from admin wallet
- Unexpected protocol configuration changes
- Unusual fee claims

**Immediate Actions (First 15 minutes):**

```bash
# 1. PAUSE THE PROTOCOL IMMEDIATELY
cd /path/to/memecoin-lending
npx tsx scripts/pause-protocol.ts --network mainnet-beta --keypair ./keys/admin.json

# If admin keypair is compromised, use backup keypair or contact program upgrade authority
```

- [ ] **DO NOT** transfer remaining funds with compromised key (attacker may be watching)
- [ ] Verify pause transaction succeeded on-chain
- [ ] Document the compromise time and any observed transactions

**Containment (15-60 minutes):**

```bash
# 2. Transfer remaining treasury funds to NEW secure wallet
# Create new keypair OFFLINE on air-gapped machine
solana-keygen new -o new-admin.json --no-bip39-passphrase

# 3. If you have program upgrade authority, update admin in protocol state
npx tsx scripts/update-admin.ts --new-admin <NEW_WALLET> --network mainnet-beta
```

- [ ] Revoke all API keys
- [ ] Change database passwords
- [ ] Rotate all secrets in `.env`

**Recovery:**

- [ ] Generate new admin keypair on secure, air-gapped machine
- [ ] Update protocol with new admin (requires program upgrade authority)
- [ ] Update all services with new credentials
- [ ] Resume protocol after verification
- [ ] Notify affected users if funds were stolen
- [ ] File police report if significant loss

**Post-Incident:**

- [ ] Investigate how key was compromised
- [ ] Implement additional security (hardware wallet, multisig)
- [ ] Update security practices

---

### 4.2 🔴 CRITICAL: Active Exploit / Treasury Drain

**Detection:**
- Unusual outbound transactions from Treasury PDA
- Large number of liquidations in short time
- Alerts: `TREASURY_CRITICAL_BALANCE`, `TREASURY_WITHDRAWAL`

**Immediate Actions:**

```bash
# 1. PAUSE PROTOCOL
npx tsx scripts/pause-protocol.ts --network mainnet-beta --keypair ./keys/admin.json

# 2. Check treasury balance
solana balance <TREASURY_PDA_ADDRESS>

# 3. Review recent transactions
solana transaction-history <TREASURY_PDA_ADDRESS> --limit 20
```

- [ ] Pause protocol to stop further exploitation
- [ ] Take screenshots of suspicious transactions
- [ ] Document timeline

**Investigation:**

```bash
# Check recent security events
curl http://localhost:3002/api/admin/security/events?limit=100 \
  -H "X-Admin-Key: $ADMIN_API_KEY" | jq .

# Check liquidation history
curl http://localhost:3002/api/loans?status=liquidatedPrice&limit=50 | jq .
```

- [ ] Identify attack vector (smart contract bug, oracle manipulation, etc.)
- [ ] Determine if exploit is ongoing or completed
- [ ] Assess total funds at risk

**Recovery:**

- [ ] If smart contract bug: Deploy patched program
- [ ] If oracle manipulation: Add additional oracle sources
- [ ] Coordinate with affected users
- [ ] Consider compensation plan

---

### 4.3 🟠 HIGH: Database Compromise

**Detection:**
- Unauthorized database access in logs
- Data exfiltration alerts
- Unexpected queries or modifications

**Immediate Actions:**

```bash
# 1. Revoke database access
psql -c "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM <suspicious_user>;"

# 2. Change database password
# Update DATABASE_URL in .env

# 3. Restart all services with new credentials
pm2 restart all  # or docker-compose restart
```

- [ ] Check for data exfiltration
- [ ] Review what data was accessed
- [ ] Assess PII exposure

**Investigation:**

```bash
# Check database logs
sudo cat /var/log/postgresql/postgresql-*.log | grep -i "error\|failed\|denied"

# Review recent logins
psql -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"
```

**Recovery:**

- [ ] Rotate all database credentials
- [ ] Audit database permissions
- [ ] Enable enhanced logging
- [ ] If PII exposed: Prepare breach notification (legal requirement in many jurisdictions)

---

### 4.4 🟠 HIGH: API Key Compromise (ADMIN_API_KEY)

**Detection:**
- Unauthorized admin API calls
- Whitelist modifications you didn't make
- Fee configuration changes

**Immediate Actions:**

```bash
# 1. Generate new API key
openssl rand -hex 32

# 2. Update .env
ADMIN_API_KEY=<new_key>

# 3. Restart server
pm2 restart memecoin-server
```

- [ ] Check audit logs for what was accessed/modified

```bash
# Review admin actions
curl http://localhost:3002/api/admin/whitelist/audit-logs/all?limit=100 \
  -H "X-Admin-Key: $NEW_ADMIN_API_KEY" | jq .
```

**Recovery:**

- [ ] Revert any unauthorized changes
- [ ] Review IP addresses that used the old key
- [ ] Add IP whitelist for admin endpoints if not present

---

### 4.5 🟠 HIGH: RPC Provider Down

**Detection:**
- `SOLANA_RPC_ERROR` alerts
- Price feeds failing
- Transactions not submitting

**Immediate Actions:**

```bash
# 1. Check RPC status
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  $SOLANA_RPC_URL

# 2. Switch to backup RPC
# Update .env with backup RPC URL
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com  # Public fallback

# 3. Restart services
pm2 restart memecoin-server
```

**Backup RPC Providers:**

| Provider | URL | Notes |
|----------|-----|-------|
| Helius | `https://mainnet.helius-rpc.com/?api-key=XXX` | Primary |
| Triton | `https://memecoin-lending-xxx.rpcpool.com` | Secondary |
| Public | `https://api.mainnet-beta.solana.com` | Last resort (rate limited) |

---

### 4.6 🟡 MEDIUM: Rate Limit Abuse / DDoS Attempt

**Detection:**
- `RATE_LIMIT_EXCEEDED` alerts increasing
- Single IP triggering many rate limits
- Server response times increasing

**Immediate Actions:**

```bash
# 1. Identify abusing IPs
cat /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -20

# 2. Block specific IP (nginx)
echo "deny 1.2.3.4;" >> /etc/nginx/conf.d/blocked-ips.conf
nginx -s reload

# 3. Or block via Cloudflare
# Go to Cloudflare Dashboard → Security → WAF → Tools → IP Access Rules
```

**If DDoS Attack:**

```bash
# Enable Cloudflare Under Attack Mode
# Cloudflare Dashboard → Security → Under Attack Mode → ON

# Increase rate limits temporarily
# Update RATE_LIMIT_MAX_REQUESTS in .env
```

---

### 4.7 🟡 MEDIUM: Liquidation Service Failure

**Detection:**
- `LIQUIDATION_FAILURE` alerts
- Loans past due not being liquidated
- Circuit breaker triggered

**Immediate Actions:**

```bash
# 1. Check liquidator service status
pm2 status

# 2. Check liquidator wallet balance
solana balance $(solana address -k ./keys/admin.json)

# 3. Manually trigger liquidation check
curl -X POST http://localhost:3002/api/monitoring/check-liquidations \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

**Common Causes:**

| Issue | Solution |
|-------|----------|
| Insufficient SOL for fees | Fund liquidator wallet |
| RPC issues | Switch RPC provider |
| Swap route not found | Check Jupiter API status |
| High slippage | Increase `LIQUIDATION_SLIPPAGE_BPS` |

---

### 4.8 🟡 MEDIUM: Fee Claimer Failure

**Detection:**
- No fee claims for extended period
- `FEE_CLAIMER_FAILED` alerts
- Creator fees accumulating in PumpFun

**Immediate Actions:**

```bash
# 1. Check fee claimer status
curl http://localhost:3002/api/admin/fees/status \
  -H "X-Admin-Key: $ADMIN_API_KEY" | jq .

# 2. Check balances
curl http://localhost:3002/api/admin/fees/balances \
  -H "X-Admin-Key: $ADMIN_API_KEY" | jq .

# 3. Manually trigger claim
curl -X POST http://localhost:3002/api/admin/fees/claim \
  -H "X-Admin-Key: $ADMIN_API_KEY" | jq .
```

---

### 4.9 🔵 LOW: Authentication Failures

**Detection:**
- Multiple `AUTH_SIGNATURE_INVALID` events
- Same IP with repeated failures

**Assessment:**

```bash
# Check recent auth failures
curl "http://localhost:3002/api/admin/security/events?category=Authentication&limit=50" \
  -H "X-Admin-Key: $ADMIN_API_KEY" | jq .
```

**Response:**

- If from same IP: Consider blocking if pattern suggests attack
- If from different IPs: May be users with clock sync issues
- If targeting specific wallet: May be attempting to impersonate

---

## 5. Recovery Procedures

### 5.1 Restart Services

```bash
# Full restart
pm2 restart all

# Or with Docker
docker-compose restart

# Verify health
curl http://localhost:3002/health
```

### 5.2 Resume Paused Protocol

```bash
# 1. Verify threat is eliminated
# 2. Verify all credentials rotated
# 3. Resume

npx tsx scripts/resume-protocol.ts --network mainnet-beta --keypair ./keys/admin.json

# 4. Monitor closely for 24 hours
```

### 5.3 Restore Database from Backup

```bash
# 1. Stop services
pm2 stop memecoin-server

# 2. Restore from backup
pg_restore -d memecoin_lending backup_YYYYMMDD.dump

# 3. Restart services
pm2 start memecoin-server

# 4. Verify data integrity
```

### 5.4 Credential Rotation Checklist

| Credential | Command/Location | Updated? |
|------------|------------------|----------|
| Admin keypair | Generate new, update protocol | ☐ |
| Database password | PostgreSQL + `.env` | ☐ |
| Admin API key | `.env` → `ADMIN_API_KEY` | ☐ |
| Jupiter API key | `.env` → `JUPITER_API_KEY` | ☐ |
| Telegram bot token | `.env` → `TELEGRAM_BOT_TOKEN` | ☐ |
| Redis password | `.env` → `REDIS_URL` | ☐ |

---

## 6. Contact Information

### Internal Contacts

| Role | Name | Contact | When to Call |
|------|------|---------|--------------|
| **Primary On-Call** | [Your Name] | [Phone/Telegram] | All CRITICAL incidents |
| **Backup** | [Backup Name] | [Phone/Telegram] | If primary unavailable |

### External Contacts

| Service | Contact | When to Contact |
|---------|---------|-----------------|
| **Helius RPC** | support@helius.dev | RPC issues |
| **Cloudflare** | support@cloudflare.com | DDoS attacks |
| **Hosting Provider** | [Support URL] | Server issues |
| **Legal Counsel** | [Lawyer Contact] | Data breach, significant loss |
| **Law Enforcement** | Local police | Theft > $X |

### Emergency Resources

- **Solana Discord:** discord.gg/solana (for ecosystem-wide issues)
- **Anchor Discord:** discord.gg/anchor (for smart contract help)
- **Security Researchers:** [If you have a bug bounty program]

---

## 7. Post-Incident Checklist

### Immediately After Resolution

- [ ] Confirm threat is eliminated
- [ ] Verify all services operational
- [ ] Rotate any potentially compromised credentials
- [ ] Document timeline of events
- [ ] Preserve all logs and evidence

### Within 24 Hours

- [ ] Write incident summary
- [ ] Identify root cause
- [ ] Document what worked / what didn't
- [ ] Notify affected users if applicable
- [ ] Update monitoring/alerting if gaps found

### Within 1 Week

- [ ] Complete post-mortem document
- [ ] Implement preventive measures
- [ ] Update this runbook with lessons learned
- [ ] Schedule review with team (if applicable)
- [ ] Consider public disclosure (if appropriate)

### Post-Mortem Template

```markdown
# Incident Post-Mortem: [TITLE]

**Date:** YYYY-MM-DD
**Duration:** X hours
**Severity:** CRITICAL/HIGH/MEDIUM
**Author:** [Name]

## Summary
One paragraph description of what happened.

## Timeline
- HH:MM - First detection
- HH:MM - Response started
- HH:MM - Containment achieved
- HH:MM - Resolution confirmed

## Root Cause
What actually caused the incident?

## Impact
- Users affected: X
- Funds at risk: X SOL
- Downtime: X hours

## What Went Well
- ...

## What Went Poorly
- ...

## Action Items
- [ ] Item 1 (Owner, Due Date)
- [ ] Item 2 (Owner, Due Date)

## Lessons Learned
- ...
```

---

## Quick Reference Commands

```bash
# Check system health
curl http://localhost:3002/health

# View security events
curl "http://localhost:3002/api/admin/security/events?limit=20" -H "X-Admin-Key: $ADMIN_API_KEY"

# Get security stats
curl "http://localhost:3002/api/admin/security/stats" -H "X-Admin-Key: $ADMIN_API_KEY"

# Pause protocol
npx tsx scripts/pause-protocol.ts --network mainnet-beta --keypair ./keys/admin.json

# Resume protocol
npx tsx scripts/resume-protocol.ts --network mainnet-beta --keypair ./keys/admin.json

# Check treasury balance
curl http://localhost:3002/api/protocol/treasury

# Test security alerts
npx tsx scripts/test-security-alerts.ts

# View server logs
pm2 logs memecoin-server --lines 100

# Block IP in nginx
echo "deny 1.2.3.4;" >> /etc/nginx/conf.d/blocked-ips.conf && nginx -s reload
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01 | [Your Name] | Initial version |

---

**⚠️ IMPORTANT:** This document contains sensitive operational information. Store securely and limit access to authorized personnel only.