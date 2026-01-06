import { Context } from 'hono';
import { getRequestId } from '../middleware/requestId.js';
import { getIp } from '../middleware/trustedProxy.js';

interface LogContext {
  requestId?: string;
  ip?: string;
  userId?: string;
  path?: string;
  method?: string;
  [key: string]: any;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private formatMessage(level: LogLevel, message: string, context: LogContext = {}): string {
    const timestamp = new Date().toISOString();
    const logObject = {
      timestamp,
      level,
      message,
      ...context,
    };
    
    // JSON format for production (easier to parse in log aggregators)
    if (process.env.NODE_ENV === 'production') {
      return JSON.stringify(logObject);
    }
    
    // Pretty format for development
    const contextStr = Object.keys(context).length > 0 
      ? ` ${JSON.stringify(context)}` 
      : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }
  
  debug(message: string, context?: LogContext) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.formatMessage('debug', message, context));
    }
  }
  
  info(message: string, context?: LogContext) {
    console.info(this.formatMessage('info', message, context));
  }
  
  warn(message: string, context?: LogContext) {
    console.warn(this.formatMessage('warn', message, context));
  }
  
  error(message: string, context?: LogContext) {
    console.error(this.formatMessage('error', message, context));
  }
  
  /**
   * Create a child logger with request context
   */
  withRequest(c: Context) {
    const requestId = getRequestId(c);
    const ip = getIp(c);
    const userId = (c as any).user?.wallet;
    const path = c.req.path;
    const method = c.req.method;
    
    const baseContext: LogContext = {
      requestId,
      ip,
      path,
      method,
      ...(userId && { userId }),
    };
    
    return {
      debug: (message: string, context?: LogContext) => 
        this.debug(message, { ...baseContext, ...context }),
      info: (message: string, context?: LogContext) => 
        this.info(message, { ...baseContext, ...context }),
      warn: (message: string, context?: LogContext) => 
        this.warn(message, { ...baseContext, ...context }),
      error: (message: string, context?: LogContext) => 
        this.error(message, { ...baseContext, ...context }),
    };
  }
}

export const logger = new Logger();
export default logger;