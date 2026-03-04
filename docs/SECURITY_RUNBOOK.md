# Security Runbook — SOL ⇄ DecentralChain Bridge

## Emergency Response Playbook

### 1. Emergency Pause

**When to pause:** Supply mismatch detected, validator compromise suspected, anomalous volume, or unknown exploit.

#### Solana Side
```bash
# Using Solana CLI with authority or guardian keypair
solana program invoke \
  --program-id 9yJDb6VyjDHmQC7DLADDdLFm9wxWanXRM5x9SdZ3oVkF \
  emergency_pause \
  --keypair /path/to/authority-or-guardian.json
```

#### DCC Side
```bash
# Via DCC node CLI
dcc broadcast invoke-script \
  --dApp 3Dcw59P4kGhWxTZKN4uGQgH9iWQanfRuMBG \
  --call "emergencyPause()" \
  --private-key $ADMIN_OR_GUARDIAN_KEY
```

**Who can pause:** Authority OR Guardian (on both chains)  
**Who can resume:** Authority ONLY (prevents compromised guardian from resuming)

### 2. Resume After Investigation

1. Confirm root cause is identified and resolved
2. Verify supply invariant: `vault_balance >= total_locked - total_unlocked`
3. Verify DCC supply: `total_minted - total_burned` matches circulating supply
4. Authority (not guardian) resumes operations:
   - Solana: `emergency_resume`
   - DCC: `emergencyResume()`

---

## Validator Operations

### 3. Register a New Validator

**Prerequisites:**
- New validator has generated Ed25519 keypair (preferably HSM-backed)
- At least one validator slot available (`validator_count < max_validators`)
- Authority approves the addition

```bash
# Solana — register_validator instruction
# Creates PDA: seeds = [b"validator", validator_pubkey]

# DCC
dcc broadcast invoke-script \
  --dApp 3Dcw59P4kGhWxTZKN4uGQgH9iWQanfRuMBG \
  --call "registerValidator(\"$VALIDATOR_PUBKEY_BASE58\")" \
  --private-key $ADMIN_KEY
```

### 4. Remove a Validator

**Guard:** Cannot remove if it would breach `min_validators` threshold.

```bash
# Solana — remove_validator instruction
# Closes the ValidatorEntry PDA, returns rent to authority

# DCC
dcc broadcast invoke-script \
  --dApp 3Dcw59P4kGhWxTZKN4uGQgH9iWQanfRuMBG \
  --call "removeValidator(\"$VALIDATOR_PUBKEY_BASE58\")" \
  --private-key $ADMIN_KEY
```

### 5. Validator Key Rotation

1. Register new validator key on **both** chains
2. Verify new validator is operational and attesting correctly
3. Remove old validator key from **both** chains
4. Confirm `validator_count` is consistent across chains

---

## Configuration Changes

### 6. Authority Transfer (Timelocked — 48 hours)

**Solana:**
```
1. propose_config_change(AuthorityTransfer, new_pubkey_bytes)
2. Wait 48 hours
3. execute_config_change(AuthorityTransfer)
```

**DCC:**
```
1. proposeAdminTransfer("new_admin_address")
2. Wait 2880 blocks (~48 hours)
3. executeAdminTransfer()
```

**To cancel:** Call `cancel_config_change` (Solana) or `cancelAdminTransfer()` (DCC) before execution.

### 7. Guardian Transfer (Timelocked — 48 hours)

Same flow as authority transfer but with `GuardianTransfer` type (Solana) or `proposeGuardianTransfer`/`executeGuardianTransfer` (DCC).

### 8. Rate Limit Adjustments

**Instant operations (decreases / tightening):**
- `update_config` with lower `max_daily_outflow`
- `update_config` with higher `min_validators`
- `updateMaxDailyMint` / `updateMaxSingleMint` on DCC

**Timelocked operations (increases / loosening):**
- `propose_config_change(MaxDailyOutflowIncrease, new_value)` → 24h delay
- `propose_config_change(MinValidatorsDecrease, new_value)` → 48h delay

---

## Monitoring & Alerting

### 9. Supply Invariant Check

Run periodically (every 5 minutes):

