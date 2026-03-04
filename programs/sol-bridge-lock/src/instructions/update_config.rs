use anchor_lang::prelude::*;
use crate::state::BridgeConfig;
use crate::errors::BridgeError;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigParams {
    pub min_deposit: Option<u64>,
    pub max_deposit: Option<u64>,
    pub max_daily_outflow: Option<u64>,
    pub max_unlock_amount: Option<u64>,
    pub required_confirmations: Option<u16>,
    pub large_withdrawal_delay: Option<i64>,
    pub large_withdrawal_threshold: Option<u64>,
    pub min_validators: Option<u8>,
    pub max_hourly_outflow: Option<u64>,
    // NOTE: authority and guardian transfers now require timelock
    // via propose_config_change / execute_config_change
    // max_daily_outflow *increases* require timelock
    // min_validators *decreases* require timelock
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
        constraint = bridge_config.authority == authority.key() @ BridgeError::Unauthorized,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.bridge_config;

    if let Some(min_deposit) = params.min_deposit {
        require!(min_deposit > 0, BridgeError::InvalidConfig);
        config.min_deposit = min_deposit;
    }

    if let Some(max_deposit) = params.max_deposit {
        require!(max_deposit > config.min_deposit, BridgeError::InvalidConfig);
        config.max_deposit = max_deposit;
    }

    if let Some(max_daily_outflow) = params.max_daily_outflow {
        require!(max_daily_outflow > 0, BridgeError::InvalidConfig);
        // Only allow decreases here; increases require timelock
        require!(
            max_daily_outflow <= config.max_daily_outflow,
            BridgeError::InvalidConfig
        );
        config.max_daily_outflow = max_daily_outflow;
    }

    if let Some(max_unlock_amount) = params.max_unlock_amount {
        require!(max_unlock_amount > 0, BridgeError::InvalidConfig);
        config.max_unlock_amount = max_unlock_amount;
    }

    if let Some(required_confirmations) = params.required_confirmations {
        // Minimum 32 confirmations for safety
        require!(required_confirmations >= 32, BridgeError::InvalidConfig);
        config.required_confirmations = required_confirmations;
    }

    if let Some(large_withdrawal_delay) = params.large_withdrawal_delay {
        require!(large_withdrawal_delay >= 0, BridgeError::InvalidConfig);
        config.large_withdrawal_delay = large_withdrawal_delay;
    }

    if let Some(large_withdrawal_threshold) = params.large_withdrawal_threshold {
        config.large_withdrawal_threshold = large_withdrawal_threshold;
    }

    if let Some(min_validators) = params.min_validators {
        require!(
            min_validators >= 1 && min_validators <= config.max_validators,
            BridgeError::InvalidConfig
        );
        // Only allow increases here; decreases require timelock
        require!(
            min_validators >= config.min_validators,
            BridgeError::InvalidConfig
        );
        config.min_validators = min_validators;
    }

    if let Some(max_hourly_outflow) = params.max_hourly_outflow {
        require!(max_hourly_outflow > 0, BridgeError::InvalidConfig);
        config.max_hourly_outflow = max_hourly_outflow;
    }

    // NOTE: Authority/guardian transfers and min_validators decreases
    // now require the propose_config_change → execute_config_change flow
    // with mandatory timelock delays.

    msg!("Bridge config updated");
    Ok(())
}
