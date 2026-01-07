import { getStakingTokenMint } from './deployment';

// Get protocol token from deployment configuration
export const getProtocolTokenMint = (): string => {
  const stakingToken = getStakingTokenMint();
  
  // If staking not configured yet, return empty string
  // This will show blank space in UI until staking is initialized
  return stakingToken || '';
};