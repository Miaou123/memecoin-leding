#!/bin/bash
# PostgreSQL Backup Script for Memecoin Lending Protocol
# Supports local storage and S3 upload

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-memecoin-lending/postgres}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="memecoin_lending_${TIMESTAMP}"

# Database connection (from environment)
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-memecoin}"
PGPASSWORD="${PGPASSWORD}"
PGDATABASE="${PGDATABASE:-memecoin_lending}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Health check - verify database is accessible
log_info "Verifying database connection..."
if ! PGPASSWORD="$PGPASSWORD" pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" > /dev/null 2>&1; then
    log_error "Cannot connect to database!"
    exit 1
fi

log_info "Starting backup: $BACKUP_NAME"

# Create full backup with pg_dump
# Using custom format (-Fc) for compression and flexible restore
BACKUP_FILE="$BACKUP_DIR/${BACKUP_NAME}.dump"
BACKUP_SQL="$BACKUP_DIR/${BACKUP_NAME}.sql.gz"

log_info "Creating custom format backup..."
PGPASSWORD="$PGPASSWORD" pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    -Fc \
    --no-owner \
    --no-acl \
    -f "$BACKUP_FILE"

log_info "Creating SQL backup (for manual inspection)..."
PGPASSWORD="$PGPASSWORD" pg_dump \
    -h "$PGHOST" \
    -p "$PGPORT" \
    -U "$PGUSER" \
    -d "$PGDATABASE" \
    --no-owner \
    --no-acl \
    | gzip > "$BACKUP_SQL"

# Get backup sizes
DUMP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
SQL_SIZE=$(du -h "$BACKUP_SQL" | cut -f1)
log_info "Backup sizes: dump=$DUMP_SIZE, sql.gz=$SQL_SIZE"

# Verify backup integrity
log_info "Verifying backup integrity..."
if pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
    log_info "Backup verification passed!"
else
    log_error "Backup verification FAILED!"
    exit 1
fi

# Upload to S3 if configured
if [ -n "$S3_BUCKET" ]; then
    log_info "Uploading to S3: s3://$S3_BUCKET/$S3_PREFIX/"
    
    aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/$S3_PREFIX/${BACKUP_NAME}.dump" \
        --storage-class STANDARD_IA
    
    aws s3 cp "$BACKUP_SQL" "s3://$S3_BUCKET/$S3_PREFIX/${BACKUP_NAME}.sql.gz" \
        --storage-class STANDARD_IA
    
    log_info "S3 upload complete!"
    
    # Clean up old S3 backups (keep last 30 days)
    log_info "Cleaning old S3 backups..."
    aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" | while read -r line; do
        FILE_DATE=$(echo "$line" | awk '{print $1}')
        FILE_NAME=$(echo "$line" | awk '{print $4}')
        if [ -n "$FILE_NAME" ]; then
            FILE_AGE=$(( ($(date +%s) - $(date -d "$FILE_DATE" +%s)) / 86400 ))
            if [ "$FILE_AGE" -gt 30 ]; then
                log_info "Removing old S3 backup: $FILE_NAME"
                aws s3 rm "s3://$S3_BUCKET/$S3_PREFIX/$FILE_NAME"
            fi
        fi
    done
fi

# Clean up old local backups
log_info "Cleaning local backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "memecoin_lending_*.dump" -mtime +$RETENTION_DAYS -delete
find "$BACKUP_DIR" -name "memecoin_lending_*.sql.gz" -mtime +$RETENTION_DAYS -delete

# List current backups
log_info "Current local backups:"
ls -lah "$BACKUP_DIR"/*.dump 2>/dev/null || echo "No backups found"

# Create latest symlink
ln -sf "$BACKUP_FILE" "$BACKUP_DIR/latest.dump"
ln -sf "$BACKUP_SQL" "$BACKUP_DIR/latest.sql.gz"

log_info "Backup complete: $BACKUP_NAME"

# Send notification (Telegram if configured)
if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    MESSAGE="✅ *Database Backup Complete*%0A%0ABackup: \`$BACKUP_NAME\`%0ASize: $DUMP_SIZE%0ATime: $(date)"
    curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage?chat_id=$TELEGRAM_CHAT_ID&text=$MESSAGE&parse_mode=Markdown" > /dev/null
fi

echo ""
log_info "=== Backup Summary ==="
echo "  File: $BACKUP_FILE"
echo "  Size: $DUMP_SIZE"
echo "  S3:   ${S3_BUCKET:-not configured}"
echo ""