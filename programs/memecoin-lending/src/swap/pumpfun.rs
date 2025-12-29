use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::Instruction, program::invoke_signed};
use anchor_spl::token::TokenAccount;

/// PumpFun Program ID (Mainnet)
pub const PUMPFUN_PROGRAM_ID: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");

/// PumpFun sell instruction discriminator
/// This is the 8-byte Anchor discriminator for the "sell" instruction
const SELL_DISCRIMINATOR: [u8; 8] = [0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad];

/// PumpFun Global State (contains fee recipient, etc.)
pub const PUMPFUN_GLOBAL: Pubkey = pubkey!("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf");

/// PumpFun Fee Recipient
pub const PUMPFUN_FEE_RECIPIENT: Pubkey = pubkey!("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

/// PumpFun Event Authority
pub const PUMPFUN_EVENT_AUTHORITY: Pubkey = pubkey!("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PumpfunSellArgs {
    pub amount: u64,
    pub min_sol_output: u64,
}

/// Execute a sell on PumpFun bonding curve
/// 
/// Accounts required:
/// 0. global - PumpFun global state
/// 1. fee_recipient - PumpFun fee account
/// 2. mint - Token mint
/// 3. bonding_curve - Bonding curve PDA for this token
/// 4. bonding_curve_token_account - Token account owned by bonding curve
/// 5. associated_user - User's token account (source)
/// 6. user - User/authority (signer)
/// 7. system_program
/// 8. associated_token_program
/// 9. token_program
/// 10. event_authority
/// 11. program (PumpFun)
pub fn execute_pumpfun_sell<'info>(
    pumpfun_program: &AccountInfo<'info>,
    global: &AccountInfo<'info>,
    fee_recipient: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    bonding_curve: &AccountInfo<'info>,
    bonding_curve_token_account: &AccountInfo<'info>,
    user_token_account: &AccountInfo<'info>,
    user_authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    event_authority: &AccountInfo<'info>,
    amount: u64,
    min_sol_output: u64,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let accounts = vec![
        AccountMeta::new_readonly(global.key(), false),
        AccountMeta::new(fee_recipient.key(), false),
        AccountMeta::new_readonly(mint.key(), false),
        AccountMeta::new(bonding_curve.key(), false),
        AccountMeta::new(bonding_curve_token_account.key(), false),
        AccountMeta::new(user_token_account.key(), false),
        AccountMeta::new(user_authority.key(), true), // signer
        AccountMeta::new_readonly(system_program.key(), false),
        AccountMeta::new_readonly(associated_token_program.key(), false),
        AccountMeta::new_readonly(token_program.key(), false),
        AccountMeta::new_readonly(event_authority.key(), false),
        AccountMeta::new_readonly(pumpfun_program.key(), false),
    ];

    // Build instruction data
    let mut data = SELL_DISCRIMINATOR.to_vec();
    let args = PumpfunSellArgs {
        amount,
        min_sol_output,
    };
    args.serialize(&mut data)?;

    let ix = Instruction {
        program_id: pumpfun_program.key(),
        accounts,
        data,
    };

    let account_infos = vec![
        global.clone(),
        fee_recipient.clone(),
        mint.clone(),
        bonding_curve.clone(),
        bonding_curve_token_account.clone(),
        user_token_account.clone(),
        user_authority.clone(),
        system_program.clone(),
        associated_token_program.clone(),
        token_program.clone(),
        event_authority.clone(),
        pumpfun_program.clone(),
    ];

    invoke_signed(&ix, &account_infos, signer_seeds)?;

    Ok(())
}

/// Derive PumpFun bonding curve PDA
pub fn get_bonding_curve_pda(mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"bonding-curve", mint.as_ref()],
        &PUMPFUN_PROGRAM_ID,
    )
}

/// Calculate expected SOL output from PumpFun sell
/// Uses the bonding curve formula: price = virtual_sol / virtual_tokens
pub fn calculate_pumpfun_sell_output(
    bonding_curve_data: &[u8],
    sell_amount: u64,
) -> Result<u64> {
    // PumpFun bonding curve data layout:
    // - virtual_token_reserves: u64 (offset 8)
    // - virtual_sol_reserves: u64 (offset 16)
    // - real_token_reserves: u64 (offset 24)
    // - real_sol_reserves: u64 (offset 32)
    // - token_total_supply: u64 (offset 40)
    // - complete: bool (offset 48)
    
    if bonding_curve_data.len() < 49 {
        return Err(error!(crate::error::LendingError::InvalidPoolData));
    }
    
    let virtual_token_reserves = u64::from_le_bytes(
        bonding_curve_data[8..16].try_into().unwrap()
    );
    let virtual_sol_reserves = u64::from_le_bytes(
        bonding_curve_data[16..24].try_into().unwrap()
    );
    
    // Constant product formula: k = virtual_sol * virtual_tokens
    // After sell: (virtual_sol - output) * (virtual_tokens + sell_amount) = k
    // output = virtual_sol - k / (virtual_tokens + sell_amount)
    
    let k = (virtual_sol_reserves as u128)
        .checked_mul(virtual_token_reserves as u128)
        .ok_or(error!(crate::error::LendingError::MathOverflow))?;
    
    let new_virtual_tokens = (virtual_token_reserves as u128)
        .checked_add(sell_amount as u128)
        .ok_or(error!(crate::error::LendingError::MathOverflow))?;
    
    let new_virtual_sol = k
        .checked_div(new_virtual_tokens)
        .ok_or(error!(crate::error::LendingError::DivisionByZero))?;
    
    let sol_output = (virtual_sol_reserves as u128)
        .checked_sub(new_virtual_sol)
        .ok_or(error!(crate::error::LendingError::MathUnderflow))?;
    
    // PumpFun takes 1% fee
    let fee = sol_output / 100;
    let final_output = sol_output - fee;
    
    Ok(final_output as u64)
}