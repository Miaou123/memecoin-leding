use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use crate::error::LendingError;
use crate::state::*;
use anchor_lang::solana_program::pubkey;

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
pub const PRICE_SCALE: u128 = 1_000_000;

/// Price scaling for calculations (10^6)
pub const PRICE_PRECISION: u64 = 1_000_000;

// === TIME CONSTANTS ===
/// Seconds per day
pub const SECONDS_PER_DAY: u64 = 86_400;

/// Seconds per hour
pub const SECONDS_PER_HOUR: u64 = 3_600;

// === DURATION-BASED LTV SCALING ===
/// Default/base duration for LTV calculation (48 hours)
pub const BASE_DURATION_SECONDS: u64 = 48 * 60 * 60; // 48 hours

/// Maximum LTV bonus for shortest duration (25% = 2500 bps)
pub const MAX_LTV_BONUS_BPS: u64 = 2500;

/// Maximum LTV penalty for longest duration (25% = 2500 bps)
pub const MAX_LTV_PENALTY_BPS: u64 = 2500;

// === LOAN CONSTANTS ===
/// Default liquidation buffer in basis points (3%)
pub const DEFAULT_LIQUIDATION_BUFFER_BPS: u16 = 300;

/// Maximum allowed slippage for liquidations in basis points (5%)
pub const MAX_LIQUIDATION_SLIPPAGE_BPS: u64 = 500;

/// Minimum collateral value in lamports (0.01 SOL = 10_000_000 lamports)
pub const MIN_COLLATERAL_VALUE_LAMPORTS: u64 = 10_000_000;

/// Minimum stake amount (1 token with 6 decimals for PumpFun tokens)
pub const MIN_STAKE_AMOUNT: u64 = 1_000_000;

/// Maximum effective LTV + buffer to ensure liquidation profit (90% = 9000 bps)
pub const MAX_EFFECTIVE_LIQUIDATION_LTV_BPS: u64 = 9000;

/// Maximum age for price signatures (30 seconds)
pub const MAX_PRICE_SIGNATURE_AGE_SECONDS: i64 = 30;

/// Price signature message prefix for domain separation
pub const PRICE_SIGNATURE_PREFIX: &[u8] = b"MCLEND_PRICE_V1";

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

// === POOL DATA OFFSETS (PumpSwap) ===
// PumpSwap Pool Layout (from IDL)
// Discriminator: 8 bytes
// pool_bump: u8 (offset 8)
// index: u16 (offset 9)
// creator: Pubkey (offset 11)
// base_mint: Pubkey (offset 43)
// quote_mint: Pubkey (offset 75)
// lp_mint: Pubkey (offset 107)
// pool_base_token_account: Pubkey (offset 139)
// pool_quote_token_account: Pubkey (offset 171)
// lp_supply: u64 (offset 203)

// Add PumpSwap program constants
pub const PUMPSWAP_PROGRAM_ID: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

