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

export { loansRouter };