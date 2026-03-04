# Relayer Specification — Proof-Only Architecture

## Overview

The relayer is a **stateless, proof-only** component that forwards signed attestations between Solana and DecentralChain. It has **no custody, no signing authority, and no special privileges**. All validation happens on-chain.

## Design Principles

1. **Zero Trust:** The relayer cannot forge, modify, or replay messages. On-chain contracts verify all proofs.
2. **Stateless:** Relayer state can be wiped and rebuilt from chain data at any time.
3. **Replaceable:** Any party can run a relayer. Multiple relayers improve liveness but cannot affect safety.
4. **Observable:** Every relayer action produces on-chain events that monitors can verify.

## Architecture

```
┌─────────────────────────────────────────────┐
│                  RELAYER                      │
│                                              │
│  ┌────────────┐    ┌────────────────────┐   │
│  │ SOL Watcher │    │ DCC Watcher        │   │
│  │             │    │                    │   │
│  │ Subscribe   │    │ Poll /state and    │   │
│  │ to program  │    │ /transactions      │   │
│  │ logs via    │    │ endpoints          │   │
│  │ WebSocket   │    │                    │   │
│  └─────┬──────┘    └─────────┬──────────┘   │
│        │                     │               │
│  ┌─────▼─────────────────────▼──────────┐   │
│  │         Attestation Collector         │   │
│  │                                       │   │
│  │  Wait for finality (32+ confirmations)│   │
│  │  Collect M-of-N validator signatures  │   │
│  │  Bundle into transaction              │   │
│  └─────────────────┬───────────────────┘   │
│                    │                        │
│  ┌─────────────────▼───────────────────┐   │
│  │         Transaction Submitter        │   │
│  │                                       │   │
│  │  Submit to destination chain          │   │
│  │  Retry with exponential backoff       │   │
│  │  Report success/failure metrics       │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## Flow: SOL → DCC (Deposit → Mint)

```
1. SOL Watcher detects BridgeDeposit event
2. Wait for ≥32 Solana confirmations (finality)
3. Re-verify transaction exists at finalized commitment
4. Request signatures from validator consensus:
   - Send (transfer_id, amount, recipient, slot) to each validator
   - Each validator independently verifies the deposit
   - Each validator signs the canonical mint message
5. Collect ≥M signatures
6. Submit mintToken() to DCC with:
   - transferId, recipient, amount, solSlot, splMint
   - signatures: List[ByteVector]
   - pubkeys: List[ByteVector]
7. DCC contract verifies on-chain (sigVerify per validator)
8. If amount ≥ largeTxThreshold: mint is delayed, relayer logs pending
9. Report success metrics
```

## Flow: DCC → SOL (Burn → Unlock)

```
1. DCC Watcher detects new burn_{burnId} state key
2. Wait for DCC finality (confirmations)
3. Re-verify burn record in chain state
4. Parse burn record: sender|solRecipient|splMint|amount|height|timestamp
5. Request signatures from validator consensus:
   - Send (transfer_id, recipient, amount, burn_tx_hash) to each validator
   - Each validator independently verifies the burn
   - Each validator signs the canonical unlock message
6. Collect ≥M signatures
7. Build Solana transaction:
   a. For each attestation, add Ed25519SigVerify precompile instruction
   b. Add unlock instruction with all attestations
8. Submit atomic transaction to Solana
9. If amount ≥ large_withdrawal_threshold: record is scheduled, not executed
10. Report success metrics
```

## Ed25519 Transaction Construction

```typescript
// For each validator attestation:
const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
  publicKey: attestation.validatorPubkey.toBytes(),
  message: unlockMessage,
  signature: attestation.signature,
});

// Bundle all Ed25519 ixs before the unlock ix
const tx = new Transaction()
  .add(ed25519Ix_1)
  .add(ed25519Ix_2)
  .add(ed25519Ix_3) // M attestations
  .add(unlockIx);    // The actual unlock instruction

// Ed25519 ixs are verified by the native precompile
// unlock instruction introspects preceding ixs to confirm
```

## Relayer DOES NOT:

- Hold any private keys with signing authority
- Have custody of any funds
- Make authorization decisions
- Store permanent state (recoverable from chain)
- Have any special on-chain privileges

## Relayer DOES:

- Watch both chains for events
- Wait for finality before requesting attestations
- Collect M-of-N validator signatures
- Construct and submit proof transactions
- Retry failed submissions with exponential backoff
- Report metrics (latency, success rate, pending count)

## Failure Modes

| Failure | Impact | Recovery |
|---------|--------|----------|
| Relayer down | Liveness loss (no new mints/unlocks) | Start another relayer; pending events processed |
| Relayer submits bad tx | Transaction reverts on-chain | No safety impact; retry with correct data |
| Relayer compromised | Cannot forge proofs (on-chain verification) | Replace relayer; bridge safety unaffected |
| Validator unreachable | Cannot collect M signatures | Wait for validator recovery; other validators still available |
| Duplicate submission | PDA/state key prevents replay | Second tx fails; no double-spend |

## Retry Strategy

```
Attempt 1: Immediate
Attempt 2: 5 seconds
Attempt 3: 15 seconds
Attempt 4: 45 seconds
Attempt 5: 2 minutes
Attempt 6: 5 minutes
...
Max backoff: 10 minutes
Max attempts: 20
Then: Alert, move to dead letter queue for manual review
```

## Monitoring

| Metric | Alert Threshold |
|--------|----------------|
| Pending deposits (unprocessed) | >5 for >10 minutes |
| Pending burns (unprocessed) | >5 for >10 minutes |
| Submission failure rate | >10% in 1 hour |
| Average mint latency | >5 minutes |
| Average unlock latency | >5 minutes |
| Validator signature collection time | >2 minutes |
| Relayer wallet SOL balance (for tx fees) | <0.1 SOL |
