#!/bin/bash
# WAL Archiving Monitor Script
# Monitors PostgreSQL WAL archiving and sends alerts if it falls behind

set -e

# Configuration
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-memecoin}"
POSTGRES_DB="${POSTGRES_DB:-memecoin_lending}"
LAG_THRESHOLD_MINUTES="${LAG_THRESHOLD_MINUTES:-15}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Function to send Telegram alert
send_telegram_alert() {
    local message="$1"
    local severity="$2"
    
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        local emoji="⚠️"
        case "$severity" in
            "critical") emoji="🚨" ;;
            "warning") emoji="⚠️" ;;
            "info") emoji="ℹ️" ;;
            "success") emoji="✅" ;;
        esac
        
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=${emoji} WAL Archive Monitor: ${message}" \
            -d "parse_mode=Markdown" >/dev/null 2>&1 || true
    fi
}

# Function to check PostgreSQL connection
check_postgres_connection() {
    if ! PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1" >/dev/null 2>&1; then
        echo -e "${RED}Error: Cannot connect to PostgreSQL${NC}"
        send_telegram_alert "Cannot connect to PostgreSQL database" "critical"
        exit 1
    fi
}

# Main monitoring function
monitor_wal_archiving() {
    echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          WAL Archiving Monitor                 ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Time: $(date)"
    echo "Database: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
    echo ""

    # Check connection
    check_postgres_connection

    # Get archiver stats
    archiver_stats=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -F'|' -c "
        SELECT 
            archived_count,
            last_archived_wal,
            last_archived_time,
            failed_count,
            last_failed_wal,
            last_failed_time,
            stats_reset
        FROM pg_stat_archiver;
    ")

    # Parse results
    IFS='|' read -r archived_count last_archived_wal last_archived_time failed_count last_failed_wal last_failed_time stats_reset <<< "$archiver_stats"

    # Display basic stats
    echo -e "${GREEN}=== Archive Statistics ===${NC}"
    echo -e "Archived WAL files: ${YELLOW}${archived_count}${NC}"
    echo -e "Failed archives: ${YELLOW}${failed_count}${NC}"
    echo -e "Stats reset: ${stats_reset}"
    echo ""

    # Check last archive time
    if [ -n "$last_archived_time" ] && [ "$last_archived_time" != "" ]; then
        echo -e "${GREEN}=== Last Archive ===${NC}"
        echo -e "WAL file: ${YELLOW}${last_archived_wal}${NC}"
        echo -e "Time: ${YELLOW}${last_archived_time}${NC}"
        
        # Calculate lag
        current_time=$(date +%s)
        last_archive_epoch=$(date -d "$last_archived_time" +%s 2>/dev/null || echo "0")
        
        if [ "$last_archive_epoch" -gt 0 ]; then
            lag_seconds=$((current_time - last_archive_epoch))
            lag_minutes=$((lag_seconds / 60))
            
            echo -e "Archive lag: ${YELLOW}${lag_minutes} minutes${NC}"
            
            # Alert if lag exceeds threshold
            if [ $lag_minutes -gt $LAG_THRESHOLD_MINUTES ]; then
                echo -e "\n${RED}⚠️  WARNING: Archive lag exceeds ${LAG_THRESHOLD_MINUTES} minutes!${NC}"
                send_telegram_alert "WAL archive lag is ${lag_minutes} minutes (threshold: ${LAG_THRESHOLD_MINUTES})" "warning"
            else
                echo -e "\n${GREEN}✅ Archive lag within threshold${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}No archives recorded yet${NC}"
    fi

    echo ""

    # Check for recent failures
    if [ "$failed_count" -gt 0 ] && [ -n "$last_failed_time" ]; then
        echo -e "${RED}=== Recent Failures ===${NC}"
        echo -e "Failed WAL: ${YELLOW}${last_failed_wal}${NC}"
        echo -e "Failed at: ${YELLOW}${last_failed_time}${NC}"
        
        # Alert if failure is recent (within last hour)
        failure_epoch=$(date -d "$last_failed_time" +%s 2>/dev/null || echo "0")
        if [ "$failure_epoch" -gt 0 ]; then
            failure_age_minutes=$(((current_time - failure_epoch) / 60))
            if [ $failure_age_minutes -lt 60 ]; then
                echo -e "${RED}⚠️  Recent archive failure detected!${NC}"
                send_telegram_alert "WAL archive failed ${failure_age_minutes} minutes ago for ${last_failed_wal}" "critical"
            fi
        fi
        echo ""
    fi

    # Check current WAL write position
    echo -e "${GREEN}=== Current WAL Position ===${NC}"
    wal_position=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT pg_current_wal_lsn();")
    echo -e "Current LSN: ${YELLOW}${wal_position}${NC}"

    # Check WAL file count
    wal_count=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SELECT count(*) FROM pg_ls_waldir();")
    echo -e "WAL files in pg_wal: ${YELLOW}${wal_count}${NC}"

    if [ "$wal_count" -gt 100 ]; then
        echo -e "${YELLOW}⚠️  High number of WAL files - archiving may be slow${NC}"
    fi

    echo ""

    # Check archive command configuration
    echo -e "${GREEN}=== Configuration ===${NC}"
    archive_mode=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SHOW archive_mode;")
    archive_command=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c "SHOW archive_command;")
    
    echo -e "Archive mode: ${YELLOW}${archive_mode}${NC}"
    echo -e "Archive command: ${archive_command}"

    if [ "$archive_mode" != "on" ]; then
        echo -e "\n${RED}⚠️  CRITICAL: Archive mode is not enabled!${NC}"
        send_telegram_alert "Archive mode is OFF - WAL archiving disabled!" "critical"
    fi

    echo ""

    # Check local archive tracking
    if [ -f "/var/lib/postgresql/wal_archive/.last_archived" ]; then
        echo -e "${GREEN}=== Local Archive Tracking ===${NC}"
        last_local=$(tail -1 /var/lib/postgresql/wal_archive/.last_archived 2>/dev/null || echo "No data")
        echo -e "Last local archive: ${YELLOW}${last_local}${NC}"
    fi

    # Summary
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════${NC}"
    
    status="HEALTHY"
    if [ "$archive_mode" != "on" ]; then
        status="CRITICAL"
    elif [ -n "$lag_minutes" ] && [ $lag_minutes -gt $LAG_THRESHOLD_MINUTES ]; then
        status="WARNING"
    elif [ "$failed_count" -gt 0 ]; then
        status="DEGRADED"
    fi
    
    case "$status" in
        "HEALTHY")
            echo -e "Status: ${GREEN}✅ ${status}${NC}"
            ;;
        "WARNING"|"DEGRADED")
            echo -e "Status: ${YELLOW}⚠️  ${status}${NC}"
            ;;
        "CRITICAL")
            echo -e "Status: ${RED}🚨 ${status}${NC}"
            ;;
    esac
}

# Continuous monitoring mode
if [ "$1" = "--loop" ]; then
    interval="${2:-300}"  # Default 5 minutes
    echo "Starting continuous monitoring (interval: ${interval}s)..."
    
    while true; do
        clear
        monitor_wal_archiving
        echo ""
        echo "Next check in ${interval} seconds... (Ctrl+C to exit)"
        sleep "$interval"
    done
else
    # Single run
    monitor_wal_archiving
    
    # Exit with appropriate code
    if [ "$archive_mode" != "on" ]; then
        exit 2
    elif [ -n "$lag_minutes" ] && [ $lag_minutes -gt $LAG_THRESHOLD_MINUTES ]; then
        exit 1
    else
        exit 0
    fi
fi