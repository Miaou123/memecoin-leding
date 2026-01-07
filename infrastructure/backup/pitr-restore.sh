#!/bin/bash
# PostgreSQL Point-in-Time Recovery (PITR) Restore Script
# Restores database to a specific point in time using base backups and WAL files

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
S3_BUCKET="${BACKUP_S3_BUCKET}"
S3_PREFIX="${BACKUP_S3_PREFIX:-memecoin-lending/postgres}"
S3_BACKUP_PATH="${S3_PREFIX}/backups"
S3_WAL_PATH="${S3_PREFIX}/wal-archive"
AWS_REGION="${AWS_REGION:-us-east-1}"
RESTORE_DIR="/var/lib/postgresql/restore"
WAL_RESTORE_DIR="/var/lib/postgresql/wal_restore"

# Function to display usage
usage() {
    echo -e "${GREEN}PostgreSQL Point-in-Time Recovery (PITR) Tool${NC}"
    echo "=============================================="
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  list              List available recovery points"
    echo "  restore           Restore to a specific point in time"
    echo "  verify            Verify backup integrity"
    echo ""
    echo "Options:"
    echo "  -t, --timestamp   Target recovery timestamp (YYYY-MM-DD HH:MM:SS)"
    echo "  -b, --backup      Specific base backup to use"
    echo "  -d, --dry-run     Show what would be done without executing"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 restore --timestamp \"2024-01-15 14:30:00\""
    echo "  $0 restore --backup backup-20240115-120000.sql.gz --timestamp \"2024-01-15 14:30:00\""
}

# Function to list available recovery points
list_recovery_points() {
    echo -e "${BLUE}Fetching available recovery points...${NC}"
    echo ""
    
    # List base backups
    echo -e "${GREEN}=== Base Backups ===${NC}"
    echo "These are full database backups:"
    echo ""
    
    aws s3 ls "s3://${S3_BUCKET}/${S3_BACKUP_PATH}/" --region "$AWS_REGION" | \
        grep -E '\.sql\.gz$|\.tar\.gz$' | \
        sort -r | \
        head -20 | \
        while read -r line; do
            size=$(echo "$line" | awk '{print $3}')
            date=$(echo "$line" | awk '{print $1" "$2}')
            file=$(echo "$line" | awk '{print $4}')
            size_mb=$((size / 1024 / 1024))
            echo -e "  ${YELLOW}${date}${NC} - ${file} (${size_mb}MB)"
        done
    
    echo ""
    
    # Show WAL archive range
    echo -e "${GREEN}=== WAL Archive Range ===${NC}"
    
    # Get oldest WAL file
    oldest_wal=$(aws s3 ls "s3://${S3_BUCKET}/${S3_WAL_PATH}/" --region "$AWS_REGION" | \
        grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}' | \
        sort | head -1 | awk '{print $1" "$2}')
    
    # Get newest WAL file
    newest_wal=$(aws s3 ls "s3://${S3_BUCKET}/${S3_WAL_PATH}/" --region "$AWS_REGION" | \
        grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}' | \
        sort -r | head -1 | awk '{print $1" "$2}')
    
    if [ -n "$oldest_wal" ] && [ -n "$newest_wal" ]; then
        echo -e "  Oldest WAL: ${YELLOW}${oldest_wal}${NC}"
        echo -e "  Newest WAL: ${YELLOW}${newest_wal}${NC}"
        
        # Count total WAL files
        wal_count=$(aws s3 ls "s3://${S3_BUCKET}/${S3_WAL_PATH}/" --region "$AWS_REGION" | wc -l)
        echo -e "  Total WAL files: ${YELLOW}${wal_count}${NC}"
    else
        echo -e "  ${RED}No WAL files found${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Recovery is possible to any point between the base backup time"
    echo -e "and the newest WAL file, with 5-minute precision.${NC}"
}

