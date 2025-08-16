# Validator Runbook

## Register Attestation Key (orgchain)

1. Generate compressed secp256k1 pubkey (33 bytes).
2. Register:

```bash
orgchaind tx hyperlane register-attestation-key \
  <hex_compressed_pubkey_33B> \
  --from <validator-operator> --chain-id orgchain --fees 1000stake
```

## Signing Daemon

```bash
cd signing-daemon
./signing-daemon -generate        # creates keys.json (dev only)
./signing-daemon                  # starts HTTP on :8080
```

POST /sign:

```json
{
  "operatorBech32": "orgvaloper1...",
  "digestHex": "<64-hex-bytes>"
}
```

Response:

```json
{ "signature": "<base64>" }
```

mTLS: TODO, deploy behind firewall; allowlist relayer IPs.

## Relayer

```bash
cd relayer
cp env.example .env
npm run build && npm start
```

Configure:
- ORGCHAIN_RPC/REST, DSTCHAIN_RPC/REST
- RELAYER_MNEMONIC
- VALIDATOR_SIGNERS=http://signer1:8080,...

## Key Management & Rotation

- Keep keys.json secure (dev only). For production, use HSM or KMS.
- Rotate keys by generating a new key, updating on-chain attestation key, and updating signer.

## Delegating Relayer

- Set relayer address mapping on dstchain (MsgSetRelayerAddress, TBD) or share relayer mnemonic with trusted party.
