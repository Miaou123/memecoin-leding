use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, CloseAccount};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;
use crate::swap::pumpfun::{
    self, execute_pumpfun_sell, get_bonding_curve_pda, calculate_pumpfun_sell_output,
    PUMPFUN_PROGRAM_ID, PUMPFUN_GLOBAL, PUMPFUN_FEE_RECIPIENT, PUMPFUN_EVENT_AUTHORITY,
};
use crate::swap::jupiter::{self, execute_jupiter_swap, JUPITER_V6_PROGRAM_ID};

/// Fee split constants
const TREASURY_SPLIT_BPS: u64 = 9500;  // 95%
const OPERATIONS_SPLIT_BPS: u64 = 500; // 5%
const BPS_DENOMINATOR: u64 = 10000;

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

    /// Protocol treasury - receives 95% of proceeds
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    /// Operations wallet - receives 5% of proceeds
    #[account(
        mut,
        constraint = operations_wallet.key() == protocol_state.operations_wallet @ LendingError::Unauthorized
    )]
    pub operations_wallet: SystemAccount<'info>,

    /// Vault token account holding collateral
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// Vault authority PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, loan.key().as_ref()],
        bump
    )]
    pub vault_authority: SystemAccount<'info>,

    /// Token mint
    #[account(constraint = token_mint.key() == loan.token_mint)]
    pub token_mint: Account<'info, anchor_spl::token::Mint>,

    /// CHECK: Pool account for price verification
    #[account(constraint = pool_account.key() == token_config.pool_address @ LendingError::InvalidPoolAddress)]
    pub pool_account: AccountInfo<'info>,

    // === PumpFun Accounts (optional, for PumpFun swaps) ===
    
    /// CHECK: PumpFun program
    #[account(address = PUMPFUN_PROGRAM_ID)]
    pub pumpfun_program: Option<AccountInfo<'info>>,

    /// CHECK: PumpFun global state
    #[account(address = PUMPFUN_GLOBAL)]
    pub pumpfun_global: Option<AccountInfo<'info>>,

    /// CHECK: PumpFun fee recipient
    #[account(mut, address = PUMPFUN_FEE_RECIPIENT)]
    pub pumpfun_fee_recipient: Option<AccountInfo<'info>>,

    /// CHECK: PumpFun bonding curve for this token
    #[account(mut)]
    pub bonding_curve: Option<AccountInfo<'info>>,

    /// CHECK: Bonding curve token account
    #[account(mut)]
    pub bonding_curve_token_account: Option<AccountInfo<'info>>,

    /// CHECK: PumpFun event authority
    #[account(address = PUMPFUN_EVENT_AUTHORITY)]
    pub pumpfun_event_authority: Option<AccountInfo<'info>>,

    // === Jupiter Accounts (optional, for Jupiter swaps) ===
    
    /// CHECK: Jupiter V6 program
    #[account(address = JUPITER_V6_PROGRAM_ID)]
    pub jupiter_program: Option<AccountInfo<'info>>,

    // === Common Accounts ===

    /// Payer for transaction fees
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    
    // Remaining accounts: Jupiter route accounts (when using Jupiter)
}

