#!/bin/bash
# PostgreSQL Restore Script for Memecoin Lending Protocol
# CRITICAL: Test this in staging before you need it in production!

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"

# Database connection
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-memecoin}"
PGPASSWORD="${PGPASSWORD}"
PGDATABASE="${PGDATABASE:-memecoin_lending}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

show_help() {
    echo "Usage: $0 [OPTIONS] <backup_file>"
    echo ""
    echo "Options:"
    echo "  --from-s3 <s3_path>    Download and restore from S3"
    echo "  --list                 List available local backups"
    echo "  --list-s3              List available S3 backups"
    echo "  --latest               Restore from latest local backup"
    echo "  --dry-run              Show what would be restored without doing it"
    echo "  --no-confirm           Skip confirmation prompt (DANGEROUS)"
    echo "  -h, --help             Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 --list"
    echo "  $0 --latest"
    echo "  $0 /backups/memecoin_lending_20240115_120000.dump"
    echo "  $0 --from-s3 s3://my-bucket/memecoin-lending/postgres/backup.dump"
}

list_local_backups() {
    log_info "Available local backups:"
    echo ""
    ls -lht "$BACKUP_DIR"/*.dump 2>/dev/null | head -20 || echo "No backups found in $BACKUP_DIR"
}

list_s3_backups() {
    if [ -z "$S3_BUCKET" ]; then
        log_error "S3_BUCKET not configured"
        exit 1
    fi
    log_info "Available S3 backups:"
    aws s3 ls "s3://$S3_BUCKET/$S3_PREFIX/" --human-readable | grep ".dump" | tail -20
}

restore_database() {
    local BACKUP_FILE="$1"
    local DRY_RUN="$2"
    
    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
    
    log_info "Backup file: $BACKUP_FILE"
    log_info "File size: $(du -h "$BACKUP_FILE" | cut -f1)"
    
    # Verify backup before restore
    log_info "Verifying backup integrity..."
    if ! pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
        log_error "Backup file is corrupted or invalid!"
        exit 1
    fi
    log_info "Backup integrity verified!"
    
    # Show what's in the backup
    log_info "Backup contents:"
    pg_restore --list "$BACKUP_FILE" | grep -E "TABLE|INDEX|SEQUENCE" | head -20
    echo "..."
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would restore to: $PGHOST:$PGPORT/$PGDATABASE"
        return 0
    fi
    
    # Confirmation
    if [ "$NO_CONFIRM" != "true" ]; then
        echo ""
        log_warn "⚠️  WARNING: This will REPLACE ALL DATA in $PGDATABASE!"
        log_warn "Target: $PGHOST:$PGPORT/$PGDATABASE"
        echo ""
        read -p "Type 'RESTORE' to confirm: " CONFIRM
        if [ "$CONFIRM" != "RESTORE" ]; then
            log_info "Restore cancelled."
            exit 0
        fi
    fi
    
    # Create a backup of current state before restore
    log_info "Creating safety backup of current state..."
    SAFETY_BACKUP="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).dump"
    PGPASSWORD="$PGPASSWORD" pg_dump \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        -Fc \
        -f "$SAFETY_BACKUP" 2>/dev/null || log_warn "Could not create safety backup (database might be empty)"
    
    # Drop and recreate database
    log_info "Dropping existing database..."
    PGPASSWORD="$PGPASSWORD" psql \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d postgres \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PGDATABASE';" \
        > /dev/null 2>&1 || true
    
    PGPASSWORD="$PGPASSWORD" psql \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d postgres \
        -c "DROP DATABASE IF EXISTS $PGDATABASE;"
    
    PGPASSWORD="$PGPASSWORD" psql \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d postgres \
        -c "CREATE DATABASE $PGDATABASE OWNER $PGUSER;"
    
    # Restore from backup
    log_info "Restoring database from backup..."
    PGPASSWORD="$PGPASSWORD" pg_restore \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        "$BACKUP_FILE"
    
    # Verify restore
    log_info "Verifying restore..."
    TABLE_COUNT=$(PGPASSWORD="$PGPASSWORD" psql \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
    
    log_info "Restore complete! Tables in database: $TABLE_COUNT"
    
    # Show table row counts
    log_info "Table row counts:"
    PGPASSWORD="$PGPASSWORD" psql \
        -h "$PGHOST" \
        -p "$PGPORT" \
        -U "$PGUSER" \
        -d "$PGDATABASE" \
        -c "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"
    
    # Send notification
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        MESSAGE="🔄 *Database Restored*%0A%0ABackup: \`$(basename "$BACKUP_FILE")\`%0ATables: $TABLE_COUNT%0ATime: $(date)"
        curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage?chat_id=$TELEGRAM_CHAT_ID&text=$MESSAGE&parse_mode=Markdown" > /dev/null
    fi
}

# Parse arguments
DRY_RUN="false"
NO_CONFIRM="false"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --list)
            list_local_backups
            exit 0
            ;;
        --list-s3)
            list_s3_backups
            exit 0
            ;;
        --latest)
            BACKUP_FILE="$BACKUP_DIR/latest.dump"
            shift
            ;;
        --from-s3)
            S3_PATH="$2"
            log_info "Downloading from S3: $S3_PATH"
            BACKUP_FILE="/tmp/$(basename "$S3_PATH")"
            aws s3 cp "$S3_PATH" "$BACKUP_FILE"
            shift 2
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --no-confirm)
            NO_CONFIRM="true"
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            BACKUP_FILE="$1"
            shift
            ;;
    esac
done

if [ -z "$BACKUP_FILE" ]; then
    log_error "No backup file specified!"
    echo ""
    show_help
    exit 1
fi

restore_database "$BACKUP_FILE" "$DRY_RUN"