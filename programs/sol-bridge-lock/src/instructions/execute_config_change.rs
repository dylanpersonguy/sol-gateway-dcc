use anchor_lang::prelude::*;
use crate::state::{BridgeConfig, PendingConfigChange, ConfigChangeType};
use crate::errors::BridgeError;
use crate::events::{ConfigChangeExecuted, ConfigChangeCancelled};

/// Helper to get the PDA seed byte for a config change type
fn change_type_seed(ct: &ConfigChangeType) -> &'static [u8] {
    match ct {
        ConfigChangeType::AuthorityTransfer => b"authority_transfer",
        ConfigChangeType::GuardianTransfer => b"guardian_transfer",
        ConfigChangeType::MinValidatorsDecrease => b"min_val_decrease",
        ConfigChangeType::MaxDailyOutflowIncrease => b"max_outflow_incr",
    }
}

/// ═══════════════════════════════════════════════════════════════
/// EXECUTE TIMELOCKED CONFIG CHANGE
/// ═══════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExecuteConfigChangeParams {
    pub change_type: ConfigChangeType,
}

#[derive(Accounts)]
#[instruction(params: ExecuteConfigChangeParams)]
pub struct ExecuteConfigChange<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        mut,
        seeds = [b"pending_config", change_type_seed(&params.change_type)],
        bump = pending_change.bump,
        close = payer,
    )]
    pub pending_change: Account<'info, PendingConfigChange>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

pub fn execute_handler(ctx: Context<ExecuteConfigChange>, params: ExecuteConfigChangeParams) -> Result<()> {
    let clock = Clock::get()?;
    let pending = &ctx.accounts.pending_change;

    // ── GUARD: Timelock delay must have elapsed ──
    require!(
        clock.unix_timestamp >= pending.execute_after,
        BridgeError::TimelockNotElapsed
    );

    let config = &mut ctx.accounts.bridge_config;

    match &params.change_type {
        ConfigChangeType::AuthorityTransfer => {
            let new_authority = Pubkey::try_from(&pending.new_value[..])
                .map_err(|_| BridgeError::InvalidConfig)?;
            config.authority = new_authority;
            msg!("Authority transferred to: {}", new_authority);
        }
        ConfigChangeType::GuardianTransfer => {
            let new_guardian = Pubkey::try_from(&pending.new_value[..])
                .map_err(|_| BridgeError::InvalidConfig)?;
            config.guardian = new_guardian;
            msg!("Guardian transferred to: {}", new_guardian);
        }
        ConfigChangeType::MinValidatorsDecrease => {
            let new_min = pending.new_value[0];
            require!(new_min >= 1, BridgeError::InvalidConfig);
            require!(
                new_min <= config.max_validators,
                BridgeError::InvalidConfig
            );
            config.min_validators = new_min;
            msg!("Min validators decreased to: {}", new_min);
        }
        ConfigChangeType::MaxDailyOutflowIncrease => {
            let new_outflow = u64::from_le_bytes(
                pending.new_value[..8].try_into().unwrap()
            );
            require!(new_outflow > 0, BridgeError::InvalidConfig);
            config.max_daily_outflow = new_outflow;
            msg!("Max daily outflow increased to: {}", new_outflow);
        }
    }

    let change_name = match &params.change_type {
        ConfigChangeType::AuthorityTransfer => "authority_transfer",
        ConfigChangeType::GuardianTransfer => "guardian_transfer",
        ConfigChangeType::MinValidatorsDecrease => "min_validators_decrease",
        ConfigChangeType::MaxDailyOutflowIncrease => "max_daily_outflow_increase",
    };

    emit!(ConfigChangeExecuted {
        change_type: change_name.to_string(),
        executor: ctx.accounts.payer.key(),
        timestamp: clock.unix_timestamp,
    });

    // Account is closed via `close = payer` in derive
    Ok(())
}

/// ═══════════════════════════════════════════════════════════════
/// CANCEL TIMELOCKED CONFIG CHANGE
/// ═══════════════════════════════════════════════════════════════

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CancelConfigChangeParams {
    pub change_type: ConfigChangeType,
}

#[derive(Accounts)]
#[instruction(params: CancelConfigChangeParams)]
pub struct CancelConfigChange<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
        constraint = bridge_config.authority == authority.key() @ BridgeError::Unauthorized,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        mut,
        seeds = [b"pending_config", change_type_seed(&params.change_type)],
        bump = pending_change.bump,
        close = authority,
    )]
    pub pending_change: Account<'info, PendingConfigChange>,

    #[account(mut)]
    pub authority: Signer<'info>,
}

pub fn cancel_handler(ctx: Context<CancelConfigChange>, params: CancelConfigChangeParams) -> Result<()> {
    let clock = Clock::get()?;

    let change_name = match &params.change_type {
        ConfigChangeType::AuthorityTransfer => "authority_transfer",
        ConfigChangeType::GuardianTransfer => "guardian_transfer",
        ConfigChangeType::MinValidatorsDecrease => "min_validators_decrease",
        ConfigChangeType::MaxDailyOutflowIncrease => "max_daily_outflow_increase",
    };

    emit!(ConfigChangeCancelled {
        change_type: change_name.to_string(),
        canceller: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
    });

    msg!("Config change cancelled: {}", change_name);
    // Account is closed via `close = authority` in derive
    Ok(())
}
