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

# Large amounts to satisfy power reduction (kept for potential future direct starts)
STAKE_FUND="2000000000000000000stake"
STAKE_SELF="1000000000000000000stake"
STAKE_TOKENS="1000000000000000000"
STAKE_SHARES="1000000000000000000.000000000000000000"

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

# Patch dstchain app/config to use alternate ports
patch_dstchain_ports() {
    local home_dir="$HOME/.ignite-dstchain"
    local cfg="$home_dir/config/config.toml"
    local app="$home_dir/config/app.toml"
    if [ -f "$cfg" ]; then
        sed -i '' 's#^laddr = \"tcp://0.0.0.0:26657\"#laddr = \"tcp://127.0.0.1:26659\"#' "$cfg" || true
        sed -i '' 's#^laddr = \"tcp://0.0.0.0:26656\"#laddr = \"tcp://0.0.0.0:26658\"#' "$cfg" || true
    fi
    if [ -f "$app" ]; then
        sed -i '' 's#^address = \"tcp://0.0.0.0:1317\"#address = \"tcp://0.0.0.0:1319\"#' "$app" || true
        sed -i '' 's#^address = \"localhost:9090\"#address = \"0.0.0.0:9091\"#' "$app" || true
    fi
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
    
    # Start dstchain using ignite with a separate home, then patch ports
    log "Starting dstchain..."
    cd dstchain
    ignite chain serve --reset-once --home "$HOME/.ignite-dstchain" --verbose=false &
    DSTCHAIN_IGNITE_PID=$!
    # wait a bit for files to exist then patch ports and restart
    sleep 5
    patch_dstchain_ports
    # stop ignite-managed process and restart with patched configs
    kill $DSTCHAIN_IGNITE_PID >/dev/null 2>&1 || true
    sleep 2
    dstchaind start --home "$HOME/.ignite-dstchain" &
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
