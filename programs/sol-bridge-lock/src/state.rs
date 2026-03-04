use anchor_lang::prelude::*;

/// ═══════════════════════════════════════════════════════════════
/// BRIDGE STATE — Core configuration and accounting
/// ═══════════════════════════════════════════════════════════════

/// Global bridge configuration account (PDA: seeds = [b"bridge_config"])
#[account]
pub struct BridgeConfig {
    /// Authority that can update configuration (multisig recommended)
    pub authority: Pubkey,
    
    /// Guardian authority for emergency operations (separate from authority)
    pub guardian: Pubkey,

    /// Whether the bridge is currently paused
    pub paused: bool,

    /// Global nonce for transfer ID generation
    pub global_nonce: u64,

    /// Total SOL locked in the vault (lamports)
    pub total_locked: u64,

    /// Total SOL unlocked from the vault (lamports)
    pub total_unlocked: u64,

    /// Number of active validators
    pub validator_count: u8,

    /// Minimum validators required for unlock (M in M-of-N)
    pub min_validators: u8,

    /// Maximum validators allowed
    pub max_validators: u8,

    /// Minimum deposit amount (lamports)
    pub min_deposit: u64,

    /// Maximum deposit amount (lamports)
    pub max_deposit: u64,

    /// Maximum daily outflow (lamports) — circuit breaker
    pub max_daily_outflow: u64,

    /// Current day outflow (lamports) — resets daily
    pub current_daily_outflow: u64,

    /// Timestamp of last daily reset
    pub last_daily_reset: i64,

    /// Maximum single unlock amount (lamports)
    pub max_unlock_amount: u64,

    /// Required Solana confirmations before mint (finality)
    pub required_confirmations: u16,

    /// Time delay for large withdrawals (seconds)
    pub large_withdrawal_delay: i64,

    /// Threshold for "large" withdrawal (lamports)
    pub large_withdrawal_threshold: u64,

    /// DCC chain ID for domain separation
    pub dcc_chain_id: u32,

    /// Solana chain ID for domain separation  
    pub solana_chain_id: u32,

    /// Bump seed for the config PDA
    pub bump: u8,

    /// Bump seed for the vault PDA
    pub vault_bump: u8,

    /// Hourly outflow cap (lamports) — sub-daily circuit breaker
    pub max_hourly_outflow: u64,

    /// Current hourly outflow (lamports)
    pub current_hourly_outflow: u64,

    /// Timestamp of last hourly reset
    pub last_hourly_reset: i64,

    /// Reserved space for future fields (reduced by 24 bytes for new fields)
    pub _reserved: [u8; 104],
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            guardian: Pubkey::default(),
            paused: false,
            global_nonce: 0,
            total_locked: 0,
            total_unlocked: 0,
            validator_count: 0,
            min_validators: 0,
            max_validators: 0,
            min_deposit: 0,
            max_deposit: 0,
            max_daily_outflow: 0,
            current_daily_outflow: 0,
            last_daily_reset: 0,
            max_unlock_amount: 0,
            required_confirmations: 0,
            large_withdrawal_delay: 0,
            large_withdrawal_threshold: 0,
            dcc_chain_id: 0,
            solana_chain_id: 0,
            bump: 0,
            vault_bump: 0,
            max_hourly_outflow: 0,
            current_hourly_outflow: 0,
            last_hourly_reset: 0,
            _reserved: [0u8; 104],
        }
    }
}

impl BridgeConfig {
    pub const LEN: usize = 8  // discriminator
        + 32    // authority
        + 32    // guardian
        + 1     // paused
        + 8     // global_nonce
        + 8     // total_locked
        + 8     // total_unlocked
        + 1     // validator_count
        + 1     // min_validators
        + 1     // max_validators
        + 8     // min_deposit
        + 8     // max_deposit
        + 8     // max_daily_outflow
        + 8     // current_daily_outflow
        + 8     // last_daily_reset
        + 8     // max_unlock_amount
        + 2     // required_confirmations
        + 8     // large_withdrawal_delay
        + 8     // large_withdrawal_threshold
        + 4     // dcc_chain_id
        + 4     // solana_chain_id
        + 1     // bump
        + 1     // vault_bump
        + 8     // max_hourly_outflow
        + 8     // current_hourly_outflow
        + 8     // last_hourly_reset
        + 104;  // reserved
}

/// ═══════════════════════════════════════════════════════════════
/// DEPOSIT RECORD — Per-deposit tracking
/// ═══════════════════════════════════════════════════════════════

/// Individual deposit record (PDA: seeds = [b"deposit", transfer_id])
#[account]
pub struct DepositRecord {
    /// Unique transfer ID (hash of sender + nonce + slot)
    pub transfer_id: [u8; 32],

    /// Depositor's Solana public key
    pub sender: Pubkey,

    /// Recipient address on DecentralChain
    pub recipient_dcc: [u8; 32],

    /// Amount in lamports
    pub amount: u64,

    /// User-specific nonce (monotonically increasing)
    pub nonce: u64,

    /// Solana slot at time of deposit
    pub slot: u64,

    /// Unix timestamp of deposit
    pub timestamp: i64,

    /// Whether this deposit has been processed (minted on DCC)
    pub processed: bool,

    /// Bump seed for this PDA
    pub bump: u8,
}

impl DepositRecord {
    pub const LEN: usize = 8  // discriminator
        + 32    // transfer_id
        + 32    // sender
        + 32    // recipient_dcc
        + 8     // amount
        + 8     // nonce
        + 8     // slot
        + 8     // timestamp
        + 1     // processed
        + 1;    // bump
}

/// ═══════════════════════════════════════════════════════════════
/// UNLOCK RECORD — Per-unlock tracking (replay protection)
/// ═══════════════════════════════════════════════════════════════

