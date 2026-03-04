use anchor_lang::prelude::*;
use crate::state::{BridgeConfig, UnlockRecord};
use crate::errors::BridgeError;
use crate::events::ScheduledUnlockExecuted;

#[derive(Accounts)]
pub struct ExecuteScheduledUnlock<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        mut,
        constraint = !unlock_record.executed @ BridgeError::UnlockAlreadyExecuted,
        constraint = unlock_record.scheduled_time > 0 @ BridgeError::InvalidConfig,
    )]
    pub unlock_record: Account<'info, UnlockRecord>,

    /// CHECK: PDA vault — source of unlocked funds
    #[account(
        mut,
        seeds = [b"vault"],
        bump = bridge_config.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: Recipient receives the unlocked SOL — must match the record
    #[account(
        mut,
        constraint = recipient.key() == unlock_record.recipient @ BridgeError::Unauthorized,
    )]
    pub recipient: SystemAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteScheduledUnlock>) -> Result<()> {
    let config = &ctx.accounts.bridge_config;
    let unlock_record = &ctx.accounts.unlock_record;
    let clock = Clock::get()?;

    // ── GUARD: Bridge must not be paused ──
    require!(!config.paused, BridgeError::BridgePaused);

    // ── GUARD: Timelock delay must have elapsed ──
    require!(
        clock.unix_timestamp >= unlock_record.scheduled_time,
        BridgeError::WithdrawalDelayNotElapsed
    );

    // ── GUARD: Sufficient vault balance ──
    let vault_lamports = ctx.accounts.vault.lamports();
    require!(
        vault_lamports >= unlock_record.amount,
        BridgeError::InsufficientVaultBalance
    );

    // ── Execute the transfer ──
    let config = &mut ctx.accounts.bridge_config;
    let vault_seeds: &[&[u8]] = &[b"vault", &[config.vault_bump]];
    let signer_seeds = &[vault_seeds];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
            },
            signer_seeds,
        ),
        unlock_record.amount,
    )?;

    // ── Update state ──
    config.total_unlocked = config.total_unlocked
        .checked_add(unlock_record.amount)
        .ok_or(BridgeError::ArithmeticOverflow)?;

    // Update daily outflow for the execution day
    let day_seconds: i64 = 86400;
    if clock.unix_timestamp - config.last_daily_reset >= day_seconds {
        config.current_daily_outflow = 0;
        config.last_daily_reset = clock.unix_timestamp;
    }
    config.current_daily_outflow = config.current_daily_outflow
        .checked_add(unlock_record.amount)
        .ok_or(BridgeError::ArithmeticOverflow)?;
    require!(
        config.current_daily_outflow <= config.max_daily_outflow,
        BridgeError::DailyOutflowExceeded
    );

    let unlock_record = &mut ctx.accounts.unlock_record;
    unlock_record.executed = true;

    emit!(ScheduledUnlockExecuted {
        transfer_id: unlock_record.transfer_id,
        recipient: unlock_record.recipient,
        amount: unlock_record.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Scheduled unlock executed: {} lamports to {}, transfer_id: {:?}",
        unlock_record.amount,
        unlock_record.recipient,
        &unlock_record.transfer_id[..8]
    );

    Ok(())
}
