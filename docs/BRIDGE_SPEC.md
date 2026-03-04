# SOL ⇄ DecentralChain Bridge — Formal Specification

**Version:** 3.0.0  
**Status:** Production-grade  
**Last Updated:** 2025-01-XX  

---

## 1. Overview

This document defines the formal security specification for the SOL–DecentralChain (DCC) cross-chain bridge. Every on-chain instruction, message format, and invariant is specified here. Code that violates this spec is a bug.

## 2. Threat Model

### 2.1 Adversary Capabilities
| Threat | Assumed Capability | Mitigation |
|--------|-------------------|------------|
| Validator Compromise | Attacker controls up to `min_validators - 1` validators | M-of-N threshold; remaining honest validators refuse to sign |
| Signature Forgery | Attacker crafts arbitrary messages | Ed25519 precompile verification (Solana); `sigVerify` (DCC) |
| Message Replay | Attacker replays a valid signed unlock/mint | PDA-based replay protection (Solana); `processed_` state key (DCC) |
| Cross-Chain Replay | Attacker replays Solana message on DCC or vice-versa | Domain-separated messages with chain IDs |
| Init Attack | Attacker front-runs initialization | One-shot init with PDA uniqueness; `isDefined(admin)` guard on DCC |
| Upgrade Attack | Attacker swaps program code | BPF upgrade authority is multisig with timelock |
| Oracle Manipulation | N/A | No oracles — bridge is attestation-only |
| Pool Drain | Attacker drains vault in excess of minted supply | `total_locked - total_unlocked >= DCC_outstanding` invariant |
| Relayer Compromise | Relayer submits invalid transactions | Relayer is proof-only; all validation is on-chain |
| DoS | Attacker floods deposits/unlocks | Rate limits, minimum amounts, circuit breakers |
| Cross-Chain MEV | Attacker front-runs mints/unlocks | Transfer ID uniqueness; atomic PDA creation |

### 2.2 Security Invariants (MUST hold at all times)

1. **Supply Conservation:** `vault_balance >= total_locked - total_unlocked` (Solana)
2. **Mint ≤ Lock:** `total_minted_dcc <= total_locked_sol` (cross-chain)
3. **No Replay:** Every `transfer_id` is processed exactly once on each chain
4. **No Unauthorized Unlock:** SOL leaves vault only with `>= min_validators` valid Ed25519 signatures
5. **No Unauthorized Mint:** Wrapped tokens mint only with `>= min_validators` valid `sigVerify` attestations
6. **Monotonic Nonces:** Per-user nonces strictly increase; gaps are not allowed
7. **Circuit Breaker:** Daily outflow never exceeds `max_daily_outflow` within a 24-hour window
8. **Large TX Delay:** Withdrawals `>= threshold` require a time delay before execution

---

## 3. Canonical Message Envelope

### 3.1 Transfer ID (Both Chains)
```
transfer_id = SHA256(sender_pubkey || nonce_le_bytes)
```
- `sender_pubkey`: 32 bytes (Solana pubkey for deposits, DCC address bytes for burns)
- `nonce`: 8 bytes LE, per-user monotonic

Transfer IDs are deterministic and globally unique because `(sender, nonce)` pairs are unique.

### 3.2 Unlock Message (Solana Side)
Validators sign this message to attest that a burn occurred on DCC:
```
domain_separator:  "SOL_DCC_BRIDGE_UNLOCK_V1" (24 bytes)
transfer_id:       32 bytes
recipient:         32 bytes (Solana pubkey)
amount:            8 bytes LE (lamports)
burn_tx_hash:      32 bytes (DCC burn transaction hash)
dcc_chain_id:      4 bytes LE
expiration:        8 bytes LE (Unix timestamp)
```
Total: 140 bytes

### 3.3 Mint Message (DCC Side)
Validators sign this message to attest that a deposit occurred on Solana:
```
domainSeparator + "|" + transferId + "|" + recipient + "|" + amount + "|" + solSlot + "|" + splMint + "|" + chainId
```
Where `domainSeparator = "SOL_DCC_BRIDGE_V2"`.

