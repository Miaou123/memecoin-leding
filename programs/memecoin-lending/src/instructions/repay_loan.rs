use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

#[derive(Accounts)]
pub struct RepayLoan<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = !protocol_state.paused @ LendingError::ProtocolPaused
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, loan.token_mint.as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    #[account(
        mut,
        seeds = [
            LOAN_SEED,
            loan.borrower.as_ref(),
            loan.token_mint.as_ref(),
            &loan.index.to_le_bytes()
        ],
        bump = loan.bump,
        constraint = loan.status == LoanStatus::Active @ LendingError::LoanAlreadyRepaid,
        constraint = loan.borrower == borrower.key() @ LendingError::Unauthorized
    )]
    pub loan: Account<'info, Loan>,

    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    // === NEW: Operations wallet for fee distribution ===
    /// CHECK: Operations wallet receives 25% of loan fee (0.5% of loan)
    #[account(
        mut,
        constraint = operations_wallet.key() == protocol_state.operations_wallet @ LendingError::Unauthorized
    )]
    pub operations_wallet: AccountInfo<'info>,

    // === NEW: Staking reward vault for fee distribution ===
    /// CHECK: Staking reward vault receives 25% of loan fee (0.5% of loan)
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED],
        bump
    )]
    pub staking_reward_vault: AccountInfo<'info>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key() @ LendingError::InvalidTokenAccountOwner,
        constraint = borrower_token_account.mint == loan.token_mint
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = loan,
        seeds = [b"vault", loan.key().as_ref()],
        bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        constraint = token_mint.key() == loan.token_mint
    )]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    /// User exposure tracker - must update when loan is repaid
    #[account(
        mut,
        seeds = [USER_EXPOSURE_SEED, borrower.key().as_ref()],
        bump = user_exposure.bump
    )]
    pub user_exposure: Account<'info, UserExposure>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn repay_loan_handler(ctx: Context<RepayLoan>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;

    // FIX 1: Reentrancy guard
    ReentrancyGuard::enter(protocol_state)?;
    
    // Store loan data before taking mutable borrow
    let borrower = ctx.accounts.loan.borrower;
    let token_mint = ctx.accounts.loan.token_mint;
    let loan_index = ctx.accounts.loan.index;
    let loan_bump = ctx.accounts.loan.bump;
    let sol_borrowed = ctx.accounts.loan.sol_borrowed;
    let collateral_amount = ctx.accounts.loan.collateral_amount;
    
    // Now we can borrow loan mutably
    let loan = &mut ctx.accounts.loan;

    // Calculate total amount owed (principal + 2% flat fee)
    // Using the constant PROTOCOL_FEE_BPS = 200 (2%)
    let protocol_fee = SafeMath::mul_div(
        sol_borrowed, 
        PROTOCOL_FEE_BPS as u64, 
        BPS_DIVISOR
    )?;
    let total_owed = SafeMath::add(sol_borrowed, protocol_fee)?;

    // Check borrower has sufficient SOL
    let borrower_balance = ctx.accounts.borrower.lamports();
    require!(
        borrower_balance >= total_owed, 
        LendingError::InsufficientTreasuryBalance
    );

    // === FIX 3: Calculate fee splits explicitly (all from the 2% protocol fee) ===
    let treasury_fee = SafeMath::mul_div(
        protocol_fee, 
        LOAN_FEE_TREASURY_BPS as u64, 
        BPS_DIVISOR
    )?;

    let staking_fee = SafeMath::mul_div(
        protocol_fee, 
        LOAN_FEE_STAKING_BPS as u64, 
        BPS_DIVISOR
    )?;

    let operations_fee = SafeMath::mul_div(
        protocol_fee,
        LOAN_FEE_OPERATIONS_BPS as u64,
        BPS_DIVISOR
    )?;

    // Handle dust from rounding - send to treasury
    let total_distributed = treasury_fee + staking_fee + operations_fee;
    let dust = protocol_fee.saturating_sub(total_distributed);
    let treasury_fee_with_dust = treasury_fee + dust;

    // Update loan status BEFORE transfers
    loan.status = LoanStatus::Repaid;

    // === TRANSFER PRINCIPAL TO TREASURY ===
    // This replenishes the lending pool
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.borrower.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        sol_borrowed,
    )?;

    // === DISTRIBUTE FEE: Treasury gets 50% (1.0%) + dust ===
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.borrower.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        treasury_fee_with_dust,
    )?;

    // === DISTRIBUTE FEE: Staking gets 25% (0.5%) ===
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.borrower.to_account_info(),
                to: ctx.accounts.staking_reward_vault.to_account_info(),
            },
        ),
        staking_fee,
    )?;

    // === DISTRIBUTE FEE: Operations gets 25% (0.5%) ===
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.borrower.to_account_info(),
                to: ctx.accounts.operations_wallet.to_account_info(),
            },
        ),
        operations_fee,
    )?;

    // Transfer collateral back to borrower
    let loan_seeds: &[&[u8]] = &[
        LOAN_SEED,
        borrower.as_ref(),
        token_mint.as_ref(),
        &loan_index.to_le_bytes(),
        &[loan_bump],
    ];
    let loan_signer_seeds = &[loan_seeds];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.borrower_token_account.to_account_info(),
            authority: ctx.accounts.loan.to_account_info(),
        },
        loan_signer_seeds,
    );
    token::transfer(transfer_ctx, collateral_amount)?;

    // Update protocol state
    protocol_state.total_sol_borrowed = SafeMath::sub(
        protocol_state.total_sol_borrowed, 
        sol_borrowed
    )?;
    protocol_state.total_fees_earned = SafeMath::add(
        protocol_state.total_fees_earned, 
        protocol_fee
    )?;
    protocol_state.active_loans_count = SafeMath::sub(
        protocol_state.active_loans_count, 
        1
    )?;
    
    // Update token config counters and exposure tracking
    let token_config = &mut ctx.accounts.token_config;
    token_config.active_loans_count = SafeMath::sub(
        token_config.active_loans_count, 
        1
    )?;
    
    // Update token exposure tracking - decrement borrowed amount
    token_config.total_active_borrowed = SafeMath::sub(
        token_config.total_active_borrowed,
        sol_borrowed
    )?;

    // Update user exposure tracking - decrement borrowed amount and increment counters
    let user_exposure = &mut ctx.accounts.user_exposure;
    user_exposure.total_borrowed = SafeMath::sub(
        user_exposure.total_borrowed,
        sol_borrowed
    )?;
    user_exposure.active_loans_count = SafeMath::sub(
        user_exposure.active_loans_count,
        1
    )?;
    user_exposure.loans_repaid = SafeMath::add(
        user_exposure.loans_repaid,
        1
    )?;

    msg!(
        "Loan repaid: principal={} SOL, fee={} SOL (treasury={}, staking={}, ops={})",
        sol_borrowed,
        protocol_fee,
        treasury_fee_with_dust,
        staking_fee,
        operations_fee
    );
    
    // FIX 1: Exit reentrancy guard
    ReentrancyGuard::exit(protocol_state);
    
    Ok(())
}