/// Individual unlock record (PDA: seeds = [b"unlock", transfer_id])
#[account]
pub struct UnlockRecord {
    /// Transfer ID from the DCC burn event
    pub transfer_id: [u8; 32],

    /// Recipient Solana address
    pub recipient: Pubkey,

    /// Amount unlocked (lamports)
    pub amount: u64,

    /// Timestamp of unlock execution
    pub timestamp: i64,

    /// Source DCC burn transaction hash
    pub burn_tx_hash: [u8; 32],

    /// Whether this unlock has been executed
    pub executed: bool,

    /// If large withdrawal: scheduled execution time
    pub scheduled_time: i64,

    /// Bump seed
    pub bump: u8,
}

impl UnlockRecord {
    pub const LEN: usize = 8  // discriminator
        + 32    // transfer_id
        + 32    // recipient
        + 8     // amount
        + 8     // timestamp
        + 32    // burn_tx_hash
        + 1     // executed
        + 8     // scheduled_time
        + 1;    // bump
}

/// ═══════════════════════════════════════════════════════════════
/// USER STATE — Per-user nonce tracking
/// ═══════════════════════════════════════════════════════════════

/// Per-user state (PDA: seeds = [b"user_state", user_pubkey])
#[account]
pub struct UserState {
    /// User's public key
    pub user: Pubkey,

    /// Next expected nonce (monotonically increasing)
    pub next_nonce: u64,

    /// Total deposited by this user (lifetime)
    pub total_deposited: u64,

    /// Daily outflow for this user (unlocks received)
    pub daily_outflow: u64,

    /// Timestamp of last daily outflow reset for this user
    pub last_daily_outflow_reset: i64,

    /// Bump seed
    pub bump: u8,
}

impl UserState {
    pub const LEN: usize = 8  // discriminator
        + 32    // user
        + 8     // next_nonce
        + 8     // total_deposited
        + 8     // daily_outflow
        + 8     // last_daily_outflow_reset
        + 1;    // bump
}

/// ═══════════════════════════════════════════════════════════════
/// VALIDATOR REGISTRY — On-chain validator tracking
/// ═══════════════════════════════════════════════════════════════

/// Validator entry (PDA: seeds = [b"validator", validator_pubkey])
#[account]
pub struct ValidatorEntry {
    /// Validator's signing public key
    pub pubkey: Pubkey,

    /// Whether this validator is active
    pub active: bool,

    /// Registration timestamp
    pub registered_at: i64,

    /// Number of successful attestations
    pub attestation_count: u64,

    /// Number of failed/contested attestations (for slashing)
    pub fault_count: u64,

    /// Bump seed
    pub bump: u8,
}

impl ValidatorEntry {
    pub const LEN: usize = 8
        + 32    // pubkey
        + 1     // active
        + 8     // registered_at
        + 8     // attestation_count
        + 8     // fault_count
        + 1;    // bump
}

/// ═══════════════════════════════════════════════════════════════
/// PENDING CONFIG CHANGE — Timelock for sensitive operations
/// ═══════════════════════════════════════════════════════════════

/// Types of config changes that require a timelock delay
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ConfigChangeType {
    /// Transfer the authority key (48 hour delay)
    AuthorityTransfer,
    /// Transfer the guardian key (48 hour delay)
    GuardianTransfer,
    /// Decrease minimum validators threshold (48 hour delay)
    MinValidatorsDecrease,
    /// Increase max daily outflow (24 hour delay)
    MaxDailyOutflowIncrease,
}

/// Pending configuration change (PDA: seeds = [b"pending_config", change_type_bytes])
/// Authority proposes a change; after the timelock delay elapses, anyone can execute.
/// Authority can cancel at any time.
#[account]
pub struct PendingConfigChange {
    /// Type of change
    pub change_type: ConfigChangeType,

    /// New value — interpretation depends on change_type:
    ///   AuthorityTransfer / GuardianTransfer: new_pubkey (32 bytes, padded)
    ///   MinValidatorsDecrease: new_min_validators (u8 as first byte)
    ///   MaxDailyOutflowIncrease: new_max_daily_outflow (u64, first 8 bytes)
    pub new_value: [u8; 32],

    /// Timestamp when the change was proposed
    pub proposed_at: i64,

    /// Timestamp when the change can be executed
    pub execute_after: i64,

    /// Authority that proposed the change
    pub proposer: Pubkey,

    /// Bump seed
    pub bump: u8,
}

impl PendingConfigChange {
    pub const LEN: usize = 8  // discriminator
        + 1     // change_type (enum variant)
        + 32    // new_value
        + 8     // proposed_at
        + 8     // execute_after
        + 32    // proposer
        + 1;    // bump

    /// Minimum timelock delays in seconds
    pub const AUTHORITY_TRANSFER_DELAY: i64 = 48 * 3600;  // 48 hours
    pub const GUARDIAN_TRANSFER_DELAY: i64 = 48 * 3600;    // 48 hours
    pub const MIN_VALIDATORS_DELAY: i64 = 48 * 3600;       // 48 hours
    pub const MAX_OUTFLOW_INCREASE_DELAY: i64 = 24 * 3600; // 24 hours

    pub fn delay_for(change_type: &ConfigChangeType) -> i64 {
        match change_type {
            ConfigChangeType::AuthorityTransfer => Self::AUTHORITY_TRANSFER_DELAY,
            ConfigChangeType::GuardianTransfer => Self::GUARDIAN_TRANSFER_DELAY,
            ConfigChangeType::MinValidatorsDecrease => Self::MIN_VALIDATORS_DELAY,
            ConfigChangeType::MaxDailyOutflowIncrease => Self::MAX_OUTFLOW_INCREASE_DELAY,
        }
    }
}
