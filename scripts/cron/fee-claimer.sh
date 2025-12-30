#!/bin/bash

# Creator Fee Claimer - Run via cron
# Add to crontab: 0 * * * * /path/to/memecoin-lending/scripts/cron/fee-claimer.sh

cd /path/to/memecoin-lending
export PATH="$HOME/.nvm/versions/node/v20.10.0/bin:$PATH"

# Log file
LOG_FILE="/var/log/memecoin-lending/fee-claims.log"
mkdir -p $(dirname $LOG_FILE)

# Run claim script
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting fee claim..." >> $LOG_FILE
npx tsx scripts/claim-creator-fees.ts --network mainnet-beta --silent >> $LOG_FILE 2>&1
echo "$(date '+%Y-%m-%d %H:%M:%S') - Completed" >> $LOG_FILE
echo "" >> $LOG_FILE