use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::error::LendingError;
use crate::state::*;

/// Reentrancy guard utilities
pub struct ReentrancyGuard;

impl ReentrancyGuard {
    pub fn enter(protocol_state: &mut ProtocolState) -> Result<()> {
        require!(!protocol_state.reentrancy_guard, LendingError::ReentrancyDetected);
        protocol_state.reentrancy_guard = true;
        Ok(())
    }
    
    pub fn exit(protocol_state: &mut ProtocolState) {
        protocol_state.reentrancy_guard = false;
    }
}

/// Constants (BPS_DIVISOR imported from state.rs)
pub const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;
pub const MAX_LOAN_DURATION: u64 = 7 * 24 * 60 * 60; // 7 days
pub const MIN_LOAN_DURATION: u64 = 12 * 60 * 60; // 12 hours
pub const PRICE_STALENESS_THRESHOLD: i64 = 60; // 60 seconds
pub const MAX_PRICE_DEVIATION_BPS: u64 = 500; // 5%

// === PRICE CONSTANTS ===
/// Price scaling factor (10^9 for lamport precision)
pub const PRICE_SCALE: u128 = 1_000_000_000;

/// Price scaling for calculations (10^6)
pub const PRICE_PRECISION: u64 = 1_000_000;

// === TIME CONSTANTS ===
/// Seconds per day
pub const SECONDS_PER_DAY: u64 = 86_400;

/// Seconds per hour
pub const SECONDS_PER_HOUR: u64 = 3_600;

// === LOAN CONSTANTS ===
/// Default liquidation buffer in basis points (3%)
pub const DEFAULT_LIQUIDATION_BUFFER_BPS: u16 = 300;

/// Maximum allowed slippage for liquidations in basis points (5%)
pub const MAX_LIQUIDATION_SLIPPAGE_BPS: u64 = 500;

/// Minimum collateral value in lamports (0.01 SOL = 10_000_000 lamports)
pub const MIN_COLLATERAL_VALUE_LAMPORTS: u64 = 10_000_000;

// === POOL DATA OFFSETS (Raydium AMM V4) ===
pub const RAYDIUM_TOKEN_A_AMOUNT_OFFSET: usize = 224;
pub const RAYDIUM_TOKEN_B_AMOUNT_OFFSET: usize = 232;
pub const RAYDIUM_TOKEN_A_MINT_OFFSET: usize = 400;
pub const RAYDIUM_TOKEN_B_MINT_OFFSET: usize = 432;
pub const RAYDIUM_MIN_DATA_LEN: usize = 464;

