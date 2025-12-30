import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { 
  CreateLoanRequest, 
  ApiResponse, 
  PaginatedResponse,
  Loan,
  LoanEstimate 
} from '@memecoin-lending/types';
import { authMiddleware, requireAuth } from '../middleware/auth.js';
import { apiRateLimit, createLoanRateLimit } from '../middleware/rateLimit.js';
import { loanService } from '../services/loan.service.js';
import { prisma } from '../db/client.js';

const loansRouter = new Hono();

// Apply middleware
loansRouter.use('/*', authMiddleware);
loansRouter.use('/*', apiRateLimit);

// Get all loans (paginated)
const getLoansSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['active', 'repaid', 'liquidatedTime', 'liquidatedPrice']).optional(),
  tokenMint: z.string().optional(),
  borrower: z.string().optional(),
  sortBy: z.enum(['createdAt', 'dueAt', 'solBorrowed']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

loansRouter.get('/', zValidator('query', getLoansSchema), async (c) => {
  const query = c.req.valid('query');
  
  const where: any = {};
  if (query.status) where.status = query.status;
  if (query.tokenMint) where.tokenMint = query.tokenMint;
  if (query.borrower) where.borrower = query.borrower;
  
  const [loans, total] = await Promise.all([
    prisma.loan.findMany({
      where,
      include: {
        token: true,
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: {
        [query.sortBy]: query.sortOrder,
      },
    }),
    prisma.loan.count({ where }),
  ]);
  
  const response: ApiResponse<PaginatedResponse<Loan>> = {
    success: true,
    data: {
      items: loans.map(loanService.formatLoan),
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: query.page * query.pageSize < total,
    },
  };
  
  return c.json(response);
});

// Get recent loans for dashboard (must come before /:pubkey to avoid conflict)
const getRecentLoansSchema = z.object({
  limit: z.coerce.number().min(1).max(20).default(5),
});

loansRouter.get('/recent', zValidator('query', getRecentLoansSchema), async (c) => {
  const query = c.req.valid('query');
  
  try {
    const loans = await prisma.loan.findMany({
      include: {
        token: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: query.limit,
    });

    const formattedLoans = loans.map(loan => ({
      id: loan.pubkey,
      tokenSymbol: loan.token?.symbol || 'UNKNOWN',
      tokenName: loan.token?.name || 'Unknown Token',
      solBorrowed: loan.solBorrowed,
      status: loan.status,
      createdAt: Math.floor(loan.createdAt.getTime() / 1000),
      healthScore: 75, // TODO: Calculate actual health score
    }));

    return c.json<ApiResponse<typeof formattedLoans>>({
      success: true,
      data: formattedLoans,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 500);
  }
});

// Get single loan
loansRouter.get('/:pubkey', async (c) => {
  const pubkey = c.req.param('pubkey');
  
  const loan = await prisma.loan.findUnique({
    where: { id: pubkey },
    include: { token: true },
  });
  
  if (!loan) {
    return c.json<ApiResponse<null>>({ 
      success: false, 
      error: 'Loan not found' 
    }, 404);
  }
  
  return c.json<ApiResponse<Loan>>({
    success: true,
    data: loanService.formatLoan(loan),
  });
});

// Get user's loans
loansRouter.get('/user/:wallet', async (c) => {
  const wallet = c.req.param('wallet');
  const query = c.req.query();
  
  const loans = await prisma.loan.findMany({
    where: { 
      borrower: wallet,
      status: query.status,
    },
    include: { token: true },
    orderBy: { createdAt: 'desc' },
  });
  
  return c.json<ApiResponse<Loan[]>>({
    success: true,
    data: loans.map(loanService.formatLoan),
  });
});

// Estimate loan terms
const estimateSchema = z.object({
  tokenMint: z.string(),
  collateralAmount: z.string(),
  durationSeconds: z.coerce.number().min(43200).max(604800), // 12h - 7d
});

loansRouter.post('/estimate', zValidator('json', estimateSchema), async (c) => {
  const body = c.req.valid('json');
  
  try {
    const estimate = await loanService.estimateLoan(body);
    
    return c.json<ApiResponse<LoanEstimate>>({
      success: true,
      data: estimate,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Create loan (requires auth)
loansRouter.post(
  '/', 
  requireAuth,
  createLoanRateLimit,
  zValidator('json', estimateSchema),
  async (c) => {
    const body = c.req.valid('json');
    const user = c.user!;
    
    try {
      const result = await loanService.createLoan({
        ...body,
        borrower: user.wallet,
      });
      
      return c.json<ApiResponse<{ transaction: string }>>({
        success: true,
        data: {
          transaction: result.transaction,  // Base64 encoded unsigned TX
        },
      }, 201);
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Create loan (unsigned) - no pre-auth required since transaction signature proves ownership
const createLoanUnsignedSchema = z.object({
  tokenMint: z.string(),
  collateralAmount: z.string(),
  durationSeconds: z.coerce.number().min(43200).max(604800), // 12h - 7d
  borrower: z.string(), // Wallet address passed directly
});

loansRouter.post(
  '/unsigned', 
  createLoanRateLimit,
  zValidator('json', createLoanUnsignedSchema),
  async (c) => {
    const body = c.req.valid('json');
    
    try {
      const result = await loanService.createLoan(body);
      
      return c.json<ApiResponse<{ transaction: string }>>({
        success: true,
        data: {
          transaction: result.transaction,  // Base64 encoded unsigned TX
        },
      }, 201);
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Repay loan (requires auth)
loansRouter.post('/:pubkey/repay', requireAuth, async (c) => {
  const pubkey = c.req.param('pubkey');
  const user = c.user!;
  
  try {
    const loan = await loanService.repayLoan(pubkey, user.wallet);
    
    return c.json<ApiResponse<Loan>>({
      success: true,
      data: loan,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Repay loan (unsigned) - returns transaction for client signing
const repayUnsignedSchema = z.object({
  borrower: z.string(),
});

loansRouter.post(
  '/:pubkey/repay/unsigned',
  createLoanRateLimit,
  zValidator('json', repayUnsignedSchema),
  async (c) => {
    const pubkey = c.req.param('pubkey');
    const { borrower } = c.req.valid('json');
    
    try {
      const result = await loanService.buildRepayTransaction(pubkey, borrower);
      
      return c.json<ApiResponse<{ transaction: string }>>({
        success: true,
        data: {
          transaction: result.transaction,
        },
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Liquidate loan
loansRouter.post('/:pubkey/liquidate', requireAuth, async (c) => {
  const pubkey = c.req.param('pubkey');
  const user = c.user!;
  
  try {
    const loan = await loanService.liquidateLoan(pubkey, user.wallet);
    
    return c.json<ApiResponse<Loan>>({
      success: true,
      data: loan,
    });
  } catch (error: any) {
    return c.json<ApiResponse<null>>({
      success: false,
      error: error.message,
    }, 400);
  }
});

// Track loan after on-chain creation
const trackLoanSchema = z.object({
  loanPubkey: z.string(),
  txSignature: z.string(),
  borrower: z.string(),
  tokenMint: z.string(),
});

loansRouter.post(
  '/track',
  zValidator('json', trackLoanSchema),
  async (c) => {
    const body = c.req.valid('json');
    
    try {
      const loan = await loanService.trackCreatedLoan(body);
      
      return c.json<ApiResponse<Loan>>({
        success: true,
        data: loan,
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

// Confirm loan repayment after on-chain success
const confirmRepaySchema = z.object({
  txSignature: z.string(),
});

loansRouter.post(
  '/:pubkey/repay/confirm',
  zValidator('json', confirmRepaySchema),
  async (c) => {
    const pubkey = c.req.param('pubkey');
    const { txSignature } = c.req.valid('json');
    
    try {
      const loan = await loanService.confirmRepayment(pubkey, txSignature);
      
      return c.json<ApiResponse<Loan>>({
        success: true,
        data: loan,
      });
    } catch (error: any) {
      return c.json<ApiResponse<null>>({
        success: false,
        error: error.message,
      }, 400);
    }
  }
);

export { loansRouter };