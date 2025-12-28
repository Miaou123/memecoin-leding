use anchor_lang::prelude::*;
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
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Vault authority PDA
    #[account(
        seeds = [VAULT_SEED, loan.token_mint.as_ref()],
        bump
    )]
    pub vault_authority: SystemAccount<'info>,

    #[account(
        constraint = token_mint.key() == loan.token_mint
    )]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    /// Pool program for price verification (Raydium/Orca)
    pub pool_program: AccountInfo<'info>,

    /// Pool account for current price
    #[account(
        constraint = pool_account.key() == token_config.pool_address @ LendingError::InvalidPoolAddress
    )]
    pub pool_account: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Liquidate>) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let token_config = &ctx.accounts.token_config;
    let loan = &mut ctx.accounts.loan;
    let clock = Clock::get()?;

    // Get current token price
    let current_price = PriceFeedUtils::get_token_price(&token_config.pool_address)?;

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

    // Calculate liquidation bonus
    let liquidation_bonus = LoanCalculator::calculate_liquidation_bonus(
        loan.collateral_amount,
        token_config.liquidation_bonus_bps,
    )?;

    // Calculate amounts
    let collateral_to_liquidator = SafeMath::add(loan.collateral_amount, liquidation_bonus)?;
    let remaining_collateral = if collateral_to_liquidator <= loan.collateral_amount {
        0
    } else {
        loan.collateral_amount - collateral_to_liquidator
    };

    // Liquidator must pay the loan debt in SOL
    let liquidator_payment = loan.sol_borrowed;
    
    // Check liquidator has sufficient SOL
    let liquidator_balance = ctx.accounts.liquidator.lamports();
    if liquidator_balance < liquidator_payment {
        return Err(LendingError::InsufficientTreasuryBalance.into());
    }

    // Transfer SOL from liquidator to treasury
    **ctx.accounts.liquidator.to_account_info().try_borrow_mut_lamports()? -= liquidator_payment;
    **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += liquidator_payment;

    // Transfer collateral (with bonus) to liquidator
    let vault_authority_bump = ctx.bumps.vault_authority;
    let vault_seeds = &[
        VAULT_SEED,
        loan.token_mint.as_ref(),
        &[vault_authority_bump],
    ];
    let vault_signer = &[&vault_seeds[..]];

    let transfer_amount = std::cmp::min(collateral_to_liquidator, loan.collateral_amount);
    let transfer_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.liquidator_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        vault_signer,
    );
    token::transfer(transfer_ctx, transfer_amount)?;

    // If there's remaining collateral, it stays in the vault (could be claimed by borrower later)
    // In a production system, you might want to return it to the borrower immediately

    // Update loan status
    loan.status = liquidation_reason;

    // Update protocol state
    protocol_state.total_sol_borrowed = SafeMath::sub(protocol_state.total_sol_borrowed, loan.sol_borrowed)?;

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