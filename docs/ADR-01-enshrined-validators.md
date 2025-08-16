# ADR-01: Enshrined Validators as Interchain Security Module

## Status

Accepted

## Context

Cross-chain messaging protocols require a security mechanism to verify that messages originated from the claimed source chain. Traditional approaches include:

1. **External Validator Sets**: Dedicated validators for cross-chain verification (e.g., IBC)
2. **Optimistic Verification**: Assume validity with challenge periods (e.g., Optimism)
3. **Committee-based**: Trusted multi-signature schemes (e.g., early bridges)
4. **Light Clients**: On-chain verification of source chain state (e.g., IBC light clients)

Each approach has trade-offs in terms of security, cost, complexity, and trust assumptions.

## Decision

We implement an **Enshrined Validators** approach where the origin chain's existing validator set serves as the Interchain Security Module (ISM) for cross-chain message verification.

### Key Design Principles

1. **Reuse Existing Security**: Leverage the economic security already established by the origin chain's validators
2. **No Additional Staking**: Validators don't need to stake additional tokens for cross-chain security
3. **Deterministic Verification**: Message validity is determined by cryptographic proofs, not governance
4. **Gas Efficiency**: Minimize on-chain verification costs through batch signatures

### Architecture Components

#### 1. Validator Set Snapshots

The origin chain periodically creates snapshots of its validator set:

```go
type ValsetSnapshot struct {
    ID      uint64             // Unique snapshot identifier
    Height  int64              // Block height of snapshot
    Hash    []byte             // Deterministic hash of validator set
    Signers []ValsetSigner     // Validator information for verification
}

type ValsetSigner struct {
    Operator          string  // Validator operator address
    AttestationPubkey []byte  // Public key for cross-chain signing
    Power             int64   // Voting power
}
```

**Snapshot Triggers:**
- Every `EpochLength` blocks (default: 100)
- On validator set changes (bonding/unbonding/slashing)

#### 2. Message Attestation

Cross-chain messages are attested using secp256k1 multisig:

```go
type HyperlaneMessage struct {
    OriginChainID     string  // Source chain identifier
    DestChainID       string  // Destination chain identifier  
    Nonce             uint64  // Replay protection nonce
    SenderModule      string  // Originating module
    RecipientModule   string  // Destination module
    Body              []byte  // Message payload
    ValsetID          uint64  // Validator set for verification
}
```

**Canonical Encoding:**
Messages are deterministically encoded for signing:
1. Origin chain ID (length-prefixed string)
2. Destination chain ID (length-prefixed string)  
3. Nonce (8 bytes big-endian)
4. Sender module (length-prefixed string)
5. Recipient module (length-prefixed string)
6. Body (length-prefixed bytes)
7. Valset ID (8 bytes big-endian)

#### 3. Verification Process

The destination chain verifies messages using:

```go
type MessageProof struct {
    Bitmap     []byte    // Validator participation bitmap
    Signatures [][]byte  // Individual secp256k1 signatures
}
```

**Verification Steps:**
1. Load validator set snapshot by ID
2. Recompute message digest using canonical encoding
3. Verify each signature against corresponding validator public key
4. Check that signing validators meet threshold (default: 2/3 voting power)
5. Verify replay protection (nonce and consumption tracking)

#### 4. Threshold Security

Quorum is determined by voting power percentage:
- **Threshold**: `ThresholdNumerator / ThresholdDenominator` (default: 2/3)
- **Validator Ordering**: Deterministic sorting by operator address bytes
- **Bitmap Indexing**: Bit position corresponds to sorted validator index

## Security Analysis

### Assumptions

1. **Honest Majority**: >1/3 of validators (by voting power) are honest
2. **Key Security**: Validator attestation keys are not compromised  
3. **Canonical Encoding**: All participants use identical message encoding
4. **Snapshot Integrity**: Validator set snapshots are accurate and tamper-proof

### Threat Model

**Attacks Considered:**
- **Message Forgery**: Malicious actors creating fake cross-chain messages
- **Replay Attacks**: Reusing valid messages multiple times
- **Validator Key Compromise**: Attackers gaining access to signing keys
- **Chain Reorganization**: Origin chain history being rewritten

**Mitigations:**
- **Cryptographic Proofs**: Messages require valid multisig from 2/3+ validators
- **Nonce Tracking**: Per-route nonces prevent replay attacks
- **Key Rotation**: Validators can update attestation keys
- **Finality**: Only process messages from finalized blocks

### Security Properties

1. **Safety**: Invalid messages cannot be verified (assuming honest majority)
2. **Liveness**: Valid messages will eventually be processed (assuming relayer availability)
3. **Censorship Resistance**: No single party can block message processing
4. **Non-repudiation**: Validator signatures provide cryptographic proof of attestation

