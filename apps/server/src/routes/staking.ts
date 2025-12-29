import { Hono } from 'hono';
import { stakingService } from '../services/staking.service';

const stakingRoutes = new Hono();

// Get staking pool info and statistics
stakingRoutes.get('/pool', async (c) => {
  try {
    const stats = await stakingService.getStakingStats();
    return c.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching staking pool:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch staking pool info'
    }, 500);
  }
});

// Get staking statistics
stakingRoutes.get('/stats', async (c) => {
  try {
    const stats = await stakingService.getStakingStats();
    return c.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching staking stats:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch staking statistics'
    }, 500);
  }
});

// Get user stake information
stakingRoutes.get('/user/:address', async (c) => {
  try {
    const address = c.req.param('address');
    
    if (!address) {
      return c.json({
        success: false,
        error: 'Address parameter is required'
      }, 400);
    }

    const userStake = await stakingService.getUserStake(address);
    const pendingRewards = await stakingService.getPendingRewards(address);

    return c.json({
      success: true,
      data: {
        stake: userStake,
        pendingRewards: pendingRewards.pending,
        pendingRewardsSol: pendingRewards.pendingSol
      }
    });
  } catch (error) {
    console.error('Error fetching user stake:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch user stake information'
    }, 500);
  }
});

// Get pending rewards for a user
stakingRoutes.get('/rewards/:address', async (c) => {
  try {
    const address = c.req.param('address');
    
    if (!address) {
      return c.json({
        success: false,
        error: 'Address parameter is required'
      }, 400);
    }

    const pendingRewards = await stakingService.getPendingRewards(address);

    return c.json({
      success: true,
      data: pendingRewards
    });
  } catch (error) {
    console.error('Error fetching pending rewards:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch pending rewards'
    }, 500);
  }
});

// Stake tokens - returns transaction to be signed by client
stakingRoutes.post('/stake', async (c) => {
  try {
    const { userAddress, amount, tokenMint } = await c.req.json();
    
    if (!userAddress || !amount || !tokenMint) {
      return c.json({
        success: false,
        error: 'userAddress, amount, and tokenMint are required'
      }, 400);
    }

    // In a real implementation, this would build and return a transaction
    return c.json({
      success: true,
      message: 'Stake transaction prepared',
      data: {
        instruction: 'stake',
        amount,
        tokenMint,
        userAddress
      }
    });
  } catch (error) {
    console.error('Error preparing stake transaction:', error);
    return c.json({
      success: false,
      error: 'Failed to prepare stake transaction'
    }, 500);
  }
});

// Unstake tokens - returns transaction to be signed by client
stakingRoutes.post('/unstake', async (c) => {
  try {
    const { userAddress, amount, tokenMint } = await c.req.json();
    
    if (!userAddress || !amount || !tokenMint) {
      return c.json({
        success: false,
        error: 'userAddress, amount, and tokenMint are required'
      }, 400);
    }

    // In a real implementation, this would build and return a transaction
    return c.json({
      success: true,
      message: 'Unstake transaction prepared',
      data: {
        instruction: 'unstake',
        amount,
        tokenMint,
        userAddress
      }
    });
  } catch (error) {
    console.error('Error preparing unstake transaction:', error);
    return c.json({
      success: false,
      error: 'Failed to prepare unstake transaction'
    }, 500);
  }
});

// Claim rewards - returns transaction to be signed by client
stakingRoutes.post('/claim', async (c) => {
  try {
    const { userAddress } = await c.req.json();
    
    if (!userAddress) {
      return c.json({
        success: false,
        error: 'userAddress is required'
      }, 400);
    }

    // In a real implementation, this would build and return a transaction
    return c.json({
      success: true,
      message: 'Claim rewards transaction prepared',
      data: {
        instruction: 'claimRewards',
        userAddress
      }
    });
  } catch (error) {
    console.error('Error preparing claim transaction:', error);
    return c.json({
      success: false,
      error: 'Failed to prepare claim transaction'
    }, 500);
  }
});

export { stakingRoutes };