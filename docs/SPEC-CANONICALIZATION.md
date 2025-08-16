# Canonicalization Spec

This document defines the exact encoding for InterchainMessage and SnapshotHash and the bitmap/signature alignment.

## InterchainMessage Encoding

Field order and encoding:

1) OriginChainID (string) — uvarint(len) || bytes
2) DestChainID (string) — uvarint(len) || bytes
3) Nonce (uint64) — 0x08 || big-endian 8 bytes
4) SenderModule (string) — uvarint(len) || bytes
5) RecipientModule (string) — uvarint(len) || bytes
6) Body (bytes) — uvarint(len) || bytes
7) ValsetID (uint64) — 0x08 || big-endian 8 bytes

Digest = sha256(concat(fields)).

## SnapshotHash

- Sort validators by `[]byte(operator)` ascending.
- For each signer: concat uvarint(len)||operator_bytes, uvarint(len)||attestation_pubkey, 0x08||power(8B BE).
- Hash = sha256(concat(all_signers)).

## Bitmap Ordering & Signatures

- Bitmap bit index corresponds to sorted signer index (as above).
- For each set bit, one signature appears in order.
- Verify each signature against the corresponding attestation pubkey.

## Test Vectors (Go/TS Parity)

Provide hex fixtures for implementers to cross-check:

```
Message fields:
Origin: "orgchain"
Dest:   "dstchain"
Recipient: "demo"
Nonce:  0x0000000000000001
Valset: 0x0000000000000002
Body:   0x68656c6c6f

Digest (hex): <fill after running tests>
```

```
Snapshot signers (operator, pubkey, power):
- op1, 02..., 10
- op2, 03..., 20

SnapshotHash (hex): <fill after running tests>
```
