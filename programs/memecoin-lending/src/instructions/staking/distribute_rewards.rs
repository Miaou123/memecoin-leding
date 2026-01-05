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
        
        // Deserialize UserStake
        let mut user_stake_data = user_stake_info.try_borrow_mut_data()?;
        
        // Validate account is writable and owned by program
        
        if user_stake_info.owner != ctx.program_id {
            continue;
        }
        
        // Parse UserStake fields manually
        // Layout: disc(8) + owner(32) + pool(32) + staked_amount(8) + stake_start_epoch(8) + last_rewarded_epoch(8) + total_rewards_received(8) + first_stake_time(8) + bump(1) + reserved(32)
        let mut offset = 8; // Skip discriminator
        
        // Read owner
        let owner_bytes: [u8; 32] = user_stake_data[offset..offset+32].try_into().unwrap();
        let owner = Pubkey::new_from_array(owner_bytes);
        offset += 32;
        
        // Skip pool
        offset += 32;
        
        // Read staked_amount
        let staked_amount = u64::from_le_bytes(user_stake_data[offset..offset+8].try_into().unwrap());
        offset += 8;
        
        // Read stake_start_epoch
        let stake_start_epoch = u64::from_le_bytes(user_stake_data[offset..offset+8].try_into().unwrap());
        offset += 8;
        
        // Read last_rewarded_epoch
        let last_rewarded_epoch = u64::from_le_bytes(user_stake_data[offset..offset+8].try_into().unwrap());
        offset += 8;
        
        // Read total_rewards_received
        let total_rewards_received = u64::from_le_bytes(user_stake_data[offset..offset+8].try_into().unwrap());
        
        // Skip if:
        // 1. Already rewarded for this epoch
        // 2. Wasn't eligible (staked during or after the distributable epoch)
        // 3. Zero stake
        if last_rewarded_epoch >= distributable_epoch {
            continue;
        }
        
        if stake_start_epoch >= distributable_epoch {
            continue;
        }
        
        if staked_amount == 0 {
            continue;
        }
        
        // Verify wallet matches owner
        if user_wallet_info.key() != owner {
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