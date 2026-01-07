#!/bin/bash
# PgBouncer Monitoring Script
# Provides insights into connection pooling performance and statistics

set -e

# Configuration
PGBOUNCER_HOST="${PGBOUNCER_HOST:-localhost}"
PGBOUNCER_PORT="${PGBOUNCER_PORT:-6432}"
PGBOUNCER_USER="${PGBOUNCER_USER:-admin}"
PGBOUNCER_DB="pgbouncer"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper function to execute PgBouncer admin commands
pgb_exec() {
    PGPASSWORD="${PGBOUNCER_PASSWORD}" psql -h "$PGBOUNCER_HOST" -p "$PGBOUNCER_PORT" -U "$PGBOUNCER_USER" -d "$PGBOUNCER_DB" -t -c "$1" 2>/dev/null
}

# Header
clear
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        PgBouncer Monitoring Dashboard          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo "Host: $PGBOUNCER_HOST:$PGBOUNCER_PORT"
echo "Time: $(date)"
echo ""

# Function to display a section
section() {
    echo -e "\n${GREEN}═══ $1 ═══${NC}\n"
}

# 1. Pool Status
section "Connection Pools Status"
echo -e "${YELLOW}Database         User      Cl_Active Cl_Waiting Sv_Active Sv_Idle Sv_Used Sv_Tested Sv_Login MaxWait Mode${NC}"
pgb_exec "SHOW POOLS;" | column -t

# 2. Database Statistics
section "Database Statistics"
echo -e "${YELLOW}Database         Requests  Received  Sent      Query_Time Errors${NC}"
pgb_exec "SHOW STATS;" | column -t

# 3. Client Connections
section "Active Client Connections"
echo -e "${YELLOW}Type User      Database  State     Addr          Local_Addr    Connect_Time${NC}"
pgb_exec "SHOW CLIENTS;" | head -20 | column -t
client_count=$(pgb_exec "SHOW CLIENTS;" | wc -l)
echo -e "\nTotal clients: $client_count"

# 4. Server Connections
section "Server Connections"
echo -e "${YELLOW}Type User      Database  State     Addr          Local_Addr    Connect_Time${NC}"
pgb_exec "SHOW SERVERS;" | head -20 | column -t
server_count=$(pgb_exec "SHOW SERVERS;" | wc -l)
echo -e "\nTotal servers: $server_count"

# 5. Configuration
section "Current Configuration"
echo -e "${YELLOW}Parameter              Value${NC}"
pgb_exec "SHOW CONFIG;" | grep -E "(max_client_conn|default_pool_size|pool_mode|server_lifetime)" | column -t

# 6. Performance Metrics
section "Performance Analysis"

# Calculate pool efficiency
stats=$(pgb_exec "SHOW STATS TOTALS;")
if [ ! -z "$stats" ]; then
    requests=$(echo "$stats" | awk '{print $2}')
    avg_query_time=$(echo "$stats" | awk '{print $5}')
    
    echo -e "Total Requests: ${YELLOW}$requests${NC}"
    echo -e "Avg Query Time: ${YELLOW}$avg_query_time${NC} μs"
fi

# Pool usage analysis
pools=$(pgb_exec "SHOW POOLS;")
if [ ! -z "$pools" ]; then
    echo -e "\n${BLUE}Pool Usage Summary:${NC}"
    echo "$pools" | awk 'NR>1 {
        db=$1; user=$2; cl_active=$3; cl_waiting=$4; sv_active=$5; sv_idle=$6;
        total_sv = sv_active + sv_idle;
        if (total_sv > 0) {
            usage = (sv_active / total_sv) * 100;
            printf "  %-20s %s%%\n", db"/"user":", usage
        }
    }'
fi

# 7. Recommendations
section "Tuning Recommendations"

# Check for waiting clients
waiting_clients=$(pgb_exec "SHOW POOLS;" | awk '{sum += $4} END {print sum}')
if [ "$waiting_clients" -gt 0 ]; then
    echo -e "${RED}⚠️  Warning: $waiting_clients clients are waiting for connections${NC}"
    echo "   Consider increasing 'default_pool_size' or 'max_db_connections'"
fi

# Check pool efficiency
pools_data=$(pgb_exec "SHOW POOLS;")
while read -r line; do
    if [[ ! -z "$line" ]] && [[ ! "$line" =~ ^database ]]; then
        db=$(echo "$line" | awk '{print $1}')
        sv_used=$(echo "$line" | awk '{print $7}')
        sv_tested=$(echo "$line" | awk '{print $8}')
        
        if [ "$sv_used" -gt 100 ]; then
            echo -e "${YELLOW}ℹ️  Database '$db' has high server turnover (sv_used: $sv_used)${NC}"
            echo "   Consider increasing 'server_lifetime' for better connection reuse"
        fi
    fi
done <<< "$pools_data"

# Memory usage estimation
max_clients=$(pgb_exec "SHOW CONFIG;" | grep max_client_conn | awk '{print $2}')
echo -e "\n${BLUE}Resource Usage Estimation:${NC}"
echo "Max client connections: $max_clients"
echo "Estimated memory usage: ~$(($max_clients * 2))KB - $(($max_clients * 10))KB"

# 8. Quick Actions Menu
section "Quick Actions"
echo "1. Reload configuration:     RELOAD;"
echo "2. Pause a database:         PAUSE <dbname>;"
echo "3. Resume a database:        RESUME <dbname>;"
echo "4. Kill a connection:        KILL <dbname>;"
echo "5. Shutdown (graceful):      SHUTDOWN;"
echo ""
echo -e "${YELLOW}Connect to admin console:${NC}"
echo "psql -h $PGBOUNCER_HOST -p $PGBOUNCER_PORT -U $PGBOUNCER_USER pgbouncer"

# Footer
echo -e "\n${BLUE}════════════════════════════════════════════════${NC}"
echo "Press Ctrl+C to exit, or run with 'watch' for continuous monitoring:"
echo "watch -n 1 $0"