/**
 * Graceful Shutdown Handler
 * 
 * Handles SIGTERM/SIGINT signals to cleanly shut down the application:
 * 1. Stop accepting new HTTP requests
 * 2. Stop worker polling intervals
 * 3. Wait for in-flight operations to complete (with timeout)
 * 4. Close database connections
 * 5. Exit cleanly
 * 
 * Prevents:
 * - Dropped requests during deploys
 * - Database connection leaks
 * - Half-processed background jobs
 */

import type { Server } from 'http';
import { logger } from '../logger';

/**
 * Graceful shutdown timeout (30 seconds by default)
 */
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || '30000', 10);

/**
 * Check if graceful shutdown is enabled
 */
function isGracefulShutdownEnabled(): boolean {
  const enabled = process.env.FEATURE_GRACEFUL_SHUTDOWN_ENABLED;
  if (enabled === undefined || enabled === '') return true; // Default: enabled
  return !['0', 'false', 'off', 'no'].includes(enabled.toLowerCase().trim());
}

/**
 * Track in-flight requests
 */
let inFlightRequests = 0;

/**
 * Track worker intervals for cleanup
 */
const workerIntervals: NodeJS.Timeout[] = [];

/**
 * Increment in-flight request counter
 */
export function trackRequest(): () => void {
  inFlightRequests++;
  return () => {
    inFlightRequests = Math.max(0, inFlightRequests - 1);
  };
}

/**
 * Register worker interval for cleanup during shutdown
 */
export function registerWorkerInterval(interval: NodeJS.Timeout): void {
  workerIntervals.push(interval);
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown(server: Server, closeDatabase: () => Promise<void>): void {
  if (!isGracefulShutdownEnabled()) {
    logger.info('Graceful shutdown disabled via configuration');
    return;
  }
  
  let isShuttingDown = false;
  
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, ignoring signal', { signal });
      return;
    }
    
    isShuttingDown = true;
    
    // Use structured logger without requestId (shutdown is not a request)
    logger.info('Graceful shutdown initiated', {
      signal,
      inFlightRequests,
      activeWorkers: workerIntervals.length,
    });
    
    // Step 1: Stop accepting new HTTP requests
    server.close(() => {
      logger.info('HTTP server closed, no longer accepting connections');
    });
    
    // Step 2: Stop all worker intervals
    logger.info('Stopping worker intervals', { count: workerIntervals.length });
    for (const interval of workerIntervals) {
      clearInterval(interval);
    }
    
    // Step 3: Wait for in-flight operations to complete (with timeout)
    const shutdownStart = Date.now();
    const checkInterval = 100; // Check every 100ms
    
    const waitForInFlight = new Promise<void>((resolve) => {
      const check = () => {
        const elapsed = Date.now() - shutdownStart;
        
        if (inFlightRequests === 0) {
          logger.info('All in-flight requests completed', { elapsed });
          resolve();
        } else if (elapsed >= SHUTDOWN_TIMEOUT_MS) {
          logger.warn('Shutdown timeout reached, forcing exit', {
            elapsed,
            abandonedRequests: inFlightRequests,
          });
          resolve();
        } else {
          setTimeout(check, checkInterval);
        }
      };
      
      check();
    });
    
    await waitForInFlight;
    
    // Step 4: Close database connections
    try {
      logger.info('Closing database connections');
      await closeDatabase();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    // Step 5: Exit cleanly
    const totalElapsed = Date.now() - shutdownStart;
    logger.info('Graceful shutdown complete', { totalElapsed });
    
    process.exit(0);
  };
  
  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  logger.info('Graceful shutdown handlers registered', { timeout: SHUTDOWN_TIMEOUT_MS });
}
