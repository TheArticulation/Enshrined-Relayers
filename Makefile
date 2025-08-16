.PHONY: build clean demo test help

# Default target
all: build

# Build all components
build:
	@echo "Building all components..."
	@cd orgchain && ignite chain build
	@cd dstchain && ignite chain build
	@cd relayer && npm install && npm run build
	@cd signing-daemon && go build -o signing-daemon cmd/daemon/main.go
	@echo "Build complete!"

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@cd orgchain && rm -rf ~/.orgchain
	@cd dstchain && rm -rf ~/.dstchain
	@cd relayer && rm -rf dist node_modules
	@cd signing-daemon && rm -f signing-daemon keys.json
	@echo "Clean complete!"

# Run the full demo
demo: build
	@echo "Starting Hyperlane demo..."
	@echo "This will start both chains, generate keys, and run a sample message flow"
	@./scripts/demo.sh

# Run tests
test:
	@echo "Running tests..."
	@cd orgchain && go test ./x/hyperlane/...
	@cd dstchain && go test ./x/hyperlane/... ./x/demo/...
	@cd relayer && npm test || echo "No tests configured yet"
	@cd signing-daemon && go test ./...

# Generate validator keys
generate-keys:
	@echo "Generating validator keys..."
	@cd signing-daemon && ./signing-daemon -generate
	@echo "Keys generated in signing-daemon/keys.json"

# Start orgchain in development mode
start-orgchain:
	@echo "Starting orgchain..."
	@cd orgchain && ignite chain serve --reset-once

# Start dstchain in development mode
start-dstchain:
	@echo "Starting dstchain..."
	@cd dstchain && ignite chain serve --reset-once --port-prefix 1

# Start signing daemon
start-signer:
	@echo "Starting signing daemon..."
	@cd signing-daemon && ./signing-daemon -generate && ./signing-daemon

# Start relayer
start-relayer:
	@echo "Starting relayer..."
	@cd relayer && npm run start

# Check if chains are running
health-check:
	@echo "Checking chain health..."
	@curl -s http://localhost:26657/health || echo "orgchain not running"
	@curl -s http://localhost:26659/health || echo "dstchain not running"
	@curl -s http://localhost:8080/health || echo "signing daemon not running"

# Show help
help:
	@echo "Available targets:"
	@echo "  build          - Build all components"
	@echo "  clean          - Clean build artifacts and reset chains"
	@echo "  demo           - Run the full demo (builds and starts everything)"
	@echo "  test           - Run tests for all components"
	@echo "  generate-keys  - Generate validator keys for signing daemon"
	@echo "  start-orgchain - Start orgchain in development mode"
	@echo "  start-dstchain - Start dstchain in development mode"
	@echo "  start-signer   - Start signing daemon"
	@echo "  start-relayer  - Start relayer"
	@echo "  health-check   - Check if all services are running"
	@echo "  help           - Show this help message"
