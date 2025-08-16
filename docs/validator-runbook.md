# Validator Runbook: Enshrined Validators Setup

This guide walks validators through setting up and operating their signing infrastructure for the Enshrined Validators cross-chain messaging system.

## Overview

As a validator on the origin chain, you provide cross-chain security by signing message attestations. This requires:

1. **Attestation Key Registration**: Register a secp256k1 public key for cross-chain signing
2. **Signing Daemon Setup**: Run a service that signs message digests
3. **Key Management**: Secure storage and rotation of attestation keys
4. **Monitoring**: Track signing activity and system health

## Prerequisites

- Active validator on the origin chain
- Go 1.22+ installed
- Basic understanding of cryptographic key management
- Secure server environment for running signing daemon

## Step 1: Generate Attestation Keys

### Option A: Use the Signing Daemon (Recommended)

```bash
# Download and build the signing daemon
git clone https://github.com/enshrined-relayers/signing-daemon
cd signing-daemon
go build -o signing-daemon cmd/daemon/main.go

# Generate keys for your validator
./signing-daemon -generate -keys my-validator-keys.json
```

This creates a `my-validator-keys.json` file with your attestation keys.

### Option B: Manual Key Generation

```bash
# Generate a secp256k1 private key
openssl ecparam -genkey -name secp256k1 -noout -out private-key.pem

# Extract the public key
openssl ec -in private-key.pem -pubout -out public-key.pem

# Convert to hex format (you'll need a small script for this)
```

### Key Storage Format

The signing daemon expects keys in this JSON format:

```json
{
  "keys": {
    "your-validator-operator-address": "private-key-hex-string"
  }
}
```

**Security Note:** Store this file with restricted permissions (`chmod 600`) and consider using encrypted storage or hardware security modules (HSMs) for production.

## Step 2: Register Your Attestation Key

Register your public key on the origin chain so it can be used for cross-chain verification:

```bash
# Get your compressed public key (33 bytes hex)
curl http://localhost:8080/pubkeys

# Register the key on-chain
orgchaind tx hyperlane register-attestation-key \
  --pubkey 03c4ad76a0c30460f51c418346fe748aea872c179bcdb3de78747118d5d9055461 \
  --from your-validator-key \
  --chain-id orgchain \
  --fees 1000stake
```

**Parameters:**
- `--pubkey`: Your compressed secp256k1 public key (33 bytes, hex-encoded)
- `--from`: Your validator's operator key
- `--chain-id`: The origin chain ID
- `--fees`: Transaction fees

## Step 3: Set Up the Signing Daemon

### Configuration

Create a secure environment for your signing daemon:

```bash
# Create dedicated directory
sudo mkdir -p /opt/hyperlane-signer
sudo chown your-user:your-user /opt/hyperlane-signer
cd /opt/hyperlane-signer

# Copy your keys
cp path/to/my-validator-keys.json ./keys.json
chmod 600 keys.json

# Copy the signing daemon binary
cp path/to/signing-daemon ./signing-daemon
chmod +x signing-daemon
```

### Run the Signing Daemon

```bash
# Start the daemon
./signing-daemon -keys keys.json -port 8080

# Or run as a system service (see systemd section below)
```

**Configuration Options:**
- `-keys string`: Path to key store file (default: "keys.json")
- `-port string`: HTTP port to listen on (default: "8080")

### Test the Setup

```bash
# Check daemon health
curl http://localhost:8080/health

# View your public keys
curl http://localhost:8080/pubkeys

# Test signing (replace with actual values)
curl -X POST http://localhost:8080/sign \
  -H "Content-Type: application/json" \
  -d '{
    "operatorBech32": "your-validator-operator-address",
    "digestHex": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

## Step 4: Systemd Service Setup (Recommended)

Create a systemd service for automatic startup and management:

```bash
# Create service file
sudo tee /etc/systemd/system/hyperlane-signer.service > /dev/null <<EOF
[Unit]
Description=Hyperlane Validator Signing Daemon
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=1
User=your-user
WorkingDirectory=/opt/hyperlane-signer
ExecStart=/opt/hyperlane-signer/signing-daemon -keys keys.json -port 8080
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=hyperlane-signer

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable hyperlane-signer
sudo systemctl start hyperlane-signer

# Check status
sudo systemctl status hyperlane-signer
```

## Step 5: Network Security

### Firewall Configuration

Only allow access from authorized relayers:

```bash
# Allow specific relayer IPs (replace with actual IPs)
sudo ufw allow from 1.2.3.4 to any port 8080
sudo ufw allow from 5.6.7.8 to any port 8080

