#!/bin/bash

# Start test validator
echo "Starting test validator..."
solana-test-validator --no-bpf-jit --reset &
VALIDATOR_PID=$!

# Wait for validator
sleep 5

# Run tests
echo "Running tests..."
npx ts-node --transpile-only tests/memecoin-lending.ts

# Kill validator
kill $VALIDATOR_PID

echo "Done!"