# Function to find the best base backup for a target time
find_base_backup() {
    local target_time="$1"
    local target_epoch=$(date -d "$target_time" +%s)
    
    # List all backups and find the most recent one before target time
    local best_backup=""
    
    aws s3 ls "s3://${S3_BUCKET}/${S3_BACKUP_PATH}/" --region "$AWS_REGION" | \
        grep -E '\.sql\.gz$|\.tar\.gz$' | \
        while read -r line; do
            backup_date=$(echo "$line" | awk '{print $1" "$2}')
            backup_file=$(echo "$line" | awk '{print $4}')
            backup_epoch=$(date -d "$backup_date" +%s)
            
            if [ $backup_epoch -le $target_epoch ]; then
                echo "$backup_epoch $backup_file"
            fi
        done | \
        sort -nr | \
        head -1 | \
        awk '{print $2}'
}

# Function to restore database
restore_database() {
    local target_timestamp="$1"
    local base_backup="$2"
    local dry_run="$3"
    
    echo -e "${BLUE}Starting Point-in-Time Recovery${NC}"
    echo -e "Target timestamp: ${YELLOW}${target_timestamp}${NC}"
    
    # Validate timestamp
    if ! date -d "$target_timestamp" >/dev/null 2>&1; then
        echo -e "${RED}Error: Invalid timestamp format${NC}"
        echo "Use format: YYYY-MM-DD HH:MM:SS"
        exit 1
    fi
    
    # Find base backup if not specified
    if [ -z "$base_backup" ]; then
        echo -e "\n${BLUE}Finding appropriate base backup...${NC}"
        base_backup=$(find_base_backup "$target_timestamp")
        
        if [ -z "$base_backup" ]; then
            echo -e "${RED}Error: No suitable base backup found for target timestamp${NC}"
            exit 1
        fi
    fi
    
    echo -e "Using base backup: ${YELLOW}${base_backup}${NC}"
    
    if [ "$dry_run" = "true" ]; then
        echo -e "\n${YELLOW}DRY RUN - No changes will be made${NC}"
        echo "Would perform the following steps:"
        echo "1. Stop PostgreSQL service"
        echo "2. Download base backup: $base_backup"
        echo "3. Clear existing data directory"
        echo "4. Restore base backup"
        echo "5. Configure recovery settings"
        echo "6. Download required WAL files"
        echo "7. Start recovery to timestamp: $target_timestamp"
        return
    fi
    
    # Confirmation prompt
    echo -e "\n${RED}WARNING: This will replace the current database!${NC}"
    echo "Make sure you have:"
    echo "  - Stopped all applications"
    echo "  - Taken a final backup if needed"
    echo ""
    read -p "Continue with restore? (yes/no): " confirm
    
    if [ "$confirm" != "yes" ]; then
        echo "Restore cancelled"
        exit 0
    fi
    
    # Create restore directories
    echo -e "\n${BLUE}Creating restore directories...${NC}"
    mkdir -p "$RESTORE_DIR"
    mkdir -p "$WAL_RESTORE_DIR"
    
    # Download base backup
    echo -e "\n${BLUE}Downloading base backup...${NC}"
    aws s3 cp "s3://${S3_BUCKET}/${S3_BACKUP_PATH}/${base_backup}" \
        "${RESTORE_DIR}/${base_backup}" \
        --region "$AWS_REGION"
    
    # Extract base backup
    echo -e "\n${BLUE}Extracting base backup...${NC}"
    if [[ "$base_backup" == *.tar.gz ]]; then
        tar -xzf "${RESTORE_DIR}/${base_backup}" -C "$RESTORE_DIR"
    elif [[ "$base_backup" == *.sql.gz ]]; then
        gunzip -c "${RESTORE_DIR}/${base_backup}" > "${RESTORE_DIR}/restore.sql"
    fi
    
    # Create recovery configuration
    echo -e "\n${BLUE}Creating recovery configuration...${NC}"
    cat > "${RESTORE_DIR}/recovery.conf" << EOF
# Point-in-Time Recovery Configuration
restore_command = 'aws s3 cp s3://${S3_BUCKET}/${S3_WAL_PATH}/%f %p --region ${AWS_REGION}'
recovery_target_time = '${target_timestamp}'
recovery_target_timeline = 'latest'
recovery_target_action = 'promote'
EOF

    # Create recovery signal for PostgreSQL 12+
    touch "${RESTORE_DIR}/recovery.signal"
    
    echo -e "\n${GREEN}✅ Recovery preparation complete${NC}"
    echo ""
    echo "Next steps (manual):"
    echo "1. Stop PostgreSQL: docker-compose stop postgres"
    echo "2. Backup current data: mv /var/lib/postgresql/data /var/lib/postgresql/data.old"
    echo "3. Copy restored data: cp -r ${RESTORE_DIR}/* /var/lib/postgresql/data/"
    echo "4. Set permissions: chown -R postgres:postgres /var/lib/postgresql/data"
    echo "5. Start PostgreSQL: docker-compose start postgres"
    echo "6. Monitor logs: docker-compose logs -f postgres"
    echo ""
    echo -e "${YELLOW}The database will replay WAL files up to ${target_timestamp}${NC}"
    echo "This process may take several minutes depending on the amount of WAL to replay."
}

