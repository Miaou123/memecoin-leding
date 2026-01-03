#!/bin/bash

echo "🚀 Deploying with fresh program ID and PDAs..."
echo ""
echo "This will:"
echo "  1. Generate a NEW program ID"
echo "  2. Create all NEW PDAs (no old data)"
echo "  3. Start completely fresh"
echo ""

# Deploy without --skip-keygen to get new program ID
npx tsx scripts/deploy-full.ts --network devnet --fund 10

echo ""
echo "✅ Fresh deployment complete!"
echo "   All PDAs are new and have no old data"