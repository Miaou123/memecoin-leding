#!/bin/bash
# Database migration script that bypasses PgBouncer
# Uses direct connection to PostgreSQL for DDL operations

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Database Migration Script${NC}"
echo "=========================="
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | xargs)

# Use direct connection URL if available
if [ -z "$DATABASE_URL_DIRECT" ]; then
    echo -e "${YELLOW}Warning: DATABASE_URL_DIRECT not found, using DATABASE_URL${NC}"
    
    # Try to modify DATABASE_URL to use port 5432 instead of 6432
    if [[ "$DATABASE_URL" == *":6432/"* ]]; then
        export DATABASE_URL_DIRECT="${DATABASE_URL//:6432\//:5432\/}"
        echo -e "${GREEN}Modified connection to use direct port 5432${NC}"
    else
        export DATABASE_URL_DIRECT="$DATABASE_URL"
    fi
else
    echo -e "${GREEN}Using DATABASE_URL_DIRECT for migrations${NC}"
fi

# Show connection info (hide password)
SAFE_URL=$(echo "$DATABASE_URL_DIRECT" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/*****:*****@/')
echo -e "Connection: ${YELLOW}$SAFE_URL${NC}"
echo ""

# Export for Prisma/migration tools
export DATABASE_URL="$DATABASE_URL_DIRECT"

# Run migrations based on the tool used
if [ -f "package.json" ] && grep -q "prisma" package.json; then
    echo -e "${GREEN}Running Prisma migrations...${NC}"
    pnpm db:push
elif [ -f "package.json" ] && grep -q "migrate" package.json; then
    echo -e "${GREEN}Running database migrations...${NC}"
    pnpm db:migrate
else
    echo -e "${RED}No migration command found in package.json${NC}"
    echo "Add one of these scripts to your package.json:"
    echo '  "db:migrate": "prisma migrate dev"'
    echo '  "db:push": "prisma db push"'
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Migrations completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} Application connections should use PgBouncer (port 6432)"
echo "Update your .env DATABASE_URL to use port 6432 for normal operations"