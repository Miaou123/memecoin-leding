#!/bin/bash

echo "Testing Security Improvements..."
echo "================================"

# Test 1: IP Spoofing Protection
echo -e "\n1. Testing IP Spoofing Protection:"
echo "   Sending request with spoofed X-Forwarded-For header..."
curl -s -o /dev/null -w "   Status: %{http_code}\n" \
  -H "X-Forwarded-For: 1.2.3.4" \
  http://localhost:3002/health
echo "   (Check server logs - should show real IP, not 1.2.3.4)"

# Test 2: Security Headers
echo -e "\n2. Testing Security Headers:"
curl -s -I http://localhost:3002/health | grep -E "(Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|Strict-Transport-Security)" | sed 's/^/   /'

# Test 3: Body Size Limit
echo -e "\n3. Testing Request Body Size Limit:"
echo "   Sending 2MB payload (should fail with 413)..."
dd if=/dev/zero bs=1024 count=2048 2>/dev/null | curl -s -o /dev/null -w "   Status: %{http_code}\n" \
  -X POST http://localhost:3002/api/loans \
  -H "Content-Type: application/octet-stream" \
  --data-binary @-

# Test 4: CSRF Protection
echo -e "\n4. Testing CSRF Protection:"
echo "   a) Request without Origin/Referer headers (should pass for GET):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" \
  http://localhost:3002/api/loans

echo "   b) POST without Origin header (should check signature auth):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" \
  -X POST http://localhost:3002/api/loans \
  -H "Content-Type: application/json" \
  -d '{}'

echo "   c) POST with invalid Origin (should fail with 403):"
curl -s -o /dev/null -w "   Status: %{http_code}\n" \
  -X POST http://localhost:3002/api/loans \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.com" \
  -d '{}'

# Test 5: CSRF Token Endpoint
echo -e "\n5. Testing CSRF Token Endpoint:"
response=$(curl -s -w "\n   Status: %{http_code}" http://localhost:3002/api/csrf-token)
echo "$response" | tail -n 1
echo "   Token received: $(echo "$response" | head -n -1 | grep -o '"token":"[^"]*"' | cut -d'"' -f4 | cut -c1-16)..."

echo -e "\nSecurity tests completed!"