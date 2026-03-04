use anchor_lang::prelude::*;
use crate::state::{BridgeConfig, PendingConfigChange, ConfigChangeType};
use crate::errors::BridgeError;
use crate::events::ConfigChangeProposed;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ProposeConfigChangeParams {
    /// Type of config change
    pub change_type: ConfigChangeType,
    /// New value (interpretation depends on change_type)
    /// - AuthorityTransfer / GuardianTransfer: 32-byte pubkey
    /// - MinValidatorsDecrease: u8 as first byte, rest zeroed
    /// - MaxDailyOutflowIncrease: u64 LE as first 8 bytes, rest zeroed
    pub new_value: [u8; 32],
}

/// Helper to get the PDA seed byte for a config change type
fn change_type_seed(ct: &ConfigChangeType) -> &'static [u8] {
    match ct {
        ConfigChangeType::AuthorityTransfer => b"authority_transfer",
        ConfigChangeType::GuardianTransfer => b"guardian_transfer",
        ConfigChangeType::MinValidatorsDecrease => b"min_val_decrease",
        ConfigChangeType::MaxDailyOutflowIncrease => b"max_outflow_incr",
    }
}

#[derive(Accounts)]
#[instruction(params: ProposeConfigChangeParams)]
pub struct ProposeConfigChange<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
        constraint = bridge_config.authority == authority.key() @ BridgeError::Unauthorized,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        init,
        payer = authority,
        space = PendingConfigChange::LEN,
        seeds = [b"pending_config", change_type_seed(&params.change_type)],
        bump,
    )]
    pub pending_change: Account<'info, PendingConfigChange>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ProposeConfigChange>, params: ProposeConfigChangeParams) -> Result<()> {
    let clock = Clock::get()?;
    let delay = PendingConfigChange::delay_for(&params.change_type);

    // Validate the new value based on change type
    match &params.change_type {
        ConfigChangeType::AuthorityTransfer | ConfigChangeType::GuardianTransfer => {
            // Ensure new pubkey is not zero
            require!(
                params.new_value != [0u8; 32],
                BridgeError::InvalidConfig
            );
        }
        ConfigChangeType::MinValidatorsDecrease => {
            let new_min = params.new_value[0];
            require!(new_min >= 1, BridgeError::InvalidConfig);
            // Must be strictly less than current (it's a decrease)
            require!(
                new_min < ctx.accounts.bridge_config.min_validators,
                BridgeError::InvalidConfig
            );
        }
        ConfigChangeType::MaxDailyOutflowIncrease => {
            let new_outflow = u64::from_le_bytes(
                params.new_value[..8].try_into().unwrap()
            );
            require!(new_outflow > 0, BridgeError::InvalidConfig);
            // Must be strictly greater than current (it's an increase)
            require!(
                new_outflow > ctx.accounts.bridge_config.max_daily_outflow,
                BridgeError::InvalidConfig
            );
        }
    }

    let pending = &mut ctx.accounts.pending_change;
    pending.change_type = params.change_type.clone();
    pending.new_value = params.new_value;
    pending.proposed_at = clock.unix_timestamp;
    pending.execute_after = clock.unix_timestamp + delay;
    pending.proposer = ctx.accounts.authority.key();
    pending.bump = ctx.bumps.pending_change;

    let change_name = match &params.change_type {
        ConfigChangeType::AuthorityTransfer => "authority_transfer",
        ConfigChangeType::GuardianTransfer => "guardian_transfer",
        ConfigChangeType::MinValidatorsDecrease => "min_validators_decrease",
        ConfigChangeType::MaxDailyOutflowIncrease => "max_daily_outflow_increase",
    };

    emit!(ConfigChangeProposed {
        change_type: change_name.to_string(),
        proposer: ctx.accounts.authority.key(),
        execute_after: pending.execute_after,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Config change proposed: {}. Execute after: {}",
        change_name,
        pending.execute_after
    );
    Ok(())
}