### 3.4 Legacy Mint Message (DCC Side — backward compat)
```
domainSeparator + "|" + transferId + "|" + recipient + "|" + amount + "|" + solSlot + "|" + chainId
```

---

## 4. State Machine

### 4.1 Deposit Lifecycle (Solana → DCC)
```
┌──────────┐    Solana deposit()     ┌───────────┐   Validators attest   ┌──────────┐
│  UNUSED  │ ──────────────────────► │ DEPOSITED │ ────────────────────► │  MINTED  │
└──────────┘                         └───────────┘                       └──────────┘
                                          │
                                     PDA created with
                                     unique transfer_id
                                     (replay-proof)
```

**Solana `DepositRecord` states:**
- `processed = false`: Deposit recorded, waiting for DCC mint
- `processed = true`: DCC mint confirmed (set by off-chain indexer)

**DCC `processed_{transferId}` states:**
- Not present: Transfer not yet minted
- `true`: Transfer minted (replay-proof)

### 4.2 Redeem Lifecycle (DCC → Solana)
```
┌──────────┐    DCC burn()           ┌──────────┐   Validators attest   ┌────────────┐
│  UNUSED  │ ──────────────────────► │  BURNED  │ ────────────────────► │  UNLOCKED  │
└──────────┘                         └──────────┘                       └────────────┘
                                          │                                   │
                                     burn_record                          If large:
                                     created on DCC                       scheduled_time
                                                                          must elapse
```

**DCC `burn_{burnId}` format:**
```
sender | solRecipient | splMint | amount | height | timestamp
```

**Solana `UnlockRecord` states:**
- `executed = false, scheduled_time > 0`: Large withdrawal, waiting for delay
- `executed = true, scheduled_time = 0`: Normal withdrawal, executed immediately

### 4.3 Large Transaction Flow
```
Amount ≥ threshold?
  ├── No  → Execute immediately
  └── Yes → Schedule for later
              │
              ├── DCC: Store pending_large_{id}, wait largeTxDelayBlocks
              │         Then call executePendingMint()
              │
              └── Solana: Store UnlockRecord with scheduled_time
                          (execute_scheduled_unlock instruction needed)
```

---

## 5. Rate Limits & Circuit Breakers

### 5.1 Solana Side
| Parameter | Field | Default | Description |
|-----------|-------|---------|-------------|
| Min Deposit | `min_deposit` | 10,000 lamports | Floor for dust prevention |
| Max Deposit | `max_deposit` | Per config | Ceiling for single deposit |
| Max Daily Outflow | `max_daily_outflow` | Per config | Circuit breaker trigger |
| Max Single Unlock | `max_unlock_amount` | Per config | Single tx ceiling |
| Large Withdrawal Threshold | `large_withdrawal_threshold` | Per config | Triggers time delay |
| Large Withdrawal Delay | `large_withdrawal_delay` | Per config (seconds) | Mandatory wait |

**Daily Reset Logic:**
```rust
if now - last_daily_reset >= 86400 {
    current_daily_outflow = 0;
    last_daily_reset = now;
}
```

### 5.2 DCC Side
| Parameter | Value | Description |
|-----------|-------|-------------|
| `maxDailyMint` | 1,000,000,000,000 | Max daily mint in raw Solana units |
| `maxSingleMint` | 100,000,000,000 | Max single mint |
| `minMintAmount` | 1,000 | Floor for dust prevention |
| `largeTxThreshold` | 50,000,000,000 | Triggers block delay |
| `largeTxDelayBlocks` | 60 | ~60 minutes at 1 block/min |
| `rateLimitWindow` | 1,440 blocks | ~24 hours |

---

## 6. Signature Verification

### 6.1 Solana (Ed25519 Instruction Introspection)
The Wormhole/Pyth pattern:
1. Transaction includes `Ed25519SigVerify` precompile instructions **before** the `unlock` instruction
2. Each precompile instruction verifies one (pubkey, message, signature) triple
3. The `unlock` handler introspects preceding instructions via `instructions_sysvar`
4. For each attestation, it finds a matching Ed25519 instruction with:
   - Correct `program_id` (Ed25519 native program)
   - Matching `pubkey`, `signature`, and `message`
