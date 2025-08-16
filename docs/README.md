# Enshrined Validators Hyperlane (Docs)

Validators are BOTH ISM signers and authorized relayers. The origin chain’s bonded validator set is enshrined to attest to cross-chain messages and (during DeliveryWindow/GraceWindow) authorize which relayer can deliver.

## Deterministic Rules

- Snapshots: origin `x/hyperlane` snapshots bonded validators on set changes or every `EpochLength` blocks.
- Digest (message): canonical concatenation of fields, length-prefixed for strings/bytes, fixed 8-byte BE for uint64 (prefixed with 0x08), then sha256.
- Quorum: multisig ≥ `ThresholdNumerator/ThresholdDenominator` of voting power (default 2/3).
- Windows (dstchain):
  - DeliveryWindow (blocks): only responsible relayer allowed.
  - GraceWindow: any validator relayer allowed if `ValidatorOnlyBeforeGrace`.
  - After Grace: outsiders allowed optionally.
- Fees & Misses: payout split by role and lateness; `MissCount` increments for late delivery by non-responsible validator.
- Replay protection: per-route nonces; consumed set; size caps; deterministic encoding.

## Demo Steps

Start chains (separate terminals):

```bash
# orgchain
cd orgchain && ignite chain serve

# dstchain (port-prefix +1)
cd dstchain && ignite chain serve --port-prefix 1
```

Start signing daemon and relayer:

```bash
# signing daemon
cd signing-daemon
./signing-daemon -generate
./signing-daemon

# relayer
cd ../relayer
cp env.example .env
npm run build && npm start
```

Register validator attestation key (orgchain):

```bash
orgchaind tx hyperlane register-attestation-key \
  <hex_compressed_pubkey_33B> \
  --from <validator-operator> --chain-id orgchain --fees 1000stake
```

Send a message (orgchain):

```bash
orgchaind tx hyperlane send-message \
  --dest-chain-id dstchain \
  --recipient-module demo \
  --body '"hello world"' \
  --from <sender> --chain-id orgchain --fees 1000stake
```

Query on dstchain:

```bash
dstchaind q demo last-payload -o json
dstchaind q demo all-payloads -o json
```
