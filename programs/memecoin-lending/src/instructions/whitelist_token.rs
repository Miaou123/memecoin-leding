use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use crate::state::*;
use crate::error::LendingError;
use crate::utils::PumpSwapPoolValidator;

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct WhitelistToken<'info> {
    #[account(
        seeds = [PROTOCOL_STATE_SEED],
        bump = protocol_state.bump,
        constraint = !protocol_state.paused @ LendingError::ProtocolPaused,
        constraint = protocol_state.admin == admin.key() @ LendingError::Unauthorized
    )]
    pub protocol_state: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = admin,
        space = TokenConfig::LEN,
        seeds = [TOKEN_CONFIG_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Pool account - optional, only validated if pool_type is PumpSwap
    /// CHECK: Validated in handler if present and pool_type is PumpSwap
    pub pool_account: Option<UncheckedAccount<'info>>,

    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn whitelist_token_handler(
    ctx: Context<WhitelistToken>,
    tier: u8,
    pool_address: Pubkey,
    pool_type: u8,
    min_loan_amount: u64,
    max_loan_amount: u64,
    is_protocol_token: bool,
) -> Result<()> {
    let token_config = &mut ctx.accounts.token_config;
    
    // Validate tier
    let token_tier = match tier {
        0 => TokenTier::Bronze,
        1 => TokenTier::Silver,
        2 => TokenTier::Gold,
        _ => return Err(LendingError::InvalidTokenTier.into()),
    };

    // Validate pool type
    let pool_type = match pool_type {
        0 => PoolType::Raydium,
        1 => PoolType::Orca,
        2 => PoolType::Pumpfun,
        3 => PoolType::PumpSwap,
        _ => return Err(LendingError::InvalidPoolType.into()),
    };

    // WARNING: PumpFun pool type should not be used in production
    // Tokens must migrate to PumpSwap/Raydium for liquidation support
    if pool_type == PoolType::Pumpfun {
        msg!("WARNING: PumpFun pool type - liquidation will be disabled for this token");
        msg!("PumpFun tokens cannot be liquidated until they migrate to Raydium or PumpSwap");
    }

    // Validate pool address
    if pool_address == Pubkey::default() {
        return Err(LendingError::InvalidPoolAddress.into());
    }

    // Optional: Validate PumpSwap pool if pool_type is PumpSwap and pool_account is provided
    if pool_type == PoolType::PumpSwap {
        if let Some(pool_account_info) = &ctx.accounts.pool_account {
            // Validate pool account matches the provided address
            require!(
                pool_account_info.key == &pool_address,
                LendingError::InvalidPoolAddress
            );
            
            // Perform full validation
            match PumpSwapPoolValidator::validate_full(
                pool_account_info,
                &ctx.accounts.token_mint.key(),
            ) {
                Ok((base_vault, quote_vault)) => {
                    msg!("PumpSwap pool validated during whitelisting");
                    msg!("Base vault: {}", base_vault);
                    msg!("Quote vault: {}", quote_vault);
                },
                Err(e) => {
                    msg!("WARNING: PumpSwap pool validation failed: {:?}", e);
                    msg!("Pool may have invalid structure or incorrect token mint");
                    return Err(e);
                }
            }
        } else {
            msg!("WARNING: PumpSwap pool account not provided for validation");
            msg!("Pool will be validated during loan creation");
        }
    }

    // Validate loan amounts
    if min_loan_amount == 0 || max_loan_amount == 0 || min_loan_amount >= max_loan_amount {
        return Err(LendingError::InvalidLoanAmount.into());
    }

    // Set LTV based on tier or protocol token status
    let ltv_bps = if is_protocol_token {
        5000 // Protocol token always gets 50% LTV
    } else {
        match token_tier {
            TokenTier::Bronze => 2500, // 25% LTV
            TokenTier::Silver => 3500, // 35% LTV
            TokenTier::Gold => 5000,   // 50% LTV
        }
    };

    // Initialize token config
    token_config.mint = ctx.accounts.token_mint.key();
    token_config.tier = token_tier;
    token_config.enabled = true;
    token_config.pool_address = pool_address;
    token_config.pool_type = pool_type;
    token_config.ltv_bps = ltv_bps;
    token_config._deprecated_liquidation_bonus = 0; // Set to 0, field is deprecated
    token_config.min_loan_amount = min_loan_amount;
    token_config.max_loan_amount = max_loan_amount;
    token_config.active_loans_count = 0;
    token_config.total_volume = 0;
    token_config.total_active_borrowed = 0;
    token_config.is_protocol_token = is_protocol_token;
    token_config.blacklisted = false;
    token_config.bump = ctx.bumps.token_config;

    
    Ok(())
}