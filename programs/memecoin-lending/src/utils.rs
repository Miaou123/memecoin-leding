use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::error::LendingError;
use crate::state::*;

/// Constants
pub const BPS_DIVISOR: u64 = 10_000;
pub const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;
pub const MAX_LOAN_DURATION: u64 = 7 * 24 * 60 * 60; // 7 days
pub const MIN_LOAN_DURATION: u64 = 12 * 60 * 60; // 12 hours
pub const PRICE_STALENESS_THRESHOLD: i64 = 60; // 60 seconds
pub const MAX_PRICE_DEVIATION_BPS: u64 = 500; // 5%

/// TWAP configuration
pub const TWAP_WINDOW_SECONDS: i64 = 300; // 5 minute window
pub const MIN_TWAP_SAMPLES: u8 = 3;

/// Price checkpoint for TWAP calculation
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PriceCheckpoint {
    pub price: u64,
    pub timestamp: i64,
}

/// Math utilities with overflow protection
pub struct SafeMath;

impl SafeMath {
    pub fn add(a: u64, b: u64) -> Result<u64> {
        a.checked_add(b).ok_or(LendingError::MathOverflow.into())
    }

    pub fn sub(a: u64, b: u64) -> Result<u64> {
        a.checked_sub(b).ok_or(LendingError::MathUnderflow.into())
    }

    pub fn mul(a: u64, b: u64) -> Result<u64> {
        // Use u128 to prevent overflow
        let result = (a as u128).checked_mul(b as u128)
            .ok_or(LendingError::MathOverflow)?;
        if result > u64::MAX as u128 {
            return Err(LendingError::MathOverflow.into());
        }
        Ok(result as u64)
    }

    pub fn div(a: u64, b: u64) -> Result<u64> {
        if b == 0 {
            return Err(LendingError::DivisionByZero.into());
        }
        Ok(a / b)
    }

    pub fn mul_div(a: u64, b: u64, c: u64) -> Result<u64> {
        if c == 0 {
            return Err(LendingError::DivisionByZero.into());
        }
        let product = (a as u128)
            .checked_mul(b as u128)
            .ok_or(LendingError::MathOverflow)?;
        let result = product / (c as u128);
        if result > u64::MAX as u128 {
            return Err(LendingError::MathOverflow.into());
        }
        Ok(result as u64)
    }
}

/// Loan calculation utilities
pub struct LoanCalculator;

impl LoanCalculator {
    /// Calculate SOL amount to lend based on collateral and LTV
    pub fn calculate_loan_amount(
        collateral_amount: u64,
        token_price: u64,
        ltv_bps: u16,
    ) -> Result<u64> {
        // Use u128 for the entire calculation to prevent overflow
        const PRICE_SCALE: u128 = 1_000_000_000; // 10^9 - matches read_pumpfun_price scaling // 10^6
        
        let collateral_u128 = collateral_amount as u128;
        let price_u128 = token_price as u128;
        let ltv_u128 = ltv_bps as u128;
        let bps_divisor_u128 = BPS_DIVISOR as u128;
        
        // Calculate: (collateral_amount * token_price * ltv_bps) / (PRICE_SCALE * BPS_DIVISOR)
        let loan_amount = collateral_u128
            .checked_mul(price_u128).ok_or(LendingError::MathOverflow)?
            .checked_mul(ltv_u128).ok_or(LendingError::MathOverflow)?
            .checked_div(PRICE_SCALE).ok_or(LendingError::DivisionByZero)?
            .checked_div(bps_divisor_u128).ok_or(LendingError::DivisionByZero)?;
        
        if loan_amount > u64::MAX as u128 {
            return Err(LendingError::MathOverflow.into());
        }
        
        Ok(loan_amount as u64)
    }

    /// Calculate interest owed on a loan
    pub fn calculate_interest(
        principal: u64,
        interest_rate_bps: u16,
        duration_seconds: u64,
    ) -> Result<u64> {
        let annual_interest = SafeMath::mul_div(principal, interest_rate_bps as u64, BPS_DIVISOR)?;
        SafeMath::mul_div(annual_interest, duration_seconds, SECONDS_PER_YEAR)
    }

