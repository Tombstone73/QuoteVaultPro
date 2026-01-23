/**
 * Structured Logger
 * 
 * Production-safe structured logging with correlation IDs and sensitive data redaction.
 * 
 * Key behaviors:
 * - All logs include: level, msg, timestamp, requestId (if available), organizationId (if available), userId (if available)
 * - Automatic redaction of credentials, tokens, secrets, passwords
 * - JSON output for production log aggregation
 * - Human-readable output for development
 * 
 * Usage:
 *   import { logger } from './logger';
 *   logger.info('User logged in', { userId: '123', email: 'user@example.com' });
 *   logger.error('Payment failed', { error, orderId: '456' });
 */

import type { Request } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  organizationId?: string;
  userId?: string;
  [key: string]: any;
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PRODUCTION ? 'info' : 'debug');

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Sensitive field patterns that should be redacted from logs
 */
const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /auth/i,
  /bearer/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /private[_-]?key/i,
  /credential/i,
  /ssn/i,
  /credit[_-]?card/i,
  /cvv/i,
  /pin/i,
];

/**
 * Redact sensitive fields from objects before logging
 */
function redactSensitiveData(obj: any, depth: number = 0): any {
  if (depth > 5) return '[max depth]'; // Prevent infinite recursion
  
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj !== 'object') return obj;
  
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: IS_PRODUCTION ? undefined : obj.stack,
    };
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, depth + 1));
  }
  
  const redacted: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
    
    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      redacted[key] = redactSensitiveData(value, depth + 1);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

/**
 * Extract correlation context from Express request
 */
function extractRequestContext(req?: Request): LogContext {
  if (!req) return {};
  
  return {
    requestId: req.requestId,
    organizationId: req.organizationId,
    userId: (req.user as any)?.id || (req.user as any)?.claims?.sub,
  };
}

/**
 * Format log entry for output
 */
function formatLog(level: LogLevel, message: string, context: LogContext): string {
  const timestamp = new Date().toISOString();
  
  const logEntry = {
    level,
    msg: message,
    timestamp,
    ...redactSensitiveData(context),
  };
  
  if (IS_PRODUCTION) {
    // JSON output for log aggregation (Datadog, CloudWatch, etc.)
    return JSON.stringify(logEntry);
  } else {
    // Human-readable output for development
    const contextStr = Object.keys(context).length > 0
      ? ' ' + JSON.stringify(redactSensitiveData(context), null, 0)
      : '';
    return `[${timestamp}] ${level.toUpperCase()} ${message}${contextStr}`;
  }
}

/**
 * Check if log level should be emitted
 */
function shouldLog(level: LogLevel): boolean {
  const configuredPriority = LEVEL_PRIORITY[LOG_LEVEL as LogLevel] ?? LEVEL_PRIORITY.info;
  const messagePriority = LEVEL_PRIORITY[level];
  return messagePriority >= configuredPriority;
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, context: LogContext = {}): void {
  if (!shouldLog(level)) return;
  
  const output = formatLog(level, message, context);
  
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

/**
 * Structured logger instance
 */
export const logger = {
  /**
   * Debug-level logging (verbose, development-only by default)
   */
  debug(message: string, context: LogContext = {}): void {
    log('debug', message, context);
  },
  
  /**
   * Info-level logging (normal operations)
   */
  info(message: string, context: LogContext = {}): void {
    log('info', message, context);
  },
  
  /**
   * Warning-level logging (unexpected but handled)
   */
  warn(message: string, context: LogContext = {}): void {
    log('warn', message, context);
  },
  
  /**
   * Error-level logging (failures requiring attention)
   */
  error(message: string, context: LogContext = {}): void {
    log('error', message, context);
  },
  
  /**
   * Create a child logger with request context pre-attached
   * Use this at route entry points to avoid repeating context
   */
  withRequest(req: Request) {
    const baseContext = extractRequestContext(req);
    
    return {
      debug: (message: string, context: LogContext = {}) =>
        log('debug', message, { ...baseContext, ...context }),
      info: (message: string, context: LogContext = {}) =>
        log('info', message, { ...baseContext, ...context }),
      warn: (message: string, context: LogContext = {}) =>
        log('warn', message, { ...baseContext, ...context }),
      error: (message: string, context: LogContext = {}) =>
        log('error', message, { ...baseContext, ...context }),
    };
  },
};

/**
 * Helper to log errors with full context
 */
export function logError(error: unknown, context: LogContext = {}): void {
  if (error instanceof Error) {
    logger.error(error.message, {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: IS_PRODUCTION ? undefined : error.stack,
      },
    });
  } else {
    logger.error('Unknown error', {
      ...context,
      error: String(error),
    });
  }
}
