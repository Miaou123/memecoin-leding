use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::*;
use crate::error::LendingError;

#[derive(Accounts)]
pub struct DistributeRewards<'info> {
    #[account(
        mut,
        seeds = [STAKING_POOL_SEED],
        bump = staking_pool.bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,
    
    /// Anyone can call distribution (permissionless)
    pub caller: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    // remaining_accounts: pairs of (UserStake, user_wallet)
}

/// Distribute rewards to a batch of users
/// Called by backend crank after epoch ends
/// remaining_accounts should contain pairs: [user_stake_1, wallet_1, user_stake_2, wallet_2, ...]
pub fn distribute_rewards_handler<'info>(ctx: Context<'_, '_, '_, 'info, DistributeRewards<'info>>) -> Result<()> {
    let pool = &mut ctx.accounts.staking_pool;
    
    // Must have rewards to distribute
    require!(
        pool.last_epoch_rewards > 0,
        LendingError::NoRewardsToClaim
    );
    
    require!(
        pool.last_epoch_eligible_stake > 0,
        LendingError::NoEligibleStakers
    );
    
    let remaining_accounts = &ctx.remaining_accounts;
    
    // Must have pairs of accounts (UserStake, wallet)
    require!(
        remaining_accounts.len() % 2 == 0 && remaining_accounts.len() > 0,
        LendingError::InvalidAccountPairs
    );
    
    let distributable_epoch = pool.current_epoch.saturating_sub(1);
    
    // Use the MINIMUM of tracked rewards and actual vault balance
    let vault_balance = ctx.accounts.reward_vault.lamports();
    let rewards_pool = std::cmp::min(pool.last_epoch_rewards, vault_balance);
    let eligible_stake = pool.last_epoch_eligible_stake;
    
    // If vault is empty or nearly empty, skip distribution
    if rewards_pool < 1000 { // Less than 0.000001 SOL
        return Ok(());
    }
    
    
    let mut total_distributed_this_call: u64 = 0;
    
    // Process accounts in pairs
    let mut i = 0;
    while i < remaining_accounts.len() {
        let user_stake_info = &remaining_accounts[i];
        let user_wallet_info = &remaining_accounts[i + 1];
        i += 2;
        
        // ============================================================
        // SECURITY VALIDATION 1: Verify account owner is this program
        // ============================================================
        require!(
            user_stake_info.owner == &crate::ID,
            LendingError::InvalidAccountOwner
        );
        
        // ============================================================
        // SECURITY VALIDATION 2: Verify account discriminator
        // ============================================================
        let user_stake_data = user_stake_info.try_borrow_data()?;
        require!(
            user_stake_data.len() >= 8,
            LendingError::InvalidAccountData
        );
        
        let discriminator = &user_stake_data[0..8];
        require!(
            discriminator == USER_STAKE_DISCRIMINATOR,
            LendingError::InvalidDiscriminator
        );
        
        // ============================================================
        // SECURITY VALIDATION 3: Verify PDA derivation
        // ============================================================
        let (expected_pda, _bump) = Pubkey::find_program_address(
            &[
                USER_STAKE_SEED,
                pool.key().as_ref(),
                user_wallet_info.key().as_ref(),
            ],
            &crate::ID,
        );
        require!(
            user_stake_info.key() == expected_pda,
            LendingError::InvalidPDA
        );
        
        // ============================================================
        // SECURITY VALIDATION 4: Verify user_wallet matches stored owner
        // ============================================================
        // Owner is at offset 8 (after discriminator)
        let stored_owner = Pubkey::try_from(
            &user_stake_data[8..40]
        ).map_err(|_| LendingError::InvalidAccountData)?;
        require!(
            stored_owner == user_wallet_info.key(),
            LendingError::InvalidStakeOwner
        );
        
        // Now safe to process - drop immutable borrow before mutable
        drop(user_stake_data);
        
        // Re-borrow mutably for updates
        let mut user_stake_data = user_stake_info.try_borrow_mut_data()?;
        
        // Read stake data (existing code)
        let stake_offset = 8 + 32 + 32; // discriminator + owner + pool
        let staked_amount = u64::from_le_bytes(
            user_stake_data[stake_offset..stake_offset+8].try_into().unwrap()
        );
        
        let stake_start_epoch_offset = stake_offset + 8;
        let stake_start_epoch = u64::from_le_bytes(
            user_stake_data[stake_start_epoch_offset..stake_start_epoch_offset+8].try_into().unwrap()
        );
        
        let last_rewarded_offset = stake_start_epoch_offset + 8;
        let last_rewarded_epoch = u64::from_le_bytes(
            user_stake_data[last_rewarded_offset..last_rewarded_offset+8].try_into().unwrap()
        );
        
        let total_received_offset = last_rewarded_offset + 8;
        let total_rewards_received = u64::from_le_bytes(
            user_stake_data[total_received_offset..total_received_offset+8].try_into().unwrap()
        );
        
        // Skip if not eligible for this epoch
        if staked_amount == 0 
            || stake_start_epoch >= distributable_epoch 
            || last_rewarded_epoch >= distributable_epoch {
            continue;
        }
        
        // Calculate user's share
        // share = (user_stake * rewards_pool) / eligible_stake
        let share = (staked_amount as u128)
            .checked_mul(rewards_pool as u128)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(eligible_stake as u128)
            .ok_or(LendingError::DivisionByZero)? as u64;
        
        if share == 0 {
            continue;
        }
        
        // Check vault has enough (re-check in case of concurrent distributions)
        let current_vault_balance = ctx.accounts.reward_vault.lamports();
        if current_vault_balance < share {
            // Stop distributing if vault runs out
            break;
        }
        
        // Update UserStake in place: last_rewarded_epoch and total_rewards_received
        let last_rewarded_offset = 8 + 32 + 32 + 8 + 8; // 88
        user_stake_data[last_rewarded_offset..last_rewarded_offset+8]
            .copy_from_slice(&distributable_epoch.to_le_bytes());
        
        let total_received_offset = last_rewarded_offset + 8; // 96
        let new_total = total_rewards_received.checked_add(share).ok_or(LendingError::MathOverflow)?;
        user_stake_data[total_received_offset..total_received_offset+8]
            .copy_from_slice(&new_total.to_le_bytes());
        
        // Transfer SOL from reward vault to user wallet using invoke_signed
        let reward_vault_bump = ctx.bumps.reward_vault;
        let reward_vault_seeds = &[
            REWARD_VAULT_SEED,
            &[reward_vault_bump],
        ];
        let signer_seeds = &[&reward_vault_seeds[..]];
        
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.reward_vault.to_account_info(),
                to: user_wallet_info.clone(),
            },
            signer_seeds,
        );
        transfer(cpi_ctx, share)?;
        
        total_distributed_this_call += share;
        
    }
    
    // Update pool stats
    pool.last_epoch_distributed = pool.last_epoch_distributed
        .checked_add(total_distributed_this_call)
        .ok_or(LendingError::MathOverflow)?;
    
    pool.total_rewards_distributed = pool.total_rewards_distributed
        .checked_add(total_distributed_this_call)
        .ok_or(LendingError::MathOverflow)?;
    
    
    Ok(())
}