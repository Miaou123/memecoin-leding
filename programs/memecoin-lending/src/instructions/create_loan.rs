use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

/// Get duration-based interest rate multiplier
fn get_duration_multiplier(duration_seconds: u64) -> u16 {
    const HOUR: u64 = 3600;
    if duration_seconds <= 12 * HOUR {
        150  // 1.5x for ≤12h
    } else if duration_seconds <= 24 * HOUR {
        125  // 1.25x for ≤24h
    } else if duration_seconds <= 48 * HOUR {
        100  // 1.0x for ≤48h
    } else {
        75   // 0.75x for >48h
    }
}

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
        mut,
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

    /// Vault token account for THIS loan's collateral
    #[account(
        init,
        payer = borrower,
        token::mint = token_mint,
        token::authority = loan, // Loan PDA is the authority
        seeds = [b"vault", loan.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Pool account for price reading
    /// CHECK: Validated by token_config.pool_address constraint
    #[account(
        constraint = pool_account.key() == token_config.pool_address @ LendingError::InvalidPoolAddress
    )]
    pub pool_account: UncheckedAccount<'info>,

    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn create_loan_handler(
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

    // Get current token price from pool
    let current_price = PriceFeedUtils::read_price_from_pool(
        &ctx.accounts.pool_account,
        token_config.pool_type,
        &token_config.mint,
    )?;
    
    require!(current_price > 0, LendingError::ZeroPrice);
    
    // Add duration-based interest multiplier
    let duration_multiplier = get_duration_multiplier(duration_seconds);
    let base_rate = token_config.interest_rate_bps;
    let effective_rate = (base_rate as u64 * duration_multiplier as u64 / 100) as u16;

    // Calculate loan amount based on LTV
    let sol_loan_amount = LoanCalculator::calculate_loan_amount(
        collateral_amount,
        current_price,
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

    // Transfer collateral tokens to loan's vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrower_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.borrower.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, collateral_amount)?;

    // Transfer SOL from treasury to borrower using CPI with PDA signer
    let treasury_bump = ctx.bumps.treasury;
    let treasury_seeds: &[&[u8]] = &[TREASURY_SEED, &[treasury_bump]];
    let treasury_signer_seeds = &[treasury_seeds];

    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.treasury.to_account_info(),
                to: ctx.accounts.borrower.to_account_info(),
            },
            treasury_signer_seeds,
        ),
        sol_loan_amount,
    )?;

    // Initialize loan account
    loan.borrower = ctx.accounts.borrower.key();
    loan.token_mint = ctx.accounts.token_mint.key();
    loan.collateral_amount = collateral_amount;
    loan.sol_borrowed = sol_loan_amount;
    loan.entry_price = current_price;
    loan.liquidation_price = liquidation_price;
    loan.interest_rate_bps = effective_rate;
    loan.created_at = clock.unix_timestamp;
    loan.due_at = clock.unix_timestamp + duration_seconds as i64;
    loan.status = LoanStatus::Active;
    loan.index = protocol_state.total_loans_created;
    loan.bump = ctx.bumps.loan;

    // Update protocol state and token config
    protocol_state.total_loans_created = SafeMath::add(protocol_state.total_loans_created, 1)?;
    protocol_state.total_sol_borrowed = SafeMath::add(protocol_state.total_sol_borrowed, sol_loan_amount)?;
    protocol_state.active_loans_count = SafeMath::add(protocol_state.active_loans_count, 1)?;
    
    // Update token config counters
    let token_config = &mut ctx.accounts.token_config;
    token_config.active_loans_count = SafeMath::add(token_config.active_loans_count, 1)?;
    token_config.total_volume = SafeMath::add(token_config.total_volume, sol_loan_amount)?;

    msg!(
        "Loan created: {} SOL borrowed against {} tokens (price: {})",
        sol_loan_amount,
        collateral_amount,
        current_price
    );
    
    Ok(())
}