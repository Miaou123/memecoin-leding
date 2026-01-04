use crate::state::StakingPool;

/// Check if epoch has ended based on time
pub fn is_epoch_ended(pool: &StakingPool, current_time: i64) -> bool {
    current_time >= pool.epoch_start_time + pool.epoch_duration
}

/// Check if a user is eligible for a specific epoch
/// User is eligible if they staked BEFORE that epoch started
pub fn is_eligible_for_epoch(stake_start_epoch: u64, target_epoch: u64) -> bool {
    stake_start_epoch < target_epoch
}