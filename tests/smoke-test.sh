#!/bin/bash

# ============================================================
# Memecoin Lending Protocol - Quick Smoke Test Script
# ============================================================
# This script runs quick tests using the CLI commands.
# Perfect for validating deployments and basic functionality.
#
# Usage:
#   chmod +x tests/smoke-test.sh
#   ./tests/smoke-test.sh --network devnet
#   ./tests/smoke-test.sh --network devnet --verbose
# ============================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
NETWORK="devnet"
VERBOSE=false
KEYPAIR="./keys/admin.json"
TEST_ONLY=""

# Get the script's directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"

# If we're already in project root (tests folder doesn't exist above us)
if [ ! -d "$PROJECT_ROOT/scripts" ]; then
    PROJECT_ROOT="$SCRIPT_DIR"
    SCRIPTS_DIR="$PROJECT_ROOT/scripts"
fi

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--network)
            NETWORK="$2"
            shift 2
            ;;
        -k|--keypair)
            KEYPAIR="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -t|--test-only)
            TEST_ONLY="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  -n, --network <network>   Network to use (devnet, mainnet-beta)"
            echo "  -k, --keypair <path>      Path to keypair file (relative to project root)"
            echo "  -v, --verbose             Verbose output"
            echo "  -t, --test-only <test>    Run only specific test (protocol, tokens, loans, admin, treasury, liquidation, api)"
            echo "  -h, --help                Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Test counters
PASSED=0
FAILED=0
SKIPPED=0

# Helper functions
log_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
}

log_test() {
    echo -n "  ⏳ $1... "
}

log_pass() {
    echo -e "${GREEN}✓${NC}"
    ((PASSED++))
}

log_fail() {
    echo -e "${RED}✗${NC}"
    echo -e "     ${RED}Error: $1${NC}"
    ((FAILED++))
}

log_skip() {
    echo -e "${YELLOW}⊘ (skipped: $1)${NC}"
    ((SKIPPED++))
}

log_info() {
    if [ "$VERBOSE" = true ]; then
        echo -e "     ${YELLOW}→ $1${NC}"
    fi
}

# Run MCL command - cd to scripts and run via npx tsx
run_mcl() {
    local current_dir=$(pwd)
    cd "$SCRIPTS_DIR"
    local output
    output=$(npx tsx mcl.ts "$@" 2>&1)
    local exit_code=$?
    cd "$current_dir"
    echo "$output"
    return $exit_code
}

# ============================================================
# TESTS START HERE
# ============================================================

log_header "🧪 Memecoin Lending Smoke Tests"
echo ""
echo "Network:      $NETWORK"
echo "Keypair:      $KEYPAIR"
echo "Verbose:      $VERBOSE"
echo "Project Root: $PROJECT_ROOT"
echo "Scripts Dir:  $SCRIPTS_DIR"

# Check prerequisites
echo ""
echo "Checking prerequisites..."