    /// Calculate total amount owed (principal + interest + protocol fee)
    pub fn calculate_total_owed(
        principal: u64,
        interest_rate_bps: u16,
        duration_seconds: u64,
        protocol_fee_bps: u16,
    ) -> Result<u64> {
        let interest = Self::calculate_interest(principal, interest_rate_bps, duration_seconds)?;
        let protocol_fee = SafeMath::mul_div(principal, protocol_fee_bps as u64, BPS_DIVISOR)?;
        
        let total = SafeMath::add(principal, interest)?;
        SafeMath::add(total, protocol_fee)
    }

    /// Calculate liquidation price
    pub fn calculate_liquidation_price(
        sol_borrowed: u64,
        collateral_amount: u64,
        ltv_bps: u16,
        liquidation_buffer_bps: u16,
    ) -> Result<u64> {
        let effective_ltv = SafeMath::add(ltv_bps as u64, liquidation_buffer_bps as u64)?;
        SafeMath::mul_div(sol_borrowed, BPS_DIVISOR, SafeMath::mul_div(collateral_amount, effective_ltv, BPS_DIVISOR)?)
    }

    /// Calculate liquidation bonus for liquidator
    pub fn calculate_liquidation_bonus(
        collateral_amount: u64,
        liquidation_bonus_bps: u16,
    ) -> Result<u64> {
        SafeMath::mul_div(collateral_amount, liquidation_bonus_bps as u64, BPS_DIVISOR)
    }

    /// Calculate loan health factor (>1 = healthy, <1 = liquidatable)
    /// Returns value in basis points (10000 = 1.0)
    pub fn calculate_health_factor(
        collateral_value: u64,  // in SOL
        debt_value: u64,        // in SOL (principal + accrued interest)
        ltv_bps: u16,
    ) -> Result<u64> {
        if debt_value == 0 {
            return Ok(u64::MAX); // No debt = infinitely healthy
        }
        
        // health = (collateral * ltv) / debt
        let max_borrow = SafeMath::mul_div(collateral_value, ltv_bps as u64, BPS_DIVISOR)?;
        SafeMath::mul_div(max_borrow, BPS_DIVISOR, debt_value)
    }
    
    /// Check if loan is healthy
    pub fn is_loan_healthy(health_factor: u64) -> bool {
        health_factor >= BPS_DIVISOR // >= 1.0
    }
}

/// Price feed utilities with real on-chain price reading
pub struct PriceFeedUtils;

impl PriceFeedUtils {
    /// Read price from Raydium AMM pool
    pub fn read_raydium_price(pool_data: &[u8], _token_mint: &Pubkey, sol_mint: &Pubkey) -> Result<u64> {
        // Raydium AMM pool layout offsets
        const TOKEN_A_AMOUNT_OFFSET: usize = 128;
        const TOKEN_B_AMOUNT_OFFSET: usize = 136;
        const TOKEN_A_MINT_OFFSET: usize = 400;
        const TOKEN_B_MINT_OFFSET: usize = 432;
        
        require!(pool_data.len() >= 464, LendingError::InvalidPriceFeed);
        
        let token_a_amount = u64::from_le_bytes(
            pool_data[TOKEN_A_AMOUNT_OFFSET..TOKEN_A_AMOUNT_OFFSET + 8].try_into().unwrap()
        );
        let token_b_amount = u64::from_le_bytes(
            pool_data[TOKEN_B_AMOUNT_OFFSET..TOKEN_B_AMOUNT_OFFSET + 8].try_into().unwrap()
        );
        
        let token_a_mint = Pubkey::try_from(&pool_data[TOKEN_A_MINT_OFFSET..TOKEN_A_MINT_OFFSET + 32]).unwrap();
        let token_b_mint = Pubkey::try_from(&pool_data[TOKEN_B_MINT_OFFSET..TOKEN_B_MINT_OFFSET + 32]).unwrap();
        
        // Determine which token is SOL and calculate price
        let (sol_amount, token_amount) = if token_a_mint == *sol_mint {
            (token_a_amount, token_b_amount)
        } else if token_b_mint == *sol_mint {
            (token_b_amount, token_a_amount)
        } else {
            return Err(LendingError::InvalidPriceFeed.into());
        };
        
        require!(token_amount > 0, LendingError::InvalidPriceFeed);
        
        // Price in lamports per token (with 9 decimal precision)
        let price = (sol_amount as u128)
            .checked_mul(1_000_000_000)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(token_amount as u128)
            .ok_or(LendingError::DivisionByZero)? as u64;
        
        Ok(price)
    }