```typescript
// Solana side
const vaultBalance = await connection.getBalance(vaultPDA);
const config = await program.account.bridgeConfig.fetch(configPDA);
const lockedMinusUnlocked = config.totalLocked - config.totalUnlocked;

if (vaultBalance < lockedMinusUnlocked) {
  ALERT("CRITICAL: Vault balance deficit detected!");
  await emergencyPause();
}

// DCC side
const totalMinted = await dccApi.getDataKey(contractAddr, "total_minted");
const totalBurned = await dccApi.getDataKey(contractAddr, "total_burned");
const outstanding = totalMinted - totalBurned;

if (outstanding > lockedMinusUnlocked) {
  ALERT("CRITICAL: DCC supply exceeds Solana vault!");
  await emergencyPause();
}
```

### 10. Alert Thresholds

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Daily outflow | >70% of max | >90% of max | Alert → Auto-pause at 100% |
| Single unlock | >50% of max | >80% of max | Manual review |
| Validator failures | 1 of N failing | M of N unreachable | Alert → Pause if quorum lost |
| Supply mismatch | >0.01% drift | Any deficit | Alert → Immediate pause |
| Chain sync lag | >100 slots | >500 slots | Alert → Investigate |
| Large pending txs | Any pending | Pending >24h | Review → Cancel if suspicious |

---

## Incident Response

### 11. Supply Mismatch Detected

1. **Immediately pause** both chains
2. Query all `DepositRecord` accounts on Solana
3. Query all `processed_*` keys on DCC
4. Cross-reference: every deposit should have exactly one mint
5. Check for un-minted deposits or phantom mints
6. If exploit confirmed:
   a. Preserve all logs and chain state
   b. Identify exploit vector
   c. Fix root cause
   d. Deploy patched contract if needed
   e. Resume only after audit of fix

### 12. Validator Compromise Suspected

1. **Immediately pause** both chains
2. Identify compromised validator(s)
3. Remove compromised validators from both chains
4. Review all recent attestations by compromised validators
5. Check for unauthorized mints/unlocks
6. Register replacement validators
7. Resume after confirming system integrity

### 13. Large Pending Transaction Review

For any pending large transaction:

```typescript
// DCC: Check pending large mints
const isPending = await dccApi.getDataKey(contractAddr, `pending_large_${transferId}`);
const pendingHeight = await dccApi.getDataKey(contractAddr, `pending_large_height_${transferId}`);
const recipient = await dccApi.getDataKey(contractAddr, `pending_recipient_${transferId}`);
const amount = await dccApi.getDataKey(contractAddr, `pending_amount_${transferId}`);

// Verify the corresponding deposit exists on Solana
const depositRecord = await program.account.depositRecord.fetch(depositPDA);
assert(depositRecord.amount === amount, "Amount mismatch!");
assert(depositRecord.recipientDcc === recipient, "Recipient mismatch!");
```

**To cancel a suspicious pending mint:**
```
cancelPendingMint(transferId)
```

---

## Upgrade Procedure

### 14. Solana Program Upgrade

1. Build new program: `anchor build`
2. Verify bytecode matches source
3. Propose upgrade via multisig
4. Wait for multisig approval (N-of-M signers)
5. Deploy: `anchor upgrade --program-id 9yJDb6VyjDHmQC7DLADDdLFm9wxWanXRM5x9SdZ3oVkF`
6. Verify: Compare on-chain IDL with expected
7. Test all instructions with a single small deposit/unlock cycle

### 15. DCC Contract Upgrade

1. Deploy new contract to a fresh DCC address
2. Test new contract with isolated validators
3. Migrate state: register all tokens, validators on new contract
4. Pause old contract permanently
5. Update bridging infrastructure to use new contract address
6. Resume operations on new contract

---

## Key Storage & Access

### 16. Key Inventory

| Key | Storage | Backup | Access Control |
|-----|---------|--------|----------------|
| Bridge Authority | HSM + Multisig | Geographically distributed | Requires M-of-N signers |
| Guardian | Separate HSM | Cold storage backup | Emergency only |
| Validator Keys (×5) | Individual HSMs | Encrypted backups | Per-operator |
| Monitor Guardian | HSM (read + pause) | Encrypted backup | Automated + manual |
| PDA Vault | N/A (derived) | N/A | Only program logic |

### 17. Key Rotation Schedule

| Key | Rotation Frequency | Procedure |
|-----|-------------------|-----------|
| Validator Keys | Every 90 days | Register new → verify → remove old |
| Bridge Authority | As needed (events) | Timelocked transfer (48h) |
| Guardian | As needed (events) | Timelocked transfer (48h) |
