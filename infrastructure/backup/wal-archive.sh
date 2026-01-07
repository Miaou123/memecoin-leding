#!/bin/bash
# PostgreSQL WAL Archive Script
# Archives WAL files to S3 for Point-in-Time Recovery (PITR)

# Exit on error
set -e

# Arguments from PostgreSQL
WAL_PATH="$1"    # Full path of WAL file to archive
WAL_NAME="$2"    # Just the file name

# Configuration from environment
S3_BUCKET="${BACKUP_S3_BUCKET}"
S3_PREFIX="${BACKUP_S3_PREFIX:-memecoin-lending/postgres}"
S3_WAL_PATH="${S3_PREFIX}/wal-archive"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Logging function
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" >> /var/log/postgresql/wal-archive.log
}

# Telegram notification function
send_telegram_alert() {
    local message="$1"
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=⚠️ WAL Archive Alert: ${message}" \
            -d "parse_mode=Markdown" >/dev/null 2>&1 || true
    fi
}

# Start archiving
log "Starting WAL archive for: $WAL_NAME"

# Validate inputs
if [ -z "$WAL_PATH" ] || [ -z "$WAL_NAME" ]; then
    log "ERROR: Missing required arguments"
    exit 1
fi

if [ ! -f "$WAL_PATH" ]; then
    log "ERROR: WAL file not found: $WAL_PATH"
    exit 1
fi

if [ -z "$S3_BUCKET" ]; then
    log "ERROR: BACKUP_S3_BUCKET not set"
    send_telegram_alert "WAL archiving failed: S3 bucket not configured"
    exit 1
fi

# Calculate file hash for integrity check
HASH=$(sha256sum "$WAL_PATH" | awk '{print $1}')
log "WAL file hash: $HASH"

# Create metadata
METADATA="wal-hash=${HASH},archived-at=$(date -u +%Y-%m-%dT%H:%M:%SZ),hostname=$(hostname)"

# Archive to S3 with retries
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if aws s3 cp "$WAL_PATH" "s3://${S3_BUCKET}/${S3_WAL_PATH}/${WAL_NAME}" \
        --region "$AWS_REGION" \
        --metadata "$METADATA" \
        --storage-class STANDARD_IA \
        2>>/var/log/postgresql/wal-archive-error.log; then
        
        log "Successfully archived $WAL_NAME to S3"
        
        # Verify the upload
        if aws s3 head-object --bucket "$S3_BUCKET" --key "${S3_WAL_PATH}/${WAL_NAME}" \
            --region "$AWS_REGION" >/dev/null 2>&1; then
            log "Verified WAL file exists in S3: $WAL_NAME"
            
            # Track successful archive
            echo "$(date -u +%s) $WAL_NAME" >> /var/lib/postgresql/wal_archive/.last_archived
            
            exit 0
        else
            log "ERROR: Failed to verify uploaded WAL file"
            RETRY_COUNT=$((RETRY_COUNT + 1))
            sleep 2
        fi
    else
        log "ERROR: Failed to upload WAL file (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 5
    fi
done

# All retries failed
log "ERROR: Failed to archive $WAL_NAME after $MAX_RETRIES attempts"
send_telegram_alert "WAL archiving failed for $WAL_NAME after $MAX_RETRIES attempts"

# PostgreSQL requires non-zero exit on failure
exit 1