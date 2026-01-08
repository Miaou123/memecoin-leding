#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROGRAM_ID="2NVfyczy1rWMdb7Y9kGmHCZkM72wyYiN5ry8dntzBK2S"
ADMIN_KEY="./keys/admin.json"
NEW_BINARY="target/deploy/memecoin_lending.so"
NEW_SIZE=$(stat -f%z "$NEW_BINARY" 2>/dev/null || stat -c%s "$NEW_BINARY" 2>/dev/null)

echo -e "${YELLOW}=== Anchor Program Deployment ===${NC}"
echo "Program ID: $PROGRAM_ID"
echo "New binary size: $NEW_SIZE bytes"

# Check current program size
echo -e "\n${YELLOW}Checking current program size...${NC}"
CURRENT_INFO=$(solana program show $PROGRAM_ID -u m)
CURRENT_SIZE=$(echo "$CURRENT_INFO" | grep -E "Data Length:" | awk '{print $3}' | tr -d ',')

if [ -z "$CURRENT_SIZE" ]; then
    echo -e "${RED}Failed to get current program size${NC}"
    exit 1
fi

echo "Current program size: $CURRENT_SIZE bytes"

# Check if extension is needed
if [ "$NEW_SIZE" -gt "$CURRENT_SIZE" ]; then
    ADDITIONAL_BYTES=$((NEW_SIZE - CURRENT_SIZE + 10240))  # Add 10KB buffer
    echo -e "${YELLOW}Program needs to be extended by at least $ADDITIONAL_BYTES bytes${NC}"
    
    echo -e "\n${YELLOW}Extending program...${NC}"
    solana program extend $PROGRAM_ID $ADDITIONAL_BYTES -u m -k $ADMIN_KEY
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to extend program${NC}"
        exit 1
    fi
    echo -e "${GREEN}Program extended successfully${NC}"
else
    echo -e "${GREEN}Program size is sufficient (current: $CURRENT_SIZE, new: $NEW_SIZE)${NC}"
fi

# Deploy using buffer
echo -e "\n${YELLOW}Creating program buffer...${NC}"
BUFFER_OUTPUT=$(solana program write-buffer $NEW_BINARY -u m -k $ADMIN_KEY)
BUFFER_ADDRESS=$(echo "$BUFFER_OUTPUT" | grep -oE '[1-9A-HJ-NP-Za-km-z]{44}' | tail -1)

if [ -z "$BUFFER_ADDRESS" ]; then
    echo -e "${RED}Failed to create buffer${NC}"
    exit 1
fi

echo "Buffer created: $BUFFER_ADDRESS"

echo -e "\n${YELLOW}Upgrading program...${NC}"
solana program upgrade $BUFFER_ADDRESS $PROGRAM_ID -u m -k $ADMIN_KEY

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Program upgraded successfully!${NC}"
    
    # Update IDL
    echo -e "\n${YELLOW}Updating IDL on-chain...${NC}"
    anchor idl upgrade --filepath target/idl/memecoin_lending.json --provider.cluster mainnet --provider.wallet $ADMIN_KEY $PROGRAM_ID
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ IDL updated successfully!${NC}"
    else
        echo -e "${YELLOW}⚠️  IDL update failed (non-critical)${NC}"
    fi
else
    echo -e "${RED}❌ Program upgrade failed${NC}"
    exit 1
fi

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo "Now run: npx tsx scripts/update-pool-address.ts"