    /// Read price from Pumpfun bonding curve
    pub fn read_pumpfun_price(pool_data: &[u8]) -> Result<u64> {
        const VIRTUAL_SOL_OFFSET: usize = 16;
        const VIRTUAL_TOKEN_OFFSET: usize = 8;
        
        require!(pool_data.len() >= 24, LendingError::InvalidPriceFeed);
        
        let virtual_sol = u64::from_le_bytes(
            pool_data[VIRTUAL_SOL_OFFSET..VIRTUAL_SOL_OFFSET + 8].try_into().unwrap()
        );
        let virtual_token = u64::from_le_bytes(
            pool_data[VIRTUAL_TOKEN_OFFSET..VIRTUAL_TOKEN_OFFSET + 8].try_into().unwrap()
        );
        
        require!(virtual_token > 0, LendingError::InvalidPriceFeed);
        
        // Calculate price per token in lamports
        // Price = virtual_sol_reserves * 10^6 / virtual_token_reserves
        // This gives us lamports per smallest token unit (matches SDK calculation)
        let price = (virtual_sol as u128)
            .checked_mul(1_000_000_000) // 10^9 to match PRICE_SCALE in calculate_loan_amount
            .ok_or(LendingError::MathOverflow)?
            .checked_div(virtual_token as u128)
            .ok_or(LendingError::DivisionByZero)?;
        
        if price > u64::MAX as u128 {
            return Err(LendingError::MathOverflow.into());
        }
        
        Ok(price as u64)
    }

    /// Unified price reader based on pool type
    pub fn read_price_from_pool(
        pool_account: &AccountInfo,
        pool_type: PoolType,
        token_mint: &Pubkey,
    ) -> Result<u64> {
        let pool_data = pool_account.try_borrow_data()?;
        let sol_mint = pubkey!("So11111111111111111111111111111111111111112");
        
        match pool_type {
            PoolType::Raydium | PoolType::Orca => Self::read_raydium_price(&pool_data, token_mint, &sol_mint),
            PoolType::Pumpfun | PoolType::PumpSwap => Self::read_pumpfun_price(&pool_data),
        }
    }

    /// Validate price freshness
    pub fn is_price_fresh(price_timestamp: i64, current_timestamp: i64) -> bool {
        current_timestamp - price_timestamp < PRICE_STALENESS_THRESHOLD
    }

    /// Validate price deviation is within acceptable range
    pub fn validate_price_deviation(old_price: u64, new_price: u64) -> Result<()> {
        if old_price == 0 {
            return Ok(()); // First price reading
        }

        let price_diff = if new_price > old_price {
            new_price - old_price
        } else {
            old_price - new_price
        };

        let deviation_bps = SafeMath::mul_div(price_diff, BPS_DIVISOR, old_price)?;
        
        if deviation_bps > MAX_PRICE_DEVIATION_BPS {
            return Err(LendingError::PriceDeviationTooHigh.into());
        }

        Ok(())
    }

    /// Get token price - wrapper for read_price_from_pool
    /// Used when you have the pool account info available
    pub fn get_token_price(
        pool_account: &AccountInfo,
        pool_type: PoolType,
        token_mint: &Pubkey,
    ) -> Result<u64> {
        Self::read_price_from_pool(pool_account, pool_type, token_mint)
    }

