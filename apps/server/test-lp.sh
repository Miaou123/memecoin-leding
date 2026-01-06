#!/bin/bash

echo "🚀 Running LP Limits Test..."
echo ""

# Change to server directory
cd apps/server

# Run the test with ts-node
npx tsx src/test/test-lp-limits.ts

# Or if you prefer to compile first:
# npx tsc src/test/test-lp-limits.ts --outDir dist/test
# node dist/test/test-lp-limits.js