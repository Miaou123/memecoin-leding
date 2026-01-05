# 🔐 Security Alerts - Telegram Bot Setup

Follow these steps to receive security alerts in Telegram:

## Step 1: Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Choose a name for your bot (e.g., "Memecoin Lending Security")
4. Choose a username (e.g., "memecoin_lending_security_bot")
5. Copy the **Bot Token** (looks like: `123456789:ABCdef123...`)

## Step 2: Get Your Chat ID

### Option A: Personal Chat
1. Send any message to your bot
2. Visit: `https://api.telegram.org/bot{BOT_TOKEN}/getUpdates`
3. Look for `"chat":{"id":CHAT_ID}`

### Option B: Group Chat
1. Add your bot to a group
2. Send `/start` in the group
3. Visit: `https://api.telegram.org/bot{BOT_TOKEN}/getUpdates`
4. Look for the group chat ID (usually negative number)

## Step 3: Update Environment Variables

Replace the values in your `.env` file:

```bash
# Replace with your actual bot token
TELEGRAM_BOT_TOKEN="123456789:ABCdef123456789..."

# Replace with your chat ID (can be positive or negative number)
TELEGRAM_CHAT_ID="123456789"
```

## Step 4: Test the Configuration

Restart your server:
```bash
pnpm --filter @memecoin-lending/server dev
```

You should see:
```
🔒 Security Monitor initialized
   Telegram: ✅
```

## Step 5: Test Security Alerts

The bot will send alerts for events with severity >= MEDIUM, including:
- 🔴 **HIGH**: Jupiter WebSocket errors, liquidation failures
- 🟠 **MEDIUM**: Rate limit violations, admin actions
- 🟣 **CRITICAL**: Database errors, missing configurations

## Optional: Discord/Slack Integration

You can also add Discord or Slack webhooks:

```bash
# Discord webhook (optional)
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Slack webhook (optional)  
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

## Security Settings

Adjust these settings as needed:

```bash
# Minimum severity to send alerts (LOW/MEDIUM/HIGH/CRITICAL)
SECURITY_MIN_SEVERITY="MEDIUM"

# Minutes between duplicate alerts for same event type
SECURITY_RATE_LIMIT_MINUTES=5

# Save critical events to database
SECURITY_DB_PERSIST_ENABLED=true
```

## Example Alert Message

```
🚨 [HIGH] Price Monitoring Alert

Jupiter WebSocket connection failed

📊 Details:
• Error: getaddrinfo ENOTFOUND price.jup.ag
• Tracked Tokens: 0
• Connection Attempts: 5

🕐 2024-01-05 13:54:37 UTC
📍 price-service
```