5. If any Ed25519 instruction fails, the entire atomic transaction reverts

**Ed25519 Instruction Data Layout:**
```
[0]      num_signatures (u8)
[1]      padding (u8)
Per signature (14 bytes each):
[2..4]   signature_offset (u16 LE)
[4..6]   signature_instruction_index (u16 LE)
[6..8]   public_key_offset (u16 LE)
[8..10]  public_key_instruction_index (u16 LE)
[10..12] message_data_offset (u16 LE)
[12..14] message_data_size (u16 LE)
[14..16] message_instruction_index (u16 LE)
```
- `instruction_index = u16::MAX` means data is embedded in the same instruction

### 6.2 DCC (sigVerify in FOLD)
```ride
func verifyValidatorSignatures(message, signatures, pubkeys, minRequired) = {
    let indices = [0,1,2,3,4,...,19]
    let result = FOLD<20>(indices, (0, []), verifyOneSig)
    result._1 >= minRequired && !containsDuplicate(result._2)
}
```
Each validator's pubkey must be in the active set (`validator_active_{pubkey} == true`).

---

## 7. Key Management

### 7.1 Authority Hierarchy
```
┌─────────────────┐     ┌──────────────────┐
│  AUTHORITY       │     │  GUARDIAN         │
│  (Multisig)      │     │  (Separate HSM)   │
│                  │     │                   │
│  Can: everything │     │  Can: pause only  │
│  Config updates  │     │  Cannot: resume   │
│  Validator mgmt  │     │  Cannot: config   │
│  Resume          │     │                   │
└─────────────────┘     └──────────────────┘
```

### 7.2 Timelock Requirements (TO BE IMPLEMENTED)
| Operation | Minimum Delay | Rationale |
|-----------|--------------|-----------|
| Authority Transfer | 48 hours | Prevents instant takeover |
| Guardian Transfer | 48 hours | Prevents safety bypass |
| Min Validators Decrease | 48 hours | Prevents threshold weakening |
| Max Daily Outflow Increase | 24 hours | Prevents drain setup |

### 7.3 PDA Vault (Solana)
- Seeds: `[b"vault"]`
- No private key exists — only the program can authorize transfers
- Transfers require signer seeds: `[b"vault", &[vault_bump]]`

---

## 8. Upgrade Safety

### 8.1 Solana Program
- Uses BPF Upgradeable Loader
- Upgrade authority: multisig (same as bridge authority)
- Recommended: Set upgrade authority to null after stabilization

### 8.2 DCC Contract
- RIDE contracts are immutable once deployed
- Upgrades require deploying a new contract and migrating state
- Admin transfer to new contract address constitutes upgrade

---

## 9. Observability Requirements

### 9.1 Events (Solana)
| Event | Fields | Trigger |
|-------|--------|---------|
| `BridgeDeposit` | transfer_id, sender, recipient_dcc, amount, nonce, slot, timestamp, chain_id | Every deposit |
| `BridgeDepositSpl` | transfer_id, sender, recipient_dcc, spl_mint, amount, nonce, slot, timestamp, chain_id | Every SPL deposit |
| `BridgeUnlock` | transfer_id, recipient, amount, burn_tx_hash, timestamp, signature_count | Every unlock |
| `BridgePaused` | authority, timestamp | Emergency pause |
| `BridgeResumed` | authority, timestamp | Resume |
| `ValidatorRegistered` | validator, validator_count, timestamp | New validator |
| `ValidatorRemoved` | validator, validator_count, timestamp | Removed validator |
| `CircuitBreakerTriggered` | breaker_type, current_value, threshold, timestamp | Rate limit hit |

