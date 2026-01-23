/**
 * Health Check Endpoints
 * 
 * Production-required endpoints for orchestrator (Railway) monitoring.
 * 
 * - GET /health: Liveness probe (is process alive?)
 * - GET /ready: Readiness probe (is service ready to accept traffic?)
 * 
 * These endpoints are ALWAYS ON and cannot be disabled.
 * They are excluded from rate limiting.
 */

import type { Request, Response } from 'express';
import { db } from '../db';
import { logger } from '../logger';

/**
 * Database readiness check timeout (2 seconds)
 */
const DB_CHECK_TIMEOUT_MS = parseInt(process.env.HEALTH_DB_TIMEOUT_MS || '2000', 10);

/**
 * Cached database connectivity state
 * Updated by readiness checks to avoid hammering DB
 */
let dbConnected = false;
let lastDbCheck = 0;
const DB_CHECK_CACHE_MS = 5000; // Cache for 5 seconds

/**
 * Check database connectivity with timeout
 */
async function checkDatabaseConnectivity(): Promise<boolean> {
  const now = Date.now();
  
  // Use cached result if recent
  if (now - lastDbCheck < DB_CHECK_CACHE_MS) {
    return dbConnected;
  }
  
  try {
    // Simple connectivity check with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database check timeout')), DB_CHECK_TIMEOUT_MS);
    });
    
    const checkPromise = db.execute('SELECT 1 as health_check');
    
    await Promise.race([checkPromise, timeoutPromise]);
    
    dbConnected = true;
    lastDbCheck = now;
    return true;
  } catch (error) {
    dbConnected = false;
    lastDbCheck = now;
    
    logger.error('Database connectivity check failed', {
      error: error instanceof Error ? error.message : String(error),
      timeout: DB_CHECK_TIMEOUT_MS,
    });
    
    return false;
  }
}

/**
 * GET /health - Liveness probe
 * 
 * Purpose: Is the Node process alive?
 * Checks: Process uptime only (no external dependencies)
 * Response: Always 200 OK unless process crashed
 * 
 * Used by orchestrators to detect hung/crashed processes.
 */
export async function healthCheck(req: Request, res: Response): Promise<void> {
  const uptime = Math.floor(process.uptime());
  
  res.status(200).json({
    status: 'ok',
    uptime,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /ready - Readiness probe
 * 
 * Purpose: Is the service ready to accept traffic?
 * Checks: Database connectivity (with timeout)
 * Response: 200 if ready, 503 if not ready
 * 
 * Used by orchestrators to gate traffic routing (e.g., during startup or DB outages).
 */
export async function readinessCheck(req: Request, res: Response): Promise<void> {
  const isReady = await checkDatabaseConnectivity();
  
  if (isReady) {
    res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Force database connectivity check (bypass cache)
 * Used during startup validation
 */
export async function validateDatabaseConnectivity(): Promise<boolean> {
  lastDbCheck = 0; // Reset cache
  return await checkDatabaseConnectivity();
}
