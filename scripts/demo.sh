#!/bin/bash

# Hyperlane Demo Script
# This script demonstrates the full Hyperlane workflow with enshrined validators

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ORGCHAIN_RPC="http://localhost:26657"
DSTCHAIN_RPC="http://localhost:26659"
ORGCHAIN_REST="http://localhost:1317"
DSTCHAIN_REST="http://localhost:1319"
SIGNER_PORT="8080"

log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}"
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if a port is available
port_available() {
    ! lsof -i:$1 >/dev/null 2>&1
}

# Wait for a service to be ready
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1

    log "Waiting for $name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" >/dev/null 2>&1; then
            success "$name is ready!"
            return 0
        fi
        
        if [ $attempt -eq $max_attempts ]; then
            error "$name failed to start after $max_attempts attempts"
            return 1
        fi
        
        log "Attempt $attempt/$max_attempts - waiting for $name..."
        sleep 2
        attempt=$((attempt + 1))
    done
}

# Cleanup function
cleanup() {
    log "Cleaning up background processes..."
    
    # Kill background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    
    # Wait a moment for processes to terminate
    sleep 2
    
    # Force kill if still running
    pkill -f "orgchaind" 2>/dev/null || true
    pkill -f "dstchaind" 2>/dev/null || true
    pkill -f "signing-daemon" 2>/dev/null || true
    pkill -f "node.*relayer" 2>/dev/null || true
    
    log "Cleanup complete"
}

# Set up trap for cleanup
trap cleanup EXIT

# Setup a single-node validator genesis for dstchain
setup_dstchain_genesis() {
    local home_dir="$HOME/.dstchain"
    local keyname="validator"

    log "Initializing dstchain genesis..."
    dstchaind init demo --chain-id dstchain --home "$home_dir" >/dev/null 2>&1 || true

    if ! dstchaind keys show "$keyname" --keyring-backend test --home "$home_dir" >/dev/null 2>&1; then
        dstchaind keys add "$keyname" --keyring-backend test --home "$home_dir" >/dev/null 2>&1
    fi

    local addr
    addr=$(dstchaind keys show "$keyname" -a --keyring-backend test --home "$home_dir")

    # Add generous balances
    if ! jq -e --arg a "$addr" '.app_state.bank.balances[] | select(.address==$a)' "$home_dir/config/genesis.json" >/dev/null 2>&1; then
        dstchaind genesis add-genesis-account "$addr" 200000000stake,20000000token --home "$home_dir" >/dev/null 2>&1 || true
    fi

    # Create gentx directory fresh and generate
    rm -rf "$home_dir/config/gentx" && mkdir -p "$home_dir/config/gentx"
    dstchaind genesis gentx "$keyname" 100000000stake --chain-id dstchain --keyring-backend test --home "$home_dir" --from "$keyname" --output-document "$home_dir/config/gentx/gentx.json" >/dev/null 2>&1
    dstchaind genesis collect-gentxs --home "$home_dir" >/dev/null 2>&1

    # If staking.validators still empty, patch genesis to include bonded validator
    local validators_count
    validators_count=$(jq '.app_state.staking.validators | length' "$home_dir/config/genesis.json")
    if [ "$validators_count" = "0" ]; then
        log "Patching genesis to inject bonded validator..."
        local valoper
        valoper=$(jq -r '.app_state.genutil.gen_txs[0].body.messages[0].validator_address' "$home_dir/config/genesis.json")
        local cons_key
        cons_key=$(jq -r '.app_state.genutil.gen_txs[0].body.messages[0].pubkey.key' "$home_dir/config/genesis.json")
        local power="100000000"
        local shares="100000000.000000000000000000"
        jq --arg valoper "$valoper" \
           --arg conskey "$cons_key" \
           --arg power "$power" \
           --arg shares "$shares" \
           --arg del "$addr" \
           '.app_state.staking.validators = [
              {
                "operator_address": $valoper,
                "consensus_pubkey": {"@type":"/cosmos.crypto.ed25519.PubKey","key": $conskey},
                "jailed": false,
                "status": "BOND_STATUS_BONDED",
                "tokens": $power,
                "delegator_shares": $shares,
                "description": {"moniker":"demo","identity":"","website":"","security_contact":"","details":""},
                "unbonding_height": "0",
                "unbonding_time": "0001-01-01T00:00:00Z",
                "commission": {"commission_rates": {"rate":"0.100000000000000000","max_rate":"0.200000000000000000","max_change_rate":"0.010000000000000000"}, "update_time":"0001-01-01T00:00:00Z"},
                "min_self_delegation": "1"
              }
            ]
            | .app_state.staking.delegations = [
              {"delegator_address": $del, "validator_address": $valoper, "shares": $shares}
            ]
            | .app_state.staking.last_total_power = $power
            | .app_state.staking.last_validator_powers = [ {"address": $valoper, "power": $power} ]' "$home_dir/config/genesis.json" > "$home_dir/config/genesis.patched.json"
        mv "$home_dir/config/genesis.patched.json" "$home_dir/config/genesis.json"
        success "Genesis patched"
    fi

    success "dstchain genesis initialized with single validator"
}

