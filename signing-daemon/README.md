# Validator Signing Daemon

A simple HTTP server that provides message signing services for Hyperlane validators using secp256k1 keys.

## Overview

The signing daemon manages validator private keys and provides a simple HTTP API for signing 32-byte message digests. It's designed to be run by each validator operator to provide attestation signatures for cross-chain messages.

## Features

- HTTP API for signing message digests
- Secure key storage in JSON format
- Health check endpoint
- Public key listing endpoint
- Sample key generation for testing

## Installation

```bash
cd signing-daemon
go mod tidy
go build -o signing-daemon cmd/daemon/main.go
```

## Usage

### Generate Sample Keys

```bash
./signing-daemon -generate -keys keys.json
```

This creates a `keys.json` file with sample validator keys for testing.

### Start the Daemon

```bash
./signing-daemon -keys keys.json -port 8080
```

### API Endpoints

#### POST /sign

Sign a 32-byte digest with a validator's private key.

**Request:**
```json
{
  "operatorBech32": "orgvaloper1abcdefghijklmnopqrstuvwxyz123456789",
  "digestHex": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
}
```

**Response:**
```json
{
  "signature": "base64-encoded-signature"
}
```

**Error Response:**
```json
{
  "error": "error message"
}
```

#### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "service": "signing-daemon"
}
```

#### GET /pubkeys

List all public keys for registered validators.

**Response:**
```json
{
  "publicKeys": {
    "orgvaloper1...": "hex-encoded-compressed-pubkey",
    "orgvaloper2...": "hex-encoded-compressed-pubkey"
  }
}
```

## Key Store Format

The key store is a JSON file with the following format:

```json
{
  "keys": {
    "orgvaloper1abcdefghijklmnopqrstuvwxyz123456789": "private_key_hex_1",
    "orgvaloper2bcdefghijklmnopqrstuvwxyz1234567890": "private_key_hex_2"
  }
}
```

## Security Considerations

- **Private Key Storage**: Keys are stored in plain text in the JSON file. In production, consider using hardware security modules (HSMs) or encrypted storage.
- **File Permissions**: The key store file should have restricted permissions (0600) to prevent unauthorized access.
- **Network Security**: The daemon should be run behind a firewall and accessed only by authorized relayers.
- **Key Rotation**: Implement proper key rotation procedures for production use.

## Configuration

### Command Line Options

- `-keys string`: Path to the key store file (default: "keys.json")
- `-port string`: Port to listen on (default: "8080")
- `-generate`: Generate sample keys and exit

### Environment Variables

Currently, all configuration is done via command line flags. Environment variable support can be added if needed.

## Development

### Running Tests

```bash
go test ./...
```

### Code Structure

```
signing-daemon/
├── cmd/daemon/          # Main application
│   └── main.go
├── internal/keys/       # Key management
│   └── keys.go
├── README.md
└── go.mod
```

## Production Deployment

1. Generate or import validator private keys
2. Secure the key store file with appropriate permissions
3. Run the daemon on a secure network
4. Configure firewall rules to allow access only from authorized relayers
5. Monitor the service for availability and security

## Example Usage

1. Generate test keys:
```bash
./signing-daemon -generate
```

2. Start the daemon:
```bash
./signing-daemon -port 8080
```

3. Test signing:
```bash
curl -X POST http://localhost:8080/sign \
  -H "Content-Type: application/json" \
  -d '{
    "operatorBech32": "orgvaloper1abcdefghijklmnopqrstuvwxyz123456789",
    "digestHex": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

4. Check health:
```bash
curl http://localhost:8080/health
```

5. List public keys:
```bash
curl http://localhost:8080/pubkeys
```