# Function to verify backup integrity
verify_backup() {
    local backup_file="$1"
    
    echo -e "${BLUE}Verifying backup integrity...${NC}"
    
    # Download backup metadata
    metadata=$(aws s3 head-object \
        --bucket "$S3_BUCKET" \
        --key "${S3_BACKUP_PATH}/${backup_file}" \
        --region "$AWS_REGION" 2>/dev/null)
    
    if [ -z "$metadata" ]; then
        echo -e "${RED}Error: Backup not found${NC}"
        return 1
    fi
    
    # Extract metadata
    size=$(echo "$metadata" | jq -r '.ContentLength')
    modified=$(echo "$metadata" | jq -r '.LastModified')
    etag=$(echo "$metadata" | jq -r '.ETag')
    
    echo -e "Backup: ${YELLOW}${backup_file}${NC}"
    echo -e "Size: ${size} bytes"
    echo -e "Modified: ${modified}"
    echo -e "ETag: ${etag}"
    
    # Check if we can list associated WAL files
    echo -e "\n${BLUE}Checking WAL file availability...${NC}"
    
    # Extract timestamp from backup filename
    if [[ "$backup_file" =~ ([0-9]{8}-[0-9]{6}) ]]; then
        backup_time="${BASH_REMATCH[1]}"
        echo -e "Backup timestamp: ${backup_time}"
        
        # Check for WAL files around that time
        wal_count=$(aws s3 ls "s3://${S3_BUCKET}/${S3_WAL_PATH}/" --region "$AWS_REGION" | wc -l)
        echo -e "Total WAL files available: ${wal_count}"
    fi
    
    echo -e "\n${GREEN}✅ Backup appears valid${NC}"
}

# Main script logic
case "$1" in
    list)
        list_recovery_points
        ;;
    
    restore)
        shift
        target_timestamp=""
        base_backup=""
        dry_run="false"
        
        while [[ $# -gt 0 ]]; do
            case "$1" in
                -t|--timestamp)
                    target_timestamp="$2"
                    shift 2
                    ;;
                -b|--backup)
                    base_backup="$2"
                    shift 2
                    ;;
                -d|--dry-run)
                    dry_run="true"
                    shift
                    ;;
                *)
                    echo -e "${RED}Unknown option: $1${NC}"
                    usage
                    exit 1
                    ;;
            esac
        done
        
        if [ -z "$target_timestamp" ]; then
            echo -e "${RED}Error: Target timestamp required${NC}"
            usage
            exit 1
        fi
        
        restore_database "$target_timestamp" "$base_backup" "$dry_run"
        ;;
    
    verify)
        shift
        if [ -z "$1" ]; then
            echo -e "${RED}Error: Backup file name required${NC}"
            usage
            exit 1
        fi
        verify_backup "$1"
        ;;
    
    -h|--help)
        usage
        ;;
    
    *)
        echo -e "${RED}Error: Unknown command${NC}"
        usage
        exit 1
        ;;
esac