# Risks & Mitigations

## Censorship / Assignment Gaming
- Risk: Responsible relayer withholds delivery.
- Mitigation: Short DeliveryWindow; allow any validator in GraceWindow; outsider backstop after grace.

## Withholding / Liveness
- Risk: Validators refuse to sign.
- Mitigation: Off-chain incentives; monitoring; fallback delivery by others after grace.

## Desynchronization
- Risk: Snapshot mismatch.
- Mitigation: Snapshot binding (Option A); governance to resync snapshot; explicit MsgPostSnapshot (future).

## Malleability & Replay
- Risk: Modified payloads or replays.
- Mitigation: Deterministic digest; per-route nonce; consumed markers; size caps.

## Parameter Tuning
- DeliveryWindow small (e.g., 5 blocks); GraceWindow moderate (e.g., 20 blocks).
- Threshold 2/3; MaxBodyBytes 32KB.
- Payouts: Responsible 100, OtherValidator 50, Outsider 25.

## Key Management
- Risk: Attestation key compromise.
- Mitigation: Rotation procedure; HSM; mTLS for signer; firewall allowlist.

## Future Enhancements
- MsgPostSnapshot with ≥2/3 attestation (Option B).
- Slashing for invalid attestations.
- Optimistic ISM with challenge window.
