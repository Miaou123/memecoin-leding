use anchor_lang::prelude::*;
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

    /// Protocol treasury account
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    #[account(mut)]
    pub borrower: Signer<'info>,

    /// Borrower's token account (to receive collateral back)
    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key() @ LendingError::InvalidTokenAccountOwner,
        constraint = borrower_token_account.mint == loan.token_mint
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    /// Protocol vault token account storing collateral
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Vault authority PDA
    #[account(
        seeds = [VAULT_SEED, loan.key().as_ref()],
        bump
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(
        constraint = token_mint.key() == loan.token_mint
    )]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn repay_loan_handler(ctx: Context<RepayLoan>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let clock = Clock::get()?;
    
    // Extract loan key FIRST before any mutable borrow
    let loan_key = ctx.accounts.loan.key();
    
    // Now we can borrow loan mutably
    let loan = &mut ctx.accounts.loan;

    // Calculate total amount owed
    let loan_duration = clock.unix_timestamp - loan.created_at;
    let total_owed = LoanCalculator::calculate_total_owed(
        loan.sol_borrowed,
        loan.interest_rate_bps,
        loan_duration as u64,
        protocol_state.protocol_fee_bps,
    )?;

    // Check borrower has sufficient SOL
    let borrower_balance = ctx.accounts.borrower.lamports();
    if borrower_balance < total_owed {
        return Err(LendingError::InsufficientTreasuryBalance.into()); // Reusing error for insufficient balance
    }

    // Calculate interest and protocol fee for tracking
    let interest = LoanCalculator::calculate_interest(
        loan.sol_borrowed,
        loan.interest_rate_bps,
        loan_duration as u64,
    )?;
    let protocol_fee = SafeMath::mul_div(loan.sol_borrowed, protocol_state.protocol_fee_bps as u64, BPS_DIVISOR)?;

    // Store collateral amount before we need it
    let collateral_amount = loan.collateral_amount;
    
    // Update loan status BEFORE the CPI call
    loan.status = LoanStatus::Repaid;

    // Transfer SOL payment from borrower to treasury
    **ctx.accounts.borrower.to_account_info().try_borrow_mut_lamports()? -= total_owed;
    **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += total_owed;

    // Now use the pre-extracted loan_key for vault seeds
    let vault_authority_bump = ctx.bumps.vault_authority;
    let vault_seeds = &[
        VAULT_SEED,
        loan_key.as_ref(),  // Use the pre-extracted key
        &[vault_authority_bump],
    ];
    let vault_signer = &[&vault_seeds[..]];

    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.borrower_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        vault_signer,
    );
    token::transfer(transfer_ctx, collateral_amount)?;  // Use stored value

    // Loan status already updated above

    // Update protocol state
    protocol_state.total_sol_borrowed = SafeMath::sub(protocol_state.total_sol_borrowed, loan.sol_borrowed)?;
    protocol_state.total_interest_earned = SafeMath::add(protocol_state.total_interest_earned, interest)?;
    protocol_state.active_loans_count = SafeMath::sub(protocol_state.active_loans_count, 1)?;
    
    // Update token config counters
    let token_config = &mut ctx.accounts.token_config;
    token_config.active_loans_count = SafeMath::sub(token_config.active_loans_count, 1)?;
    
    // Treasury balance is tracked by the actual lamport balance of the treasury account
    // No need to track it separately in protocol_state

    msg!(
        "Loan repaid: {} SOL principal + {} SOL interest + {} SOL protocol fee",
        loan.sol_borrowed,
        interest,
        protocol_fee
    );
    
    Ok(())
}