### 9.2 State Keys (DCC)
| Key Pattern | Type | Meaning |
|-------------|------|---------|
| `processed_{id}` | Boolean | Transfer replay protection |
| `burn_{id}` | String | Burn record (pipe-delimited) |
| `pending_large_{id}` | Boolean | Large tx pending flag |
| `validator_active_{pk}` | Boolean | Validator status |
| `total_minted` / `total_burned` | Integer | Global accounting |
| `daily_minted` / `daily_reset_height` | Integer | Rate limit state |

---

## 10. Testing Requirements

### 10.1 Unit Tests
- [ ] Transfer ID computation determinism
- [ ] Message construction byte-for-byte correctness
- [ ] Nonce monotonicity enforcement
- [ ] Rate limit arithmetic (daily reset, overflow)
- [ ] Large withdrawal scheduling and execution
- [ ] Authority/guardian access control

### 10.2 Property-Based Tests
- [ ] For any sequence of deposits/unlocks: `vault_balance >= total_locked - total_unlocked`
- [ ] For any replay attempt: transaction fails with `DuplicateTransfer`
- [ ] For any nonce skip: transaction fails with `InvalidNonce`
- [ ] Rate limits are never exceeded regardless of timing

### 10.3 Adversarial Tests
- [ ] Replay attack (same transfer_id twice)
- [ ] Cross-chain replay (Solana unlock message submitted to DCC)
- [ ] Signature forgery (invalid Ed25519 signature)
- [ ] Validator impersonation (non-registered pubkey)
- [ ] Duplicate validator signature in single unlock
- [ ] Below-threshold signature count
- [ ] Daily outflow overflow attempt
- [ ] Large withdrawal before delay elapses
- [ ] Authority transfer by non-authority
- [ ] Guardian resume attempt (should fail)
- [ ] Deposit while paused
- [ ] Unlock while paused
- [ ] Integer overflow in amount fields
- [ ] Zero-address recipient
- [ ] Expired transfer submission

### 10.4 End-to-End Tests
- [ ] Full deposit→mint→burn→unlock cycle
- [ ] SPL token deposit→mint→burn→unlock cycle
- [ ] Large withdrawal with time delay
- [ ] Circuit breaker trigger and recovery
- [ ] Validator rotation (add/remove during active bridge)
- [ ] Emergency pause during inflight transactions

---

## 11. Security Checklist

### Pre-Deployment
- [ ] All config parameters validated in `initialize`
- [ ] `min_validators >= 1`, `max_validators <= 20`
- [ ] `required_confirmations >= 32`
- [ ] Guardian is a separate key from authority
- [ ] PDA vault has no external signer
- [ ] Domain separators are distinct per operation
- [ ] Reserved space exists for future fields

### Operational
- [ ] Monitor: `total_locked - total_unlocked` matches DCC supply
- [ ] Monitor: Daily outflow approaching threshold triggers alert
- [ ] Monitor: Validator health (all responding within SLA)
- [ ] Monitor: Large pending transactions reviewed before execution
- [ ] Runbook: Emergency pause procedure documented
- [ ] Runbook: Validator rotation procedure documented
- [ ] Runbook: Incident response for supply mismatch

---

## 12. Known Gaps & Planned Improvements

| Gap | Severity | Status | Plan |
|-----|----------|--------|------|
| No timelock on authority/guardian transfer | HIGH | IMPLEMENTING | Add PendingConfigChange PDA with 48h delay |
| No per-address rate limits | MEDIUM | IMPLEMENTING | Add daily per-user outflow tracking to UserState |
| No hourly rate limit cap | LOW | PLANNED | Sub-daily circuit breaker window |
| No upgrade freeze mode | MEDIUM | PLANNED | Allow setting upgrade authority to null |
| Transfer ID doesn't include amount/recipient | INFO | ACCEPTED | Current: hash(sender,nonce) is unique; adding more fields adds complexity without security gain since nonces are monotonic |
| No formal execute_scheduled_unlock on Solana | HIGH | IMPLEMENTING | Add instruction to execute delayed large withdrawals |
| DCC admin/guardian transfer has no timelock | HIGH | IMPLEMENTING | Add pending transfer with block delay |
| DCC burn doesn't validate Solana recipient format | MEDIUM | IMPLEMENTING | Add base58 length check |