pub fn liquidate_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, Liquidate<'info>>,
    min_sol_output: u64,
    jupiter_swap_data: Option<Vec<u8>>,
) -> Result<()> {
    let protocol_state = &mut ctx.accounts.protocol_state;
    let token_config = &mut ctx.accounts.token_config;
    let clock = Clock::get()?;

    // Extract values before mutable borrow
    let loan_key = ctx.accounts.loan.key();
    let token_mint_key = ctx.accounts.loan.token_mint;
    
    let loan = &mut ctx.accounts.loan;

    // === Step 1: Verify loan is liquidatable ===
    
    let current_price = PriceFeedUtils::read_price_from_pool(
        &ctx.accounts.pool_account,
        token_config.pool_type,
        &token_mint_key,
    )?;

    let liquidatable_by_time = ValidationUtils::is_loan_liquidatable_by_time(loan, clock.unix_timestamp);
    let liquidatable_by_price = ValidationUtils::is_loan_liquidatable_by_price(loan, current_price);

    require!(
        liquidatable_by_time || liquidatable_by_price,
        LendingError::LoanNotLiquidatable
    );

    let liquidation_reason = if liquidatable_by_price {
        LoanStatus::LiquidatedPrice
    } else {
        LoanStatus::LiquidatedTime
    };

    // Store values
    let collateral_amount = loan.collateral_amount;
    let sol_borrowed = loan.sol_borrowed;

    // Update loan status
    loan.status = liquidation_reason;

    // === Step 2: Build vault signer seeds ===
    
    let vault_authority_bump = ctx.bumps.vault_authority;
    let vault_seeds = &[
        VAULT_SEED,
        loan_key.as_ref(),
        &[vault_authority_bump],
    ];
    let vault_signer = &[&vault_seeds[..]];

    // === Step 3: Execute swap based on pool type ===
    
    let sol_before = ctx.accounts.vault_authority.lamports();

    match token_config.pool_type {
        PoolType::Pumpfun => {
            // Validate PumpFun accounts are provided
            let pumpfun_program = ctx.accounts.pumpfun_program
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;
            let global = ctx.accounts.pumpfun_global
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;
            let fee_recipient = ctx.accounts.pumpfun_fee_recipient
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;
            let bonding_curve = ctx.accounts.bonding_curve
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;
            let bonding_curve_token_account = ctx.accounts.bonding_curve_token_account
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;
            let event_authority = ctx.accounts.pumpfun_event_authority
                .as_ref()
                .ok_or(LendingError::MissingPumpfunAccounts)?;

            // Validate bonding curve PDA
            let (expected_bc, _) = get_bonding_curve_pda(&token_mint_key);
            require!(
                bonding_curve.key() == expected_bc,
                LendingError::InvalidBondingCurve
            );

            // Execute PumpFun sell
            execute_pumpfun_sell(
                pumpfun_program,
                global,
                fee_recipient,
                &ctx.accounts.token_mint.to_account_info(),
                bonding_curve,
                bonding_curve_token_account,
                &ctx.accounts.vault_token_account.to_account_info(),
                &ctx.accounts.vault_authority.to_account_info(),
                &ctx.accounts.system_program.to_account_info(),
                &ctx.accounts.associated_token_program.to_account_info(),
                &ctx.accounts.token_program.to_account_info(),
                event_authority,
                collateral_amount,
                min_sol_output,
                vault_signer,
            )?;

            msg!("PumpFun sell executed: {} tokens", collateral_amount);
        },

        PoolType::Raydium | PoolType::Orca | PoolType::PumpSwap => {
            // Validate Jupiter accounts are provided
            let jupiter_program = ctx.accounts.jupiter_program
                .as_ref()
                .ok_or(LendingError::MissingJupiterAccounts)?;
            
            let swap_data = jupiter_swap_data
                .ok_or(LendingError::MissingJupiterSwapData)?;

            // Get Jupiter route accounts from remaining_accounts
            let route_accounts: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            
            require!(!route_accounts.is_empty(), LendingError::MissingJupiterAccounts);

            // Execute Jupiter swap
            execute_jupiter_swap(
                jupiter_program,
                &route_accounts,
                swap_data,
                vault_signer,
            )?;

            msg!("Jupiter swap executed: {} tokens", collateral_amount);
        },
    }

    // === Step 4: Calculate proceeds and split ===
    
    let sol_after = ctx.accounts.vault_authority.lamports();
    let sol_proceeds = sol_after
        .checked_sub(sol_before)
        .ok_or(LendingError::MathUnderflow)?;

    // Verify minimum output
    require!(sol_proceeds >= min_sol_output, LendingError::SlippageExceeded);

    // Calculate split
    let operations_share = sol_proceeds
        .checked_mul(OPERATIONS_SPLIT_BPS)
        .ok_or(LendingError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(LendingError::DivisionByZero)?;
    
    let treasury_share = sol_proceeds
        .checked_sub(operations_share)
        .ok_or(LendingError::MathUnderflow)?;

    // Transfer SOL to treasury and operations wallet
    **ctx.accounts.vault_authority.to_account_info().try_borrow_mut_lamports()? -= sol_proceeds;
    **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += treasury_share;
    **ctx.accounts.operations_wallet.to_account_info().try_borrow_mut_lamports()? += operations_share;

    // === Step 5: Close vault token account ===
    
    let close_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault_token_account.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        vault_signer,
    );
    token::close_account(close_ctx)?;

    // === Step 6: Update protocol state ===
    
    protocol_state.total_sol_borrowed = SafeMath::sub(protocol_state.total_sol_borrowed, sol_borrowed)?;
    protocol_state.active_loans_count = SafeMath::sub(protocol_state.active_loans_count, 1)?;
    protocol_state.total_fees_earned = SafeMath::add(protocol_state.total_fees_earned, treasury_share)?;
    
    token_config.active_loans_count = SafeMath::sub(token_config.active_loans_count, 1)?;

    msg!(
        "Loan liquidated: reason={:?}, collateral={}, proceeds={} SOL (treasury={}, ops={})",
        liquidation_reason,
        collateral_amount,
        sol_proceeds,
        treasury_share,
        operations_share
    );
    
    Ok(())
}