# Deny all other access
sudo ufw deny 8080
```

### Reverse Proxy (Optional)

Use nginx or similar for additional security:

```nginx
server {
    listen 8080;
    server_name your-server.com;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=signing:10m rate=10r/m;
    limit_req zone=signing burst=5 nodelay;

    location / {
        proxy_pass http://localhost:8081;  # Internal port
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # Additional security headers
        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options DENY;
    }
}
```

## Step 6: Monitoring and Maintenance

### Log Monitoring

Monitor signing daemon logs for errors:

```bash
# View logs
sudo journalctl -u hyperlane-signer -f

# Check for errors
sudo journalctl -u hyperlane-signer --since "1 hour ago" | grep ERROR
```

### Health Checks

Set up automated health monitoring:

```bash
#!/bin/bash
# health-check.sh

ENDPOINT="http://localhost:8080/health"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $ENDPOINT)

if [ $RESPONSE -eq 200 ]; then
    echo "✓ Signing daemon healthy"
    exit 0
else
    echo "✗ Signing daemon unhealthy (HTTP $RESPONSE)"
    exit 1
fi
```

### Performance Monitoring

Track signing activity:

```bash
# Monitor signing requests
tail -f /var/log/syslog | grep hyperlane-signer

# Check system resources
htop
df -h
free -m
```

## Step 7: Key Rotation

### Generate New Keys

```bash
# Generate new attestation keys
./signing-daemon -generate -keys new-keys.json

# Backup old keys
cp keys.json keys-backup-$(date +%Y%m%d).json

# Update keys
cp new-keys.json keys.json
```

### Register New Key On-Chain

```bash
# Register new attestation key
orgchaind tx hyperlane register-attestation-key \
  --pubkey your-new-public-key-hex \
  --from your-validator-key \
  --chain-id orgchain
```

### Update Signing Daemon

```bash
# Restart daemon with new keys
sudo systemctl restart hyperlane-signer

# Verify new keys are active
curl http://localhost:8080/pubkeys
```

## Troubleshooting

### Common Issues

1. **"Private key not found for operator"**
   - Check that your operator address matches the key store
   - Verify key file permissions and format

2. **"Invalid digestHex format"**
   - Ensure digest is exactly 64 hex characters (32 bytes)
   - Check for any whitespace or invalid characters

3. **Connection refused**
   - Verify daemon is running: `sudo systemctl status hyperlane-signer`
   - Check firewall rules and port configuration
   - Ensure daemon is listening on correct port

4. **High CPU/Memory usage**
   - Monitor signing request frequency
   - Check for potential DoS attacks
   - Consider rate limiting

### Debug Commands

```bash
# Check daemon status
sudo systemctl status hyperlane-signer

# View detailed logs
sudo journalctl -u hyperlane-signer -n 100

# Test network connectivity
curl -v http://localhost:8080/health

# Check file permissions
ls -la /opt/hyperlane-signer/

# Monitor system resources
top -p $(pgrep signing-daemon)
```

## Security Best Practices

### Key Management
- Use hardware security modules (HSMs) for production
- Implement regular key rotation (e.g., monthly)
- Store backup keys in secure offline storage
- Never share private keys or expose them in logs

### Network Security
- Run signing daemon on isolated network segments
- Use VPN or private networks for relayer communication
- Implement IP whitelisting and rate limiting
- Monitor for unusual signing patterns or unauthorized access

### Operational Security
- Regular security updates for the signing daemon
- Monitor validator performance and signing participation
- Implement alerting for signing failures or downtime
- Maintain incident response procedures

### Backup and Recovery
- Regular backups of key stores and configuration
- Test recovery procedures periodically
- Document emergency contact procedures
- Maintain offline backup of critical keys

## Support

For technical support:

1. Check the [troubleshooting section](#troubleshooting) above
2. Review logs for specific error messages
3. Consult the [project documentation](../README.md)
4. Open an issue on the project repository

## Emergency Procedures

### Validator Key Compromise

1. **Immediate Actions:**
   - Stop the signing daemon immediately
   - Rotate validator consensus keys if needed
   - Generate new attestation keys
   - Register new attestation key on-chain

2. **Investigation:**
   - Review access logs and system logs
   - Identify potential attack vectors
   - Assess scope of compromise

3. **Recovery:**
   - Deploy new signing infrastructure
   - Update security measures
   - Resume signing operations
   - Monitor for continued threats

### Signing Daemon Failure

1. **Quick Recovery:**
   ```bash
   # Restart service
   sudo systemctl restart hyperlane-signer
   
   # Check for immediate issues
   sudo systemctl status hyperlane-signer
   ```

2. **Fallback Options:**
   - Manual signing (temporary)
   - Backup signing infrastructure
   - Key recovery from secure storage

Remember: The security of cross-chain messages depends on your vigilant operation of the signing infrastructure. Always prioritize security over convenience.
