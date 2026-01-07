#!/bin/bash
# Generate MD5 password hash for PgBouncer userlist.txt

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}PgBouncer Password Hash Generator${NC}"
echo "=================================="
echo ""

# Get username
read -p "Enter username: " username

# Get password (hidden input)
echo -n "Enter password: "
read -s password
echo ""

# Generate MD5 hash
# Format: md5 + md5sum of (password + username)
hash_input="${password}${username}"
md5_hash=$(echo -n "$hash_input" | md5sum | cut -d' ' -f1)
full_hash="md5${md5_hash}"

echo ""
echo -e "${YELLOW}Add this line to userlist.txt:${NC}"
echo "\"$username\" \"$full_hash\""
echo ""
echo -e "${GREEN}Hash generated successfully!${NC}"

# Optionally append to userlist.txt
echo ""
read -p "Append to userlist.txt? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "\"$username\" \"$full_hash\"" >> userlist.txt
    echo -e "${GREEN}✅ Added to userlist.txt${NC}"
else
    echo "Copy the line above and add it manually to userlist.txt"
fi