import { Hono } from 'hono';
import { stakingService } from '../services/staking.service.js';
import { distributionCrankService } from '../services/distribution-crank.service.js';
import { getDistributionCrankStatus } from '../jobs/distribution-crank.job.js';

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

// Get fee configuration and breakdown
stakingRoutes.get('/fees/breakdown', async (c) => {
  try {
    const breakdown = stakingService.getFeeBreakdown();
    return c.json({ success: true, data: breakdown });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Distribution crank endpoints

// Get distribution crank status
stakingRoutes.get('/crank/status', async (c) => {
  try {
    const [serviceStatus, jobStatus] = await Promise.all([
      distributionCrankService.getStatus(),
      getDistributionCrankStatus(),
    ]);

    return c.json({
      success: true,
      data: {
        service: serviceStatus,
        jobs: jobStatus,
      }
    });
  } catch (error: any) {
    console.error('Error fetching crank status:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch distribution crank status'
    }, 500);
  }
});

// Manual trigger distribution tick (admin/debugging)
stakingRoutes.post('/crank/tick', async (c) => {
  try {
    // Initialize if needed
    await distributionCrankService.initialize();
    
    // Run a manual tick
    const result = await distributionCrankService.tick();
    
    return c.json({
      success: true,
      data: {
        ...result,
        totalDistributed: result.totalDistributed.toString(), // Convert BigInt to string
      }
    });
  } catch (error: any) {
    console.error('Error running manual tick:', error);
    return c.json({
      success: false,
      error: error.message || 'Failed to execute distribution tick'
    }, 500);
  }
});

export { stakingRoutes };