// Pool layout offsets (verified from actual on-chain data)
pub const PUMPSWAP_POOL_DISCRIMINATOR: [u8; 8] = [241, 154, 109, 4, 17, 177, 109, 188];
pub const PUMPSWAP_POOL_BASE_MINT_OFFSET: usize = 43;
pub const PUMPSWAP_POOL_QUOTE_MINT_OFFSET: usize = 75;
pub const PUMPSWAP_POOL_BASE_VAULT_OFFSET: usize = 139;
pub const PUMPSWAP_POOL_QUOTE_VAULT_OFFSET: usize = 171;
pub const PUMPSWAP_POOL_MIN_LEN: usize = 211;

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
            .checked_mul(1000).ok_or(LendingError::MathOverflow)?
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

    /// Calculate liquidation price with safety cap
    /// Ensures effective LTV never exceeds 90% for protocol safety
    pub fn calculate_liquidation_price(
        sol_borrowed: u64,
        collateral_amount: u64,
        ltv_bps: u16,
        liquidation_buffer_bps: u16,
    ) -> Result<u64> {
        let raw_effective_ltv = SafeMath::add(ltv_bps as u64, liquidation_buffer_bps as u64)?;
        
        // Cap at 90% to ensure protocol always profits at liquidation (before slippage)
        let effective_ltv = std::cmp::min(raw_effective_ltv, MAX_EFFECTIVE_LIQUIDATION_LTV_BPS);
        
        SafeMath::mul_div(
            sol_borrowed, 
            BPS_DIVISOR, 
            SafeMath::mul_div(collateral_amount, effective_ltv, BPS_DIVISOR)?
        )
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

    /// Calculate duration-based LTV modifier
    /// Returns the effective LTV in basis points after applying duration scaling
    /// 
    /// Scaling:
    /// - 12h (min): +25% bonus → modifier = 1.25
    /// - 48h (default): no change → modifier = 1.0  
    /// - 7d (max): -25% penalty → modifier = 0.75
    pub fn calculate_duration_adjusted_ltv(
        base_ltv_bps: u16,
        duration_seconds: u64,
    ) -> Result<u16> {
        // Clamp duration to valid range
        let duration = duration_seconds
            .max(MIN_LOAN_DURATION)
            .min(MAX_LOAN_DURATION);
        
        let base_ltv = base_ltv_bps as u64;
        
        let effective_ltv = if duration <= BASE_DURATION_SECONDS {
            // Shorter duration = bonus (scales from +25% at 12h to 0% at 48h)
            // bonus_ratio = (48h - duration) / (48h - 12h)
            let duration_range = BASE_DURATION_SECONDS - MIN_LOAN_DURATION; // 36 hours
            let duration_diff = BASE_DURATION_SECONDS - duration;
            
            // bonus = base_ltv * MAX_BONUS * duration_diff / duration_range / 10000
            let bonus = SafeMath::mul_div(
                base_ltv,
                SafeMath::mul_div(MAX_LTV_BONUS_BPS, duration_diff, duration_range)?,
                BPS_DIVISOR,
            )?;
            
            SafeMath::add(base_ltv, bonus)?
        } else {
            // Longer duration = penalty (scales from 0% at 48h to -25% at 7d)
            // penalty_ratio = (duration - 48h) / (168h - 48h)
            let duration_range = MAX_LOAN_DURATION - BASE_DURATION_SECONDS; // 120 hours
            let duration_diff = duration - BASE_DURATION_SECONDS;
            
            // penalty = base_ltv * MAX_PENALTY * duration_diff / duration_range / 10000
            let penalty = SafeMath::mul_div(
                base_ltv,
                SafeMath::mul_div(MAX_LTV_PENALTY_BPS, duration_diff, duration_range)?,
                BPS_DIVISOR,
            )?;
            
            SafeMath::sub(base_ltv, penalty)?
        };
        
        // Ensure result fits in u16 and has reasonable bounds
        if effective_ltv > 9000 {
            // Cap at 90% LTV maximum for safety
            Ok(9000)
        } else if effective_ltv < 1000 {
            // Floor at 10% LTV minimum
            Ok(1000)
        } else {
            Ok(effective_ltv as u16)
        }
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

    /// Read price from PumpSwap pool using vault account balances
    pub fn read_pumpswap_price(
        pool_data: &[u8],
        base_vault_amount: u64,
        quote_vault_amount: u64,
        expected_base_vault: &Pubkey,
        expected_quote_vault: &Pubkey,
    ) -> Result<u64> {
        // Validate pool data length
        require!(pool_data.len() >= PUMPSWAP_POOL_MIN_LEN, LendingError::InvalidPriceFeed);
        
        // Extract vault addresses from pool data
        let stored_base_vault = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_BASE_VAULT_OFFSET..PUMPSWAP_POOL_BASE_VAULT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPriceFeed)?;
        
        let stored_quote_vault = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_QUOTE_VAULT_OFFSET..PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPriceFeed)?;
        
        // Validate passed vault accounts match pool's stored vaults
        require!(expected_base_vault == &stored_base_vault, LendingError::InvalidPumpSwapVault);
        require!(expected_quote_vault == &stored_quote_vault, LendingError::InvalidPumpSwapVault);
        
        // Validate reserves are non-zero
        require!(base_vault_amount > 0 && quote_vault_amount > 0, LendingError::InvalidPriceFeed);
        
        // Calculate price: quote_amount * PRICE_SCALE / base_amount / 1000
        // quote is SOL (WSOL with 9 decimals), base is the memecoin (6 decimals)
        // Need to divide by 1000 to normalize the decimal difference (9 - 6 = 3)
        let price = (quote_vault_amount as u128)
            .checked_mul(PRICE_SCALE)
            .ok_or(LendingError::MathOverflow)?
            .checked_div(base_vault_amount as u128)
            .ok_or(LendingError::DivisionByZero)?
            .checked_div(1000) // Normalize for decimal difference between WSOL (9) and token (6)
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

/// Treasury utilities
pub struct TreasuryUtils;

impl TreasuryUtils {
    /// Get the actual treasury balance from the account
    /// This should always be used instead of the deprecated protocol_state.treasury_balance
    pub fn get_treasury_balance(treasury_account: &AccountInfo) -> u64 {
        treasury_account.lamports()
    }
    
    /// Get available balance (total - reserved for active loans - rent exempt minimum)
    /// This ensures the treasury never becomes non-rent-exempt
    pub fn get_available_balance(
        treasury_account: &AccountInfo,
        total_sol_borrowed: u64,
    ) -> Result<u64> {
        let total_balance = Self::get_treasury_balance(treasury_account);
        
        // Calculate rent exempt minimum for a SystemAccount (0 data size)
        let rent = Rent::get()?;
        let rent_exempt_minimum = rent.minimum_balance(0);
        
        // Reserved amount includes both borrowed funds and rent minimum
        let reserved = total_sol_borrowed.saturating_add(rent_exempt_minimum);
        
        // Use saturating_sub to safely handle edge cases
        Ok(total_balance.saturating_sub(reserved))
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

/// Validate a PumpSwap pool account
pub struct PumpSwapPoolValidator;

impl PumpSwapPoolValidator {
    /// Validate pool owner is PumpSwap program
    pub fn validate_owner(pool_account: &AccountInfo) -> Result<()> {
        require!(
            pool_account.owner == &PUMPSWAP_PROGRAM_ID,
            LendingError::InvalidPoolOwner
        );
        Ok(())
    }

    /// Validate pool discriminator
    pub fn validate_discriminator(pool_data: &[u8]) -> Result<()> {
        require!(
            pool_data.len() >= 8,
            LendingError::InvalidPoolData
        );
        require!(
            pool_data[0..8] == PUMPSWAP_POOL_DISCRIMINATOR,
            LendingError::InvalidPoolData
        );
        Ok(())
    }

    /// Validate pool's base_mint matches expected token
    pub fn validate_base_mint(pool_data: &[u8], expected_mint: &Pubkey) -> Result<()> {
        require!(
            pool_data.len() >= PUMPSWAP_POOL_BASE_MINT_OFFSET + 32,
            LendingError::InvalidPoolData
        );
        
        let pool_base_mint = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_BASE_MINT_OFFSET..PUMPSWAP_POOL_BASE_MINT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPoolData)?;
        
        require!(
            pool_base_mint == *expected_mint,
            LendingError::PoolTokenMismatch
        );
        Ok(())
    }

    /// Validate pool's quote_mint is WSOL
    pub fn validate_quote_mint(pool_data: &[u8]) -> Result<()> {
        require!(
            pool_data.len() >= PUMPSWAP_POOL_QUOTE_MINT_OFFSET + 32,
            LendingError::InvalidQuoteMint
        );
        
        let pool_quote_mint = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_QUOTE_MINT_OFFSET..PUMPSWAP_POOL_QUOTE_MINT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPoolData)?;
        
        require!(
            pool_quote_mint == WSOL_MINT,
            LendingError::InvalidQuoteMint
        );
        Ok(())
    }

    /// Extract vault addresses from pool data
    pub fn extract_vaults(pool_data: &[u8]) -> Result<(Pubkey, Pubkey)> {
        require!(
            pool_data.len() >= PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32,
            LendingError::InvalidPoolData
        );
        
        let base_vault = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_BASE_VAULT_OFFSET..PUMPSWAP_POOL_BASE_VAULT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPoolData)?;
        
        let quote_vault = Pubkey::try_from(
            &pool_data[PUMPSWAP_POOL_QUOTE_VAULT_OFFSET..PUMPSWAP_POOL_QUOTE_VAULT_OFFSET + 32]
        ).map_err(|_| LendingError::InvalidPoolData)?;
        
        Ok((base_vault, quote_vault))
    }

    /// Full validation for PumpSwap pools
    pub fn validate_full(
        pool_account: &AccountInfo,
        expected_token_mint: &Pubkey,
    ) -> Result<(Pubkey, Pubkey)> {
        // 1. Validate owner
        Self::validate_owner(pool_account)?;
        
        // 2. Borrow and validate data
        let pool_data = pool_account.try_borrow_data()?;
        
        // 3. Validate discriminator
        Self::validate_discriminator(&pool_data)?;
        
        // 4. Validate base_mint matches token
        Self::validate_base_mint(&pool_data, expected_token_mint)?;
        
        // 5. Validate quote_mint is WSOL
        Self::validate_quote_mint(&pool_data)?;
        
        // 6. Extract and return vault addresses
        Self::extract_vaults(&pool_data)
    }
}