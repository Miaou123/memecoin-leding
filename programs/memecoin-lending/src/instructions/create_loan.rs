use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

#[derive(Accounts)]
#[instruction(collateral_amount: u64)]
pub struct CreateLoan<'info> {
    #[account(
        mut,
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = !protocol_state.paused @ LendingError::ProtocolPaused
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump = token_config.bump,
        constraint = token_config.enabled @ LendingError::TokenDisabled
    )]
    pub token_config: Account<'info, TokenConfig>,

    #[account(
        init,
        payer = borrower,
        space = Loan::LEN,
        seeds = [
            LOAN_SEED,
            borrower.key().as_ref(),
            token_mint.key().as_ref(),
            &protocol_state.total_loans_created.to_le_bytes()
        ],
        bump
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

    /// Borrower's token account (source of collateral)
    #[account(
        mut,
        constraint = borrower_token_account.owner == borrower.key() @ LendingError::InvalidTokenAccountOwner,
        constraint = borrower_token_account.mint == token_mint.key(),
        constraint = borrower_token_account.amount >= collateral_amount @ LendingError::InsufficientTokenBalance
    )]
    pub borrower_token_account: Account<'info, TokenAccount>,

    /// Protocol vault token account for storing collateral
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Vault authority PDA
    #[account(
        seeds = [VAULT_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub vault_authority: SystemAccount<'info>,

    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreateLoan>,
    collateral_amount: u64,
    duration_seconds: u64,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let token_config = &ctx.accounts.token_config;
    let loan = &mut ctx.accounts.loan;
    let clock = Clock::get()?;

    // Validate loan duration
    ValidationUtils::validate_loan_duration(duration_seconds)?;

    // Get current token price
    let token_price = PriceFeedUtils::get_token_price(&token_config.pool_address)?;

    // Calculate loan amount based on LTV
    let sol_loan_amount = LoanCalculator::calculate_loan_amount(
        collateral_amount,
        token_price,
        token_config.ltv_bps,
    )?;

    // Validate loan amount against limits
    if sol_loan_amount < token_config.min_loan_amount {
        return Err(LendingError::LoanAmountTooLow.into());
    }
    if sol_loan_amount > token_config.max_loan_amount {
        return Err(LendingError::LoanAmountTooHigh.into());
    }

    // Check treasury has sufficient SOL
    let treasury_balance = ctx.accounts.treasury.lamports();
    if treasury_balance < sol_loan_amount {
        return Err(LendingError::InsufficientTreasuryBalance.into());
    }

    // Calculate liquidation price
    let liquidation_price = LoanCalculator::calculate_liquidation_price(
        sol_loan_amount,
        collateral_amount,
        token_config.ltv_bps,
        300, // 3% liquidation buffer
    )?;

    // Transfer collateral tokens to vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrower_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, collateral_amount)?;

    // Transfer SOL from treasury to borrower
    let treasury_bump = ctx.bumps.vault_authority;
    let treasury_seeds = &[TREASURY_SEED, &[treasury_bump]];
    let treasury_signer = &[&treasury_seeds[..]];

    **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? -= sol_loan_amount;
    **ctx.accounts.borrower.to_account_info().try_borrow_mut_lamports()? += sol_loan_amount;

    // Initialize loan account
    loan.borrower = ctx.accounts.borrower.key();
    loan.token_mint = ctx.accounts.token_mint.key();
    loan.collateral_amount = collateral_amount;
    loan.sol_borrowed = sol_loan_amount;
    loan.entry_price = token_price;
    loan.liquidation_price = liquidation_price;
    loan.interest_rate_bps = token_config.interest_rate_bps;
    loan.created_at = clock.unix_timestamp;
    loan.due_at = clock.unix_timestamp + duration_seconds as i64;
    loan.status = LoanStatus::Active;
    loan.index = protocol_state.total_loans_created;
    loan.bump = ctx.bumps.loan;

    // Update protocol state
    protocol_state.total_loans_created = SafeMath::add(protocol_state.total_loans_created, 1)?;
    protocol_state.total_sol_borrowed = SafeMath::add(protocol_state.total_sol_borrowed, sol_loan_amount)?;

    msg!(
        "Loan created: {} SOL borrowed against {} tokens (price: {})",
        sol_loan_amount,
        collateral_amount,
        token_price
    );
    
    Ok(())
}