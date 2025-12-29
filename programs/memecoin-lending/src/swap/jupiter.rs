use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};

/// Jupiter V6 Program ID
pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/// Jupiter shared accounts PDA
pub const JUPITER_AUTHORITY: Pubkey = pubkey!("BUDnhZ6KyfKRCiLubWPHJjvJYjKx5qDukqpkM7jVP8i3");

/// Execute Jupiter swap via CPI
/// 
/// The swap instruction and accounts are prepared off-chain via Jupiter API.
/// We pass them in via remaining_accounts.
pub fn execute_jupiter_swap<'info>(
    jupiter_program: &AccountInfo<'info>,
    route_accounts: &[AccountInfo<'info>],
    swap_data: Vec<u8>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    // Build accounts meta from route accounts
    let accounts_meta: Vec<AccountMeta> = route_accounts
        .iter()
        .map(|acc| {
            if acc.is_writable {
                AccountMeta::new(acc.key(), acc.is_signer)
            } else {
                AccountMeta::new_readonly(acc.key(), acc.is_signer)
            }
        })
        .collect();

    let ix = Instruction {
        program_id: jupiter_program.key(),
        accounts: accounts_meta,
        data: swap_data,
    };

    let mut account_infos = vec![jupiter_program.clone()];
    account_infos.extend(route_accounts.iter().cloned());

    invoke_signed(&ix, &account_infos, signer_seeds)?;

    Ok(())
}

/// Default slippage for liquidations (1.5%)
pub const LIQUIDATION_SLIPPAGE_BPS: u64 = 150;

/// Calculate minimum output with slippage protection
pub fn calculate_min_output(expected_output: u64, slippage_bps: u64) -> u64 {
    expected_output
        .saturating_mul(10000 - slippage_bps)
        .saturating_div(10000)
}