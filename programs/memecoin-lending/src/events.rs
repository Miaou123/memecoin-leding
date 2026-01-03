use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub buyback_wallet: Pubkey,
    pub operations_wallet: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TokenWhitelisted {
    pub mint: Pubkey,
    pub tier: u8,
    pub pool_type: u8,
    pub ltv_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct LoanCreated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub token_mint: Pubkey,
    pub collateral_amount: u64,
    pub sol_borrowed: u64,
    pub entry_price: u64,
    pub liquidation_price: u64,
    pub due_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct LoanRepaid {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub sol_repaid: u64,
    pub protocol_fee: u64,
    pub collateral_returned: u64,
    pub timestamp: i64,
}

#[event]
pub struct LoanLiquidated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub liquidator: Pubkey,
    pub reason: u8, // 0 = time, 1 = price
    pub collateral_amount: u64,
    pub sol_proceeds: u64,
    pub current_price: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub new_balance: u64,
    pub timestamp: i64,
}

#[event]
pub struct TreasuryWithdrawn {
    pub admin: Pubkey,
    pub amount: u64,
    pub remaining_balance: u64,
    pub timestamp: i64,
}

#[event]
pub struct AdminTransferInitiated {
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
    pub can_accept_after: i64,
    pub timestamp: i64,
}

#[event]
pub struct AdminTransferCompleted {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolPaused {
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolResumed {
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct StakeDeposited {
    pub user: Pubkey,
    pub amount: u64,
    pub total_staked: u64,
    pub timestamp: i64,
}

#[event]
pub struct StakeWithdrawn {
    pub user: Pubkey,
    pub amount: u64,
    pub remaining_stake: u64,
    pub timestamp: i64,
}

#[event]
pub struct RewardsClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}