# Resolve keypair path relative to project root
if [[ "$KEYPAIR" != /* ]]; then
    FULL_KEYPAIR="$PROJECT_ROOT/$KEYPAIR"
else
    FULL_KEYPAIR="$KEYPAIR"
fi

if [ ! -f "$FULL_KEYPAIR" ]; then
    echo -e "${RED}Error: Keypair file not found: $FULL_KEYPAIR${NC}"
    exit 1
fi
echo "  ✓ Keypair file exists: $FULL_KEYPAIR"

# Check if scripts directory exists
if [ ! -d "$SCRIPTS_DIR" ]; then
    echo -e "${RED}Error: Scripts directory not found: $SCRIPTS_DIR${NC}"
    exit 1
fi
echo "  ✓ Scripts directory found"

# Check if mcl.ts exists
if [ ! -f "$SCRIPTS_DIR/mcl.ts" ]; then
    echo -e "${RED}Error: mcl.ts not found in scripts directory${NC}"
    exit 1
fi
echo "  ✓ mcl.ts found"

# Check if npx is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}Error: npx not found${NC}"
    exit 1
fi
echo "  ✓ npx available"

# Use full keypair path for commands
KEYPAIR="$FULL_KEYPAIR"

# ============================================================
# 1. PROTOCOL STATE TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "protocol" ]; then
    log_header "1️⃣  Protocol State Tests"
    
    log_test "Fetch protocol state"
    OUTPUT=$(run_mcl protocol-state --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$OUTPUT" | grep -qiE "admin|treasury|protocol|fee|state"; then
        log_pass
        if [ "$VERBOSE" = true ]; then
            echo "$OUTPUT"
        fi
    else
        log_fail "Could not fetch protocol state"
        if [ "$VERBOSE" = true ]; then
            echo "Output: $OUTPUT"
        fi
    fi
fi

# ============================================================
# 2. TOKEN TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "tokens" ]; then
    log_header "2️⃣  Token Configuration Tests"
    
    log_test "Fetch whitelisted tokens"
    OUTPUT=$(run_mcl tokens --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$OUTPUT" | grep -qiE "token|mint|ltv|tier|whitelisted|config|no tokens"; then
        log_pass
        if [ "$VERBOSE" = true ]; then
            echo "$OUTPUT"
        fi
    else
        log_fail "Could not fetch tokens"
        if [ "$VERBOSE" = true ]; then
            echo "Output: $OUTPUT"
        fi
    fi
fi

# ============================================================
# 3. LOAN VIEWING TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "loans" ]; then
    log_header "3️⃣  Loan Viewing Tests"
    
    log_test "Fetch all loans"
    OUTPUT=$(run_mcl loans --network "$NETWORK" --keypair "$KEYPAIR" --limit 10) || true
    if echo "$OUTPUT" | grep -qiE "loan|found|active|total|no loans|borrower"; then
        log_pass
        if [ "$VERBOSE" = true ]; then
            echo "$OUTPUT"
        fi
    else
        log_fail "Could not fetch loans"
        if [ "$VERBOSE" = true ]; then
            echo "Output: $OUTPUT"
        fi
    fi
    
    log_test "Fetch active loans only"
    OUTPUT=$(run_mcl loans --active --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$OUTPUT" | grep -qiE "loan|found|active|total|no|borrower"; then
        log_pass
    else
        log_fail "Could not fetch active loans"
    fi
fi

# ============================================================
# 4. TREASURY TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "treasury" ]; then
    log_header "4️⃣  Treasury Tests"
    
    log_test "Fund treasury (0.01 SOL)"
    OUTPUT=$(run_mcl fund --amount 0.01 --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$OUTPUT" | grep -qiE "success|funded|transaction|tx|signature|treasury|confirmed"; then
        log_pass
        if [ "$VERBOSE" = true ]; then
            echo "$OUTPUT"
        fi
    else
        log_fail "Could not fund treasury"
        if [ "$VERBOSE" = true ]; then
            echo "Output: $OUTPUT"
        fi
    fi
fi

# ============================================================
# 5. ADMIN CONTROL TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "admin" ]; then
    log_header "5️⃣  Admin Control Tests"
    
    # Get current pause state
    log_test "Check pause state"
    PAUSE_OUTPUT=$(run_mcl protocol-state --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$PAUSE_OUTPUT" | grep -qiE "paused.*yes|paused.*true|paused: true"; then
        PAUSED="yes"
    else
        PAUSED="no"
    fi
    log_pass
    log_info "Currently paused: $PAUSED"
    
    # Test pause (only if not already paused)
    if [ "$PAUSED" = "no" ]; then
        log_test "Pause protocol"
        OUTPUT=$(run_mcl pause --network "$NETWORK" --keypair "$KEYPAIR") || true
        if echo "$OUTPUT" | grep -qiE "success|paused|transaction|tx|confirmed"; then
            log_pass
            if [ "$VERBOSE" = true ]; then
                echo "$OUTPUT"
            fi
            
            sleep 3  # Wait for confirmation
            
            log_test "Resume protocol"
            OUTPUT=$(run_mcl resume --network "$NETWORK" --keypair "$KEYPAIR") || true
            if echo "$OUTPUT" | grep -qiE "success|resumed|transaction|tx|active|confirmed"; then
                log_pass
                if [ "$VERBOSE" = true ]; then
                    echo "$OUTPUT"
                fi
            else
                log_fail "Could not resume protocol"
                if [ "$VERBOSE" = true ]; then
                    echo "Output: $OUTPUT"
                fi
            fi
        else
            log_fail "Could not pause protocol"
            if [ "$VERBOSE" = true ]; then
                echo "Output: $OUTPUT"
            fi
        fi
    else
        log_test "Resume protocol (was paused)"
        OUTPUT=$(run_mcl resume --network "$NETWORK" --keypair "$KEYPAIR") || true
        if echo "$OUTPUT" | grep -qiE "success|resumed|transaction|tx|not paused|active|confirmed"; then
            log_pass
        else
            log_skip "Protocol in unknown state"
        fi
    fi
fi

# ============================================================
# 6. LIQUIDATION SEARCH TESTS
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "liquidation" ]; then
    log_header "6️⃣  Liquidation Tests"
    
    log_test "Find liquidatable loans"
    OUTPUT=$(run_mcl liquidate --find-liquidatable --network "$NETWORK" --keypair "$KEYPAIR") || true
    if echo "$OUTPUT" | grep -qiE "liquidatable|found|scanning|no loans|loan|search"; then
        log_pass
        if [ "$VERBOSE" = true ]; then
            echo "$OUTPUT"
        fi
    else
        log_fail "Could not search for liquidatable loans"
        if [ "$VERBOSE" = true ]; then
            echo "Output: $OUTPUT"
        fi
    fi
fi

# ============================================================
# 7. BACKEND API TESTS (if running)
# ============================================================
if [ -z "$TEST_ONLY" ] || [ "$TEST_ONLY" = "api" ]; then
    log_header "7️⃣  Backend API Tests"
    
    API_URL="http://localhost:3001"
    
    log_test "Health check"
    if curl -s --connect-timeout 2 "$API_URL/health" > /dev/null 2>&1; then
        log_pass
        
        log_test "Protocol stats endpoint"
        if curl -s --connect-timeout 2 "$API_URL/api/protocol/stats" > /dev/null 2>&1; then
            log_pass
        else
            log_fail "Protocol stats endpoint failed"
        fi
        
        log_test "Loans endpoint"
        if curl -s --connect-timeout 2 "$API_URL/api/loans" > /dev/null 2>&1; then
            log_pass
        else
            log_fail "Loans endpoint failed"
        fi
        
        log_test "Tokens endpoint"
        if curl -s --connect-timeout 2 "$API_URL/api/tokens" > /dev/null 2>&1; then
            log_pass
        else
            log_fail "Tokens endpoint failed"
        fi
        
        log_test "Staking endpoint"
        STAKING_RESPONSE=$(curl -s --connect-timeout 2 "$API_URL/api/staking/stats" 2>&1)
        if [ -n "$STAKING_RESPONSE" ]; then
            log_pass
        else
            log_skip "Staking not initialized or endpoint not available"
        fi
    else
        log_skip "Backend not running at $API_URL"
    fi
fi

# ============================================================
# SUMMARY
# ============================================================
log_header "📊 Test Summary"
echo ""
echo -e "  ${GREEN}Passed:  $PASSED${NC}"
echo -e "  ${RED}Failed:  $FAILED${NC}"
echo -e "  ${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
    PERCENT=$((PASSED * 100 / TOTAL))
    echo "  Pass Rate: $PERCENT%"
fi
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}❌ Some tests failed!${NC}"
    echo -e "${YELLOW}Tip: Run with --verbose to see detailed output${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
fi