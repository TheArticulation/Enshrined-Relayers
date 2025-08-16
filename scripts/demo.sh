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

# Configuration: dstchain uses default ports, orgchain uses alternate ports
DSTCHAIN_RPC="http://localhost:26657"
DSTCHAIN_REST="http://localhost:1317"
ORGCHAIN_RPC="http://localhost:26659"
ORGCHAIN_REST="http://localhost:1319"
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

# Initialize and start orgchain directly on alternate ports
start_orgchain_direct() {
    local home_dir="$HOME/.orgchain-alt"
    local keyname="validator"

    log "Initializing orgchain (direct) genesis..."
    orgchaind init demo --chain-id orgchain --home "$home_dir" >/dev/null 2>&1 || true

    if ! orgchaind keys show "$keyname" --keyring-backend test --home "$home_dir" >/dev/null 2>&1; then
        orgchaind keys add "$keyname" --keyring-backend test --home "$home_dir" >/dev/null 2>&1
    fi

    local addr
    addr=$(orgchaind keys show "$keyname" -a --keyring-backend test --home "$home_dir")

    # Add generous balances
    orgchaind genesis add-genesis-account "$addr" 200000000stake,20000000token --home "$home_dir" --append >/dev/null 2>&1 || true

    # Generate validator gentx and collect
    rm -rf "$home_dir/config/gentx" && mkdir -p "$home_dir/config/gentx"
    orgchaind genesis gentx "$keyname" 100000000stake --chain-id orgchain --keyring-backend test --home "$home_dir" --from "$keyname" --output-document "$home_dir/config/gentx/gentx.json" >/dev/null 2>&1
    orgchaind genesis collect-gentxs --home "$home_dir" >/dev/null 2>&1

    # Patch ports and min gas price
    local cfg="$home_dir/config/config.toml"
    local app="$home_dir/config/app.toml"
    if [ -f "$cfg" ]; then
        sed -i '' 's#^laddr = \"tcp://0.0.0.0:26657\"#laddr = \"tcp://127.0.0.1:26659\"#' "$cfg" || true
        sed -i '' 's#^laddr = \"tcp://0.0.0.0:26656\"#laddr = \"tcp://0.0.0.0:26658\"#' "$cfg" || true
    fi
    if [ -f "$app" ]; then
        sed -i '' 's#^address = \"tcp://0.0.0.0:1317\"#address = \"tcp://0.0.0.0:1319\"#' "$app" || true
        sed -i '' 's#^address = \"localhost:9090\"#address = \"0.0.0.0:9091\"#' "$app" || true
        if grep -q '^minimum-gas-prices' "$app"; then
            sed -i '' 's#^minimum-gas-prices = ".*"#minimum-gas-prices = "0.001stake"#' "$app" || true
        else
            echo 'minimum-gas-prices = "0.001stake"' >> "$app"
        fi
    fi

    log "Starting orgchain (direct) on alternate ports..."
    orgchaind start --home "$home_dir" --minimum-gas-prices 0.001stake &
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
    
    # dstchain defaults
    if ! port_available 26657; then
        error "Port 26657 is already in use (dstchain RPC)"
        exit 1
    fi
    if ! port_available 1317; then
        error "Port 1317 is already in use (dstchain REST)"
        exit 1
    fi
    # orgchain alternates
    if ! port_available 26659; then
        error "Port 26659 is already in use (orgchain RPC)"
        exit 1
    fi
    if ! port_available 1319; then
        error "Port 1319 is already in use (orgchain REST)"
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
    
    # Start dstchain first via ignite serve (default ports)
    log "Starting dstchain (ignite serve)..."
    cd dstchain
    ignite chain serve --reset-once --verbose=false &
    DSTCHAIN_IGNITE_PID=$!
    cd ..
    
    wait_for_service "$DSTCHAIN_RPC/health" "dstchain"
    
    # Start orgchain directly on alternate ports
    log "Starting orgchain (direct)..."
    start_orgchain_direct
    ORGCHAIN_PID=$!
    
    wait_for_service "$ORGCHAIN_RPC/health" "orgchain"
    
    # Wait a bit more for chains to fully initialize
    log "Waiting for chains to fully initialize..."
    sleep 10
    
    # Query initial state
    log "Querying initial chain state..."
    
    # Check dstchain status
    if curl -s "$DSTCHAIN_REST/cosmos/base/tendermint/v1beta1/node_info" >/dev/null; then
        success "Dstchain REST API is responding"
    else
        warning "Dstchain REST API not yet ready"
    fi
    
    # Check orgchain status
    if curl -s "$ORGCHAIN_REST/cosmos/base/tendermint/v1beta1/node_info" >/dev/null; then
        success "Orgchain REST API is responding"
    else
        warning "Orgchain REST API not yet ready"
    fi
    
    # Demo complete
    echo ""
    echo "=========================================="
    echo "  Demo Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Services running:"
    echo "  • Dstchain RPC:    $DSTCHAIN_RPC"
    echo "  • Dstchain REST:   $DSTCHAIN_REST"
    echo "  • Orgchain RPC:    $ORGCHAIN_RPC"
    echo "  • Orgchain REST:   $ORGCHAIN_REST"
    echo "  • Signing Daemon:  http://localhost:$SIGNER_PORT"
    echo ""
    echo "Next steps:"
    echo "  1. Register validator attestation keys on orgchain"
    echo "  2. Send a cross-chain message from orgchain"
    echo "  3. Start the relayer to process messages to dstchain"
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
