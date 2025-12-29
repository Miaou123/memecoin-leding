use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;

#[derive(Accounts)]
pub struct Liquidate<'info> {
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
        constraint = loan.status == LoanStatus::Active @ LendingError::LoanAlreadyRepaid
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
    pub liquidator: Signer<'info>,

    /// Liquidator's token account (to receive collateral)
    #[account(
        mut,
        constraint = liquidator_token_account.owner == liquidator.key() @ LendingError::InvalidTokenAccountOwner,
        constraint = liquidator_token_account.mint == loan.token_mint
    )]
    pub liquidator_token_account: Account<'info, TokenAccount>,

    /// Protocol vault token account storing collateral
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

    /// CHECK: Pool program for price verification - validated by pool_account constraint
    pub pool_program: AccountInfo<'info>,

    /// CHECK: Pool account validated against token_config.pool_address
    #[account(
        constraint = pool_account.key() == token_config.pool_address @ LendingError::InvalidPoolAddress
    )]
    pub pool_account: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn liquidate_handler(ctx: Context<Liquidate>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let token_config = &ctx.accounts.token_config;
    let clock = Clock::get()?;

    // Store loan data before taking mutable borrow
    let token_mint_key = ctx.accounts.loan.token_mint;
    let borrower = ctx.accounts.loan.borrower;
    let loan_index = ctx.accounts.loan.index;
    let loan_bump = ctx.accounts.loan.bump;
    let loan_authority = ctx.accounts.loan.to_account_info();
    
    // Now borrow loan mutably
    let loan = &mut ctx.accounts.loan;

    // Get current token price
    let current_price = PriceFeedUtils::read_price_from_pool(
        &ctx.accounts.pool_account,
        token_config.pool_type,
        &token_mint_key,
    )?;

    // Check if loan is liquidatable
    let liquidatable_by_time = ValidationUtils::is_loan_liquidatable_by_time(loan, clock.unix_timestamp);
    let liquidatable_by_price = ValidationUtils::is_loan_liquidatable_by_price(loan, current_price);

    if !liquidatable_by_time && !liquidatable_by_price {
        return Err(LendingError::LoanNotLiquidatable.into());
    }

    // Determine liquidation reason
    let liquidation_reason = if liquidatable_by_time && liquidatable_by_price {
        // Both conditions met, prioritize price-based
        LoanStatus::LiquidatedPrice
    } else if liquidatable_by_time {
        LoanStatus::LiquidatedTime
    } else {
        LoanStatus::LiquidatedPrice
    };

    // Store values we need before updating loan status
    let collateral_amount = loan.collateral_amount;
    let sol_borrowed = loan.sol_borrowed;
    
    // Calculate liquidation bonus
    let liquidation_bonus = LoanCalculator::calculate_liquidation_bonus(
        collateral_amount,
        token_config.liquidation_bonus_bps,
    )?;

    // Calculate amounts
    let collateral_to_liquidator = SafeMath::add(collateral_amount, liquidation_bonus)?;
    let _remaining_collateral = if collateral_to_liquidator <= collateral_amount {
        0
    } else {
        collateral_amount - collateral_to_liquidator
    };

    // Liquidator must pay the loan debt in SOL
    let liquidator_payment = sol_borrowed;
    
    // Update loan status BEFORE CPI
    loan.status = liquidation_reason;
    
    // Check liquidator has sufficient SOL
    let liquidator_balance = ctx.accounts.liquidator.lamports();
    if liquidator_balance < liquidator_payment {
        return Err(LendingError::InsufficientTreasuryBalance.into());
    }

    // Transfer SOL from liquidator to treasury using CPI
    // Liquidator is a signer, so we use regular CpiContext
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.liquidator.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            },
        ),
        liquidator_payment,
    )?;

    // Transfer collateral (with bonus) to liquidator using loan PDA as signer
    let loan_seeds: &[&[u8]] = &[
        LOAN_SEED,
        borrower.as_ref(),
        token_mint_key.as_ref(),
        &loan_index.to_le_bytes(),
        &[loan_bump],
    ];
    let loan_signer_seeds = &[loan_seeds];

    let transfer_amount = std::cmp::min(collateral_to_liquidator, collateral_amount);
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.liquidator_token_account.to_account_info(),
            authority: loan_authority,
        },
        loan_signer_seeds,
    );
    token::transfer(transfer_ctx, transfer_amount)?;

    // If there's remaining collateral, it stays in the vault (could be claimed by borrower later)
    // In a production system, you might want to return it to the borrower immediately

    // Loan status already updated above

    // Update protocol state
    protocol_state.total_sol_borrowed = SafeMath::sub(protocol_state.total_sol_borrowed, sol_borrowed)?;
    protocol_state.active_loans_count = SafeMath::sub(protocol_state.active_loans_count, 1)?;
    
    // Update token config counters
    let token_config = &mut ctx.accounts.token_config;
    token_config.active_loans_count = SafeMath::sub(token_config.active_loans_count, 1)?;

    // Calculate liquidation fee for protocol (small percentage)
    let liquidation_fee = SafeMath::mul_div(liquidator_payment, 100, BPS_DIVISOR)?; // 1% fee
    protocol_state.total_interest_earned = SafeMath::add(protocol_state.total_interest_earned, liquidation_fee)?;

    msg!(
        "Loan liquidated: reason={:?}, payment={} SOL, collateral={} tokens",
        liquidation_reason,
        liquidator_payment,
        transfer_amount
    );
    
    Ok(())
}