    /// Validate price against recent checkpoint (anti-manipulation)
    pub fn validate_price_safety(
        current_price: u64,
        last_checkpoint_price: u64,
        last_checkpoint_time: i64,
        current_time: i64,
    ) -> Result<()> {
        // If checkpoint is recent (within TWAP window), check deviation
        if current_time - last_checkpoint_time < TWAP_WINDOW_SECONDS {
            Self::validate_price_deviation(last_checkpoint_price, current_price)?;
        }
        Ok(())
    }
    
    /// Calculate simple moving average price
    pub fn calculate_average_price(prices: &[u64]) -> Result<u64> {
        if prices.is_empty() {
            return Err(LendingError::InvalidPriceFeed.into());
        }
        
        let sum: u128 = prices.iter().map(|&p| p as u128).sum();
        let avg = sum / prices.len() as u128;
        
        if avg > u64::MAX as u128 {
            return Err(LendingError::MathOverflow.into());
        }
        
        Ok(avg as u64)
    }

    /// Read price from pool with validation
    pub fn read_price_from_pool_with_validation(
        pool_account: &AccountInfo,
        pool_type: PoolType,
        token_mint: &Pubkey,
        current_timestamp: i64,
        last_price_timestamp: i64,
    ) -> Result<u64> {
        // Check staleness
        if !Self::is_price_fresh(last_price_timestamp, current_timestamp) {
            return Err(LendingError::StalePriceFeed.into());
        }
        
        Self::read_price_from_pool(pool_account, pool_type, token_mint)
    }

}

/// Validation utilities
pub struct ValidationUtils;

impl ValidationUtils {
    /// Validate loan duration
    pub fn validate_loan_duration(duration_seconds: u64) -> Result<()> {
        if duration_seconds < MIN_LOAN_DURATION {
            return Err(LendingError::InvalidLoanDuration.into());
        }
        if duration_seconds > MAX_LOAN_DURATION {
            return Err(LendingError::InvalidLoanDuration.into());
        }
        Ok(())
    }

    /// Check if loan is liquidatable (by time)
    pub fn is_loan_liquidatable_by_time(loan: &Loan, current_time: i64) -> bool {
        current_time > loan.due_at
    }

    /// Check if loan is liquidatable (by price)
    pub fn is_loan_liquidatable_by_price(loan: &Loan, current_price: u64) -> bool {
        current_price <= loan.liquidation_price
    }

    /// Validate token account ownership
    pub fn validate_token_account_owner(
        token_account: &Account<TokenAccount>,
        expected_owner: &Pubkey,
    ) -> Result<()> {
        if &token_account.owner != expected_owner {
            return Err(LendingError::InvalidTokenAccountOwner.into());
        }
        Ok(())
    }

    /// Validate sufficient token balance
    pub fn validate_token_balance(
        token_account: &Account<TokenAccount>,
        required_amount: u64,
    ) -> Result<()> {
        if token_account.amount < required_amount {
            return Err(LendingError::InsufficientTokenBalance.into());
        }
        Ok(())
    }
}

/// PDA derivation utilities
pub struct PdaUtils;

impl PdaUtils {
    pub fn derive_protocol_state(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[PROTOCOL_STATE_SEED], program_id)
    }

    pub fn derive_treasury(program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[TREASURY_SEED], program_id)
    }

    pub fn derive_token_config(token_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[TOKEN_CONFIG_SEED, token_mint.as_ref()], program_id)
    }

    pub fn derive_loan(
        borrower: &Pubkey,
        token_mint: &Pubkey,
        loan_index: u64,
        program_id: &Pubkey,
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                LOAN_SEED,
                borrower.as_ref(),
                token_mint.as_ref(),
                &loan_index.to_le_bytes(),
            ],
            program_id,
        )
    }

    pub fn derive_vault_token_account(loan_pubkey: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[VAULT_SEED, loan_pubkey.as_ref()], program_id)
    }
}