// === POOL DATA OFFSETS (PumpFun) ===
pub const PUMPFUN_VIRTUAL_TOKEN_OFFSET: usize = 8;
pub const PUMPFUN_VIRTUAL_SOL_OFFSET: usize = 16;
pub const PUMPFUN_MIN_DATA_LEN: usize = 24;

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

    /// Multiply then divide for u128 values with overflow protection
    pub fn mul_div_u128(a: u128, b: u128, c: u128) -> Result<u128> {
        if c == 0 {
            return Err(LendingError::DivisionByZero.into());
        }
        
        // Use checked arithmetic
        let result = a
            .checked_mul(b)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(c)
            .ok_or(LendingError::DivisionByZero)?;
        
        Ok(result)
    }

    /// Add two u128 values with overflow protection
    pub fn add_u128(a: u128, b: u128) -> Result<u128> {
        a.checked_add(b).ok_or(LendingError::MathOverflow.into())
    }

    /// Subtract two u128 values with underflow protection
    pub fn sub_u128(a: u128, b: u128) -> Result<u128> {
        a.checked_sub(b).ok_or(LendingError::MathUnderflow.into())
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
        const PRICE_SCALE: u128 = 1_000_000; // 10^6 - matches read_pumpfun_price scaling // 10^6
        
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

    /// Calculate total amount owed (principal + protocol fee only)
    pub fn calculate_total_owed(
        principal: u64,
        protocol_fee_bps: u16,
    ) -> Result<u64> {
        let protocol_fee = SafeMath::mul_div(principal, protocol_fee_bps as u64, BPS_DIVISOR)?;
        SafeMath::add(principal, protocol_fee)
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
    pub fn read_raydium_price(pool_data: &[u8], token_mint: &Pubkey, sol_mint: &Pubkey) -> Result<u64> {
        // Validate minimum data length
        require!(pool_data.len() >= RAYDIUM_MIN_DATA_LEN, LendingError::InvalidPriceFeed);
        
        // Validate data is not all zeros (account might be uninitialized)
        let is_initialized = pool_data.iter().any(|&b| b != 0);
        require!(is_initialized, LendingError::InvalidPriceFeed);
        
        let token_a_amount = u64::from_le_bytes(
            pool_data[RAYDIUM_TOKEN_A_AMOUNT_OFFSET..RAYDIUM_TOKEN_A_AMOUNT_OFFSET + 8]
                .try_into()
                .map_err(|_| LendingError::InvalidPriceFeed)?
        );
        let token_b_amount = u64::from_le_bytes(
            pool_data[RAYDIUM_TOKEN_B_AMOUNT_OFFSET..RAYDIUM_TOKEN_B_AMOUNT_OFFSET + 8]
                .try_into()
                .map_err(|_| LendingError::InvalidPriceFeed)?
        );
        
        // Validate reserves are non-zero
        require!(token_a_amount > 0 && token_b_amount > 0, LendingError::InvalidPriceFeed);
        
        let token_a_mint = Pubkey::try_from(
            &pool_data[RAYDIUM_TOKEN_A_MINT_OFFSET..RAYDIUM_TOKEN_A_MINT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPriceFeed)?;
        
        let token_b_mint = Pubkey::try_from(
            &pool_data[RAYDIUM_TOKEN_B_MINT_OFFSET..RAYDIUM_TOKEN_B_MINT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPriceFeed)?;
        
        // Validate one of the mints is SOL
        let (sol_amount, token_amount) = if token_a_mint == *sol_mint {
            (token_a_amount, token_b_amount)
        } else if token_b_mint == *sol_mint {
            (token_b_amount, token_a_amount)
        } else {
            return Err(LendingError::InvalidPriceFeed.into());
        };
        
        // Validate the other mint matches expected token
        let other_mint = if token_a_mint == *sol_mint { token_b_mint } else { token_a_mint };
        require!(other_mint == *token_mint, LendingError::PoolTypeMismatch);
        
        // Calculate price with overflow protection
        let price = (sol_amount as u128)
            .checked_mul(PRICE_SCALE)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(token_amount as u128)
            .ok_or(LendingError::DivisionByZero)?;
        
        require!(price <= u64::MAX as u128, LendingError::MathOverflow);
        
        Ok(price as u64)
    }

    /// Read price from Pumpfun bonding curve
    pub fn read_pumpfun_price(pool_data: &[u8]) -> Result<u64> {
        require!(pool_data.len() >= PUMPFUN_MIN_DATA_LEN, LendingError::InvalidPriceFeed);
        
        // Validate data is not all zeros
        let is_initialized = pool_data[..PUMPFUN_MIN_DATA_LEN].iter().any(|&b| b != 0);
        require!(is_initialized, LendingError::InvalidPriceFeed);
        
        let virtual_sol = u64::from_le_bytes(
            pool_data[PUMPFUN_VIRTUAL_SOL_OFFSET..PUMPFUN_VIRTUAL_SOL_OFFSET + 8]
                .try_into()
                .map_err(|_| LendingError::InvalidPriceFeed)?
        );
        let virtual_token = u64::from_le_bytes(
            pool_data[PUMPFUN_VIRTUAL_TOKEN_OFFSET..PUMPFUN_VIRTUAL_TOKEN_OFFSET + 8]
                .try_into()
                .map_err(|_| LendingError::InvalidPriceFeed)?
        );
        
        // Validate reserves are non-zero
        require!(virtual_sol > 0 && virtual_token > 0, LendingError::InvalidPriceFeed);
        
        let price = (virtual_sol as u128)
            .checked_mul(PRICE_SCALE)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(virtual_token as u128)
            .ok_or(LendingError::DivisionByZero)?;
        
        require!(price <= u64::MAX as u128, LendingError::MathOverflow);
        require!(price > 0, LendingError::ZeroPrice);
        
        Ok(price as u64)
    }

    /// Read price from pool - ALWAYS validates freshness
    /// This is the ONLY function that should be used for price reading
    pub fn read_price_from_pool(
        pool_account: &AccountInfo,
        pool_type: PoolType,
        token_mint: &Pubkey,
    ) -> Result<u64> {
        let pool_data = pool_account.try_borrow_data()?;
        let sol_mint = pubkey!("So11111111111111111111111111111111111111112");
        
        let price = match pool_type {
            PoolType::Raydium | PoolType::Orca => Self::read_raydium_price(&pool_data, token_mint, &sol_mint)?,
            PoolType::Pumpfun | PoolType::PumpSwap => Self::read_pumpfun_price(&pool_data)?,
        };
        
        // Validate price is non-zero
        require!(price > 0, LendingError::ZeroPrice);
        
        Ok(price)
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

    pub fn derive_user_exposure(user: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[USER_EXPOSURE_SEED, user.as_ref()], program_id)
    }
}

/// Exposure calculation utilities
pub struct ExposureCalculator;

impl ExposureCalculator {
    /// Calculate maximum exposure for a given limit in basis points
    pub fn calculate_max_exposure(treasury_balance: u64, limit_bps: u64) -> Result<u64> {
        SafeMath::mul_div(treasury_balance, limit_bps, BPS_DIVISOR)
    }
    
    /// Check if adding amount would exceed limit
    pub fn would_exceed_limit(
        current_exposure: u64,
        new_amount: u64,
        max_exposure: u64,
    ) -> Result<bool> {
        let new_total = SafeMath::add(current_exposure, new_amount)?;
        Ok(new_total > max_exposure)
    }
    
    /// Calculate remaining exposure capacity
    pub fn remaining_capacity(current_exposure: u64, max_exposure: u64) -> Result<u64> {
        if current_exposure >= max_exposure {
            return Ok(0);
        }
        SafeMath::sub(max_exposure, current_exposure)
    }
}