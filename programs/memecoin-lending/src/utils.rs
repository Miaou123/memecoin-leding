use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::error::LendingError;
use crate::state::*;

/// Constants
pub const BPS_DIVISOR: u64 = 10_000;
pub const SECONDS_PER_YEAR: u64 = 365 * 24 * 60 * 60;
pub const MAX_LOAN_DURATION: u64 = 90 * 24 * 60 * 60; // 90 days
pub const MIN_LOAN_DURATION: u64 = 1 * 24 * 60 * 60; // 1 day
pub const PRICE_STALENESS_THRESHOLD: i64 = 60; // 60 seconds
pub const MAX_PRICE_DEVIATION_BPS: u64 = 500; // 5%

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
        a.checked_mul(b).ok_or(LendingError::MathOverflow.into())
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
        let collateral_value = SafeMath::mul(collateral_amount, token_price)?;
        SafeMath::mul_div(collateral_value, ltv_bps as u64, BPS_DIVISOR)
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
}

/// Price feed utilities
pub struct PriceFeedUtils;

impl PriceFeedUtils {
    /// Get token price from pool (mock implementation)
    /// In production, this would integrate with Raydium/Orca pools or Pyth
    pub fn get_token_price(_pool_address: &Pubkey) -> Result<u64> {
        // Mock price: 1 token = 0.001 SOL (1 SOL = 1000 tokens)
        // In real implementation, fetch from DEX pools or price feeds
        Ok(1_000_000) // 0.001 SOL in lamports
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

    pub fn derive_vault_token_account(token_mint: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[VAULT_SEED, token_mint.as_ref()], program_id)
    }
}