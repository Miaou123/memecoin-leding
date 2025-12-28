import { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export const errorHandler = (err: Error, c: Context) => {
  console.error('Error:', err);

  // Handle HTTPException
  if (err instanceof HTTPException) {
    return c.json({
      success: false,
      error: err.message,
      statusCode: err.status,
    }, err.status);
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      success: false,
      error: 'Validation Error',
      details: err.errors.map(e => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    }, 400);
  }

  // Handle Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    if (prismaError.code === 'P2002') {
      return c.json({
        success: false,
        error: 'Duplicate entry',
        field: prismaError.meta?.target,
      }, 409);
    }
    if (prismaError.code === 'P2025') {
      return c.json({
        success: false,
        error: 'Record not found',
      }, 404);
    }
  }

  // Default error response
  return c.json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  }, 500);
};