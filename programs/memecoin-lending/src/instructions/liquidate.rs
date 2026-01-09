use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, CloseAccount, TokenAccount, Mint, TokenInterface};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::*;
use crate::swap::jupiter::execute_jupiter_swap;
use anchor_lang::solana_program::pubkey;

/// Fee split constants
const OPERATIONS_SPLIT_BPS: u64 = 500; // 5%
const BPS_DENOMINATOR: u64 = 10000;

/// Jupiter V6 Program ID
pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

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
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Vault authority PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, loan.key().as_ref()],
        bump
    )]
    pub vault_authority: SystemAccount<'info>,

    /// Token mint
    #[account(constraint = token_mint.key() == loan.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Pool account for price verification
    #[account(constraint = pool_account.key() == token_config.pool_address @ LendingError::InvalidPoolAddress)]
    pub pool_account: UncheckedAccount<'info>,

    /// PumpSwap base token vault - required when pool_type is PumpSwap
    /// CHECK: Validated in handler against pool data
    pub pumpswap_base_vault: Option<UncheckedAccount<'info>>,

    /// PumpSwap quote token vault (WSOL) - required when pool_type is PumpSwap
    /// CHECK: Validated in handler against pool data  
    pub pumpswap_quote_vault: Option<UncheckedAccount<'info>>,




    // === Common Accounts ===

    /// Payer for transaction fees - MUST be authorized liquidator
    #[account(
        mut,
        constraint = payer.key() == protocol_state.authorized_liquidator @ LendingError::UnauthorizedLiquidator
    )]
    pub payer: Signer<'info>,

    pub token_program: Interface<'info, TokenInterface>,
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

    // FIX 1: Reentrancy guard
    ReentrancyGuard::enter(protocol_state)?;

    // Extract values before mutable borrow
    let loan_key = ctx.accounts.loan.key();
    let token_mint_key = ctx.accounts.loan.token_mint;
    
    let loan = &mut ctx.accounts.loan;

    // Validate PumpSwap pool if pool_type is PumpSwap
    if token_config.pool_type == PoolType::PumpSwap {
        let (validated_base_vault, validated_quote_vault) = PumpSwapPoolValidator::validate_full(
            &ctx.accounts.pool_account,
            &token_mint_key,
        )?;
        
        // Verify the vault accounts passed match the ones in the pool
        let base_vault_info = ctx.accounts.pumpswap_base_vault
            .as_ref()
            .ok_or(LendingError::MissingPumpSwapVaults)?;
        let quote_vault_info = ctx.accounts.pumpswap_quote_vault
            .as_ref()
            .ok_or(LendingError::MissingPumpSwapVaults)?;
        
        require!(
            base_vault_info.key == &validated_base_vault,
            LendingError::InvalidPumpSwapVault
        );
        require!(
            quote_vault_info.key == &validated_quote_vault,
            LendingError::InvalidPumpSwapVault
        );
        
        msg!("PumpSwap pool validated: base_mint and quote_mint verified");
    }

    // === Step 1: Verify loan is liquidatable ===
    
    let pool_data = ctx.accounts.pool_account.try_borrow_data()?;

    let current_price = match token_config.pool_type {
        PoolType::PumpSwap => {
            // PumpSwap requires vault accounts to read balances
            let base_vault_info = ctx.accounts.pumpswap_base_vault
                .as_ref()
                .ok_or(LendingError::MissingPumpSwapVaults)?;
            let quote_vault_info = ctx.accounts.pumpswap_quote_vault
                .as_ref()
                .ok_or(LendingError::MissingPumpSwapVaults)?;
            
            // Parse vault accounts as token accounts to get balances
            let base_vault_data = base_vault_info.try_borrow_data()?;
            let quote_vault_data = quote_vault_info.try_borrow_data()?;
            
            // Token account amount is at offset 64 (after mint, owner, amount)
            let base_amount = u64::from_le_bytes(
                base_vault_data[64..72].try_into().map_err(|_| LendingError::InvalidPriceFeed)?
            );
            let quote_amount = u64::from_le_bytes(
                quote_vault_data[64..72].try_into().map_err(|_| LendingError::InvalidPriceFeed)?
            );
            
            PriceFeedUtils::read_pumpswap_price(
                &pool_data,
                base_amount,
                quote_amount,
                base_vault_info.key,
                quote_vault_info.key,
            )?
        },
        _ => {
            // For Raydium/Orca/PumpFun, read directly from pool
            PriceFeedUtils::read_price_from_pool(
                &ctx.accounts.pool_account,
                token_config.pool_type,
                &token_mint_key,
            )?
        }
    };

    drop(pool_data); // Release borrow before continuing

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

    // FIX 9: Add on-chain minimum slippage validation to prevent malicious liquidators
    let expected_sol_value = SafeMath::mul_div(
        collateral_amount,
        current_price,
        PRICE_SCALE as u64,
    )?;

    // Minimum output must be at least (100% - MAX_SLIPPAGE)% of expected value
    let min_acceptable_output = SafeMath::mul_div(
        expected_sol_value,
        BPS_DIVISOR - MAX_LIQUIDATION_SLIPPAGE_BPS,
        BPS_DIVISOR,
    )?;

    require!(
        min_sol_output >= min_acceptable_output,
        LendingError::SlippageTooHigh
    );


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
            // PumpFun tokens not supported for liquidation - tokens must migrate first
            return Err(LendingError::FeatureTemporarilyDisabled.into());
        },

        PoolType::Raydium | PoolType::Orca | PoolType::PumpSwap => {
            // Jupiter swap accounts provided via remaining_accounts
            
            let swap_data = jupiter_swap_data
                .ok_or(LendingError::MissingJupiterSwapData)?;

            // Get Jupiter route accounts from remaining_accounts
            let route_accounts: Vec<AccountInfo> = ctx.remaining_accounts.to_vec();
            
            require!(!route_accounts.is_empty(), LendingError::MissingJupiterAccounts);

            // Validate first account is Jupiter program
            let jupiter_program = &route_accounts[0];
            require!(
                jupiter_program.key() == JUPITER_V6_PROGRAM_ID,
                LendingError::InvalidJupiterProgram
            );
            require!(
                jupiter_program.executable,
                LendingError::InvalidJupiterProgram
            );

            // Execute Jupiter swap (jupiter_program is first account in remaining_accounts)
            execute_jupiter_swap(
                &route_accounts[0], // First remaining account should be Jupiter program
                &route_accounts[1..], // Rest are route accounts
                swap_data,
                vault_signer,
            )?;

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
    token_interface::close_account(close_ctx)?;

    // === Step 6: Update protocol state ===
    
    protocol_state.total_sol_borrowed = SafeMath::sub(protocol_state.total_sol_borrowed, sol_borrowed)?;
    protocol_state.active_loans_count = SafeMath::sub(protocol_state.active_loans_count, 1)?;
    protocol_state.total_fees_earned = SafeMath::add(protocol_state.total_fees_earned, treasury_share)?;
    
    token_config.active_loans_count = SafeMath::sub(token_config.active_loans_count, 1)?;
    
    // Update token exposure tracking - decrement borrowed amount  
    token_config.total_active_borrowed = SafeMath::sub(
        token_config.total_active_borrowed,
        sol_borrowed
    )?;

    // User exposure tracking removed for stack size optimization

    
    // FIX 1: Exit reentrancy guard
    ReentrancyGuard::exit(protocol_state);
    
    Ok(())
}