use anchor_lang::prelude::*;
use anchor_lang::system_program;
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
    pub system_program: Program<'info, System>,
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

    // FIX 1: Reentrancy guard
    ReentrancyGuard::enter(protocol_state)?;

    // Validate loan duration
    ValidationUtils::validate_loan_duration(duration_seconds)?;

    // Get current token price from pool
    let current_price = PriceFeedUtils::read_price_from_pool(
        &ctx.accounts.pool_account,
        token_config.pool_type,
        &token_config.mint,
    )?;
    
    require!(current_price > 0, LendingError::ZeroPrice);
    
    // FIX 6: Validate minimum collateral value
    let collateral_value = SafeMath::mul_div(
        collateral_amount,
        current_price,
        PRICE_SCALE as u64,
    )?;
    require!(
        collateral_value >= MIN_COLLATERAL_VALUE_LAMPORTS,
        LendingError::CollateralValueTooLow
    );

    // Calculate duration-adjusted LTV
    let effective_ltv = LoanCalculator::calculate_duration_adjusted_ltv(
        token_config.ltv_bps,
        duration_seconds,
    )?;

    msg!(
        "LTV adjustment: base={} bps, duration={}s, effective={} bps",
        token_config.ltv_bps,
        duration_seconds,
        effective_ltv
    );

    // Calculate loan amount based on duration-adjusted LTV
    let sol_loan_amount = LoanCalculator::calculate_loan_amount(
        collateral_amount,
        current_price,
        effective_ltv,
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

    // ============================================================
    // SECURITY CHECK 1: Dynamic Max Single Loan (10% of treasury)
    // ============================================================
    let max_single_loan = SafeMath::mul_div(
        treasury_balance,
        MAX_SINGLE_LOAN_BPS as u64,
        BPS_DIVISOR
    )?;

    require!(
        sol_loan_amount <= max_single_loan,
        LendingError::SingleLoanTooLarge
    );

    msg!(
        "Single loan check: {} <= {} (10% of treasury)", 
        sol_loan_amount, 
        max_single_loan
    );

    // ============================================================
    // SECURITY CHECK 2: Per-Token Exposure Limit (10% of treasury)
    // ============================================================
    let max_token_exposure = SafeMath::mul_div(
        treasury_balance,
        MAX_TOKEN_EXPOSURE_BPS as u64,
        BPS_DIVISOR
    )?;

    let new_token_exposure = SafeMath::add(
        token_config.total_active_borrowed,
        sol_loan_amount
    )?;

    require!(
        new_token_exposure <= max_token_exposure,
        LendingError::TokenExposureTooHigh
    );

    msg!(
        "Token exposure check: {} <= {} (10% of treasury)", 
        new_token_exposure, 
        max_token_exposure
    );

    // Note: User exposure tracking removed to fix stack overflow
    // Can be re-implemented in a separate instruction if needed

    // ============================================================
    // SECURITY CHECK 4: Minimum Loan Amount (0.01 SOL)
    // ============================================================
    require!(
        sol_loan_amount >= MIN_COLLATERAL_VALUE_LAMPORTS,
        LendingError::LoanAmountTooLow
    );

    // Calculate liquidation price with updated buffer (40% drop triggers liquidation)
    let liquidation_price = LoanCalculator::calculate_liquidation_price(
        sol_loan_amount,
        collateral_amount,
        token_config.ltv_bps,
        4000, // 40% liquidation buffer (was DEFAULT_LIQUIDATION_BUFFER_BPS = 3%)
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

    // Update token config exposure tracking
    token_config.total_active_borrowed = SafeMath::add(
        token_config.total_active_borrowed,
        sol_loan_amount
    )?;

    // User exposure tracking removed for stack size optimization

    msg!(
        "Loan created: {} SOL borrowed against {} tokens (price: {})",
        sol_loan_amount,
        collateral_amount,
        current_price
    );
    
    // FIX 1: Exit reentrancy guard
    ReentrancyGuard::exit(protocol_state);
    
    Ok(())
}