### Comparison with Alternatives

| Approach | Security Source | Trust Assumptions | Cost | Complexity |
|----------|----------------|-------------------|------|------------|
| **Enshrined Validators** | Origin chain validators | Honest majority | Low | Medium |
| **IBC Light Clients** | Cryptographic proofs | Light client correctness | High | High |
| **Optimistic** | Economic incentives | Fraud proof viability | Medium | Medium |
| **External Committee** | Dedicated validators | Committee honesty | Medium | Low |

### Known Limitations

1. **No Slashing**: Validators can't be penalized for invalid signatures in this MVP
2. **Key Management**: Attestation keys stored separately from consensus keys
3. **Synchrony Assumptions**: Relayers must process messages within reasonable time
4. **Scalability**: Signature verification cost grows with validator set size

## Implementation Details

### Parameters

```go
type Params struct {
    EpochLength          uint64  // Blocks between snapshots (default: 100)
    ThresholdNumerator   int64   // Quorum numerator (default: 2)
    ThresholdDenominator int64   // Quorum denominator (default: 3)  
    MaxBodyBytes         uint64  // Message size limit (default: 32KB)
}
```

### Events

**Origin Chain:**
```go
// Emitted when validator set snapshot is created
type EventValsetSnapshot struct {
    ID     uint64  // Snapshot ID
    Height int64   // Block height
    Hash   string  // Hex-encoded snapshot hash
}

// Emitted when cross-chain message is sent
type EventHyperlaneSend struct {
    Route           string  // "origin|dest|recipient"
    Nonce           uint64  // Message nonce
    ValsetID        uint64  // Validator set ID
    DigestHex       string  // Message digest
    RecipientModule string  // Destination module
}
```

**Destination Chain:**
```go
// Emitted when message is successfully delivered
type EventHyperlaneDeliver struct {
    Route     string  // "origin|dest|recipient"  
    Nonce     uint64  // Message nonce
    ValsetID  uint64  // Validator set ID
    MetQuorum bool    // Whether quorum was achieved
}
```

### State Schema

**Origin Chain Storage:**
- `valset_snapshots/{id}` → `ValsetSnapshot`
- `attestation_keys/{operator}` → `[]byte` (public key)
- `route_nonces/{route}` → `uint64` (next nonce)
- `next_valset_id` → `uint64` (next snapshot ID)

**Destination Chain Storage:**
- `valset_snapshots/{id}` → `ValsetSnapshot` (same as origin)
- `consumed_nonces/{route}/{nonce}` → `bool` (replay protection)
- `route_nonces/{route}` → `uint64` (expected next nonce)

## Future Enhancements

### Short Term
1. **BLS Signatures**: Aggregate signatures for efficiency
2. **Slashing Module**: Penalize validators for invalid attestations
3. **Key Rotation**: Streamlined process for updating attestation keys
4. **Advanced Relayer**: Economic incentives and MEV protection

### Long Term  
1. **Optimistic ISM**: Hybrid approach with challenge periods
2. **ZK Proofs**: Zero-knowledge verification of validator sets
3. **EVM Compatibility**: Deploy as Ethereum L2 or sidechain
4. **Multi-hop Routing**: Cross-chain messages through intermediate chains

## Alternatives Considered

### 1. IBC Light Clients
**Pros:** Trustless, proven security model  
**Cons:** High complexity, expensive verification, hard to upgrade

### 2. Optimistic Verification
**Pros:** Low cost, simple implementation  
**Cons:** Long latency, requires economic security, complex fraud proofs

### 3. External Validator Committee
**Pros:** Simple, flexible  
**Cons:** Additional trust assumptions, validator management overhead

### 4. Threshold Signatures (BLS)
**Pros:** Constant-size signatures, efficient verification  
**Cons:** Complex setup, key management challenges

## Conclusion

The Enshrined Validators approach provides a pragmatic balance between security, cost, and complexity for cross-chain messaging. By reusing existing validator infrastructure, we minimize additional trust assumptions while maintaining strong cryptographic security guarantees.

The MVP implementation establishes the core primitives needed for secure cross-chain communication, with clear paths for future enhancements as the ecosystem matures.

## References

- [Hyperlane Whitepaper](https://hyperlane.xyz/docs)
- [Cosmos IBC Specification](https://github.com/cosmos/ibc)  
- [Ethereum 2.0 Specification](https://github.com/ethereum/consensus-specs)
- [Practical Byzantine Fault Tolerance](http://pmg.csail.mit.edu/papers/osdi99.pdf)
