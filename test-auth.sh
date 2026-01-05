#!/bin/bash

echo "Testing authentication endpoints..."
echo "=================================="

# Test 1: No authentication headers
echo -e "\n1. Testing WITHOUT authentication headers:"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3002/api/admin/whitelist

# Test 2: Forged signature
echo -e "\n2. Testing with FORGED signature:"
TIMESTAMP=$(date +%s)000
curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -H "X-Public-Key: 11111111111111111111111111111111" \
  -H "X-Signature: FakeSignature123456789" \
  -H "X-Timestamp: $TIMESTAMP" \
  http://localhost:3002/api/admin/whitelist

# Test 3: Invalid base58 signature
echo -e "\n3. Testing with INVALID base58 signature:"
TIMESTAMP=$(date +%s)000
curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -H "X-Public-Key: CgWTFX7JJQHed3qyMDjJkNCxK4sFe3wbDFABmWAAmrdS" \
  -H "X-Signature: !@#$%^&*()" \
  -H "X-Timestamp: $TIMESTAMP" \
  http://localhost:3002/api/admin/whitelist

# Test 4: Expired timestamp
echo -e "\n4. Testing with EXPIRED timestamp:"
OLD_TIMESTAMP=$(($(date +%s) - 600))000  # 10 minutes ago
curl -s -o /dev/null -w "Status: %{http_code}\n" \
  -H "X-Public-Key: CgWTFX7JJQHed3qyMDjJkNCxK4sFe3wbDFABmWAAmrdS" \
  -H "X-Signature: ValidLookingSignature123456789" \
  -H "X-Timestamp: $OLD_TIMESTAMP" \
  http://localhost:3002/api/admin/whitelist

echo -e "\nDone! Check server logs for security events."