# Main demo function
main() {
    echo "=========================================="
    echo "  Hyperlane Enshrined Validators Demo"
    echo "=========================================="
    echo ""
    
    # Check prerequisites
    log "Checking prerequisites..."
    
    if ! command_exists "ignite"; then
        error "Ignite CLI not found. Please install Ignite CLI first."
        exit 1
    fi
    
    if ! command_exists "node"; then
        error "Node.js not found. Please install Node.js first."
        exit 1
    fi
    
    if ! command_exists "go"; then
        error "Go not found. Please install Go first."
        exit 1
    fi
    
    success "All prerequisites found"
    
    # Check if ports are available
    log "Checking port availability..."
    
    if ! port_available 26657; then
        error "Port 26657 is already in use (orgchain RPC)"
        exit 1
    fi
    
    if ! port_available 26659; then
        error "Port 26659 is already in use (dstchain RPC)"
        exit 1
    fi
    
    if ! port_available 1317; then
        error "Port 1317 is already in use (orgchain REST)"
        exit 1
    fi
    
    if ! port_available 1319; then
        error "Port 1319 is already in use (dstchain REST)"
        exit 1
    fi
    
    if ! port_available $SIGNER_PORT; then
        error "Port $SIGNER_PORT is already in use (signing daemon)"
        exit 1
    fi
    
    success "All ports are available"
    
    # Build components
    log "Building components..."
    make build
    success "Build complete"
    
    # Start signing daemon
    log "Starting signing daemon..."
    cd signing-daemon
    ./signing-daemon -generate >/dev/null 2>&1
    ./signing-daemon -port $SIGNER_PORT &
    SIGNER_PID=$!
    cd ..
    
    wait_for_service "http://localhost:$SIGNER_PORT/health" "signing daemon"
    
    # Start orgchain (default ports)
    log "Starting orgchain..."
    cd orgchain
    ignite chain serve --reset-once --verbose=false &
    ORGCHAIN_PID=$!
    cd ..
    
    wait_for_service "$ORGCHAIN_RPC/health" "orgchain"
    
    # Prepare and start dstchain on alternate ports
    log "Starting dstchain..."
    cd dstchain
    setup_dstchain_genesis
    dstchaind start \
      --home "$HOME/.dstchain" \
      --with-comet \
      --rpc.laddr tcp://127.0.0.1:26659 \
      --p2p.laddr tcp://0.0.0.0:26658 \
      --api.enable \
      --api.address tcp://0.0.0.0:1319 \
      --grpc.address 0.0.0.0:9091 \
      --minimum-gas-prices 0.001stake &
    DSTCHAIN_PID=$!
    cd ..
    
    wait_for_service "$DSTCHAIN_RPC/health" "dstchain"
    
    # Wait a bit more for chains to fully initialize
    log "Waiting for chains to fully initialize..."
    sleep 10
    
    # Query initial state
    log "Querying initial chain state..."
    
    # Check orgchain status
    if curl -s "$ORGCHAIN_REST/cosmos/base/tendermint/v1beta1/node_info" >/dev/null; then
        success "Orgchain REST API is responding"
    else
        warning "Orgchain REST API not yet ready"
    fi
    
    # Check dstchain status
    if curl -s "$DSTCHAIN_REST/cosmos/base/tendermint/v1beta1/node_info" >/dev/null; then
        success "Dstchain REST API is responding"
    else
        warning "Dstchain REST API not yet ready"
    fi
    
    # Demo complete
    echo ""
    echo "=========================================="
    echo "  Demo Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Services running:"
    echo "  • Orgchain RPC:    $ORGCHAIN_RPC"
    echo "  • Orgchain REST:   $ORGCHAIN_REST"
    echo "  • Dstchain RPC:    $DSTCHAIN_RPC"
    echo "  • Dstchain REST:   $DSTCHAIN_REST"
    echo "  • Signing Daemon:  http://localhost:$SIGNER_PORT"
    echo ""
    echo "Next steps:"
    echo "  1. Register validator attestation keys"
    echo "  2. Send a cross-chain message"
    echo "  3. Start the relayer to process messages"
    echo ""
    echo "Example commands:"
    echo "  # Check signing daemon"
    echo "  curl http://localhost:$SIGNER_PORT/pubkeys"
    echo ""
    echo "  # Query orgchain hyperlane params"
    echo "  curl $ORGCHAIN_REST/enshrined-relayers/orgchain/hyperlane/v1/params"
    echo ""
    echo "  # Query dstchain demo messages"
    echo "  curl $DSTCHAIN_REST/enshrined-relayers/dstchain/demo/v1/payloads"
    echo ""
    echo "Press Ctrl+C to stop all services..."
    
    # Keep running until interrupted
    while true; do
        sleep 1
    done
}

# Run the demo
main "$@"
