import "dotenv/config";
import { startPolling, stopPolling } from "./poller";
import { startCleanup, stopCleanup } from "./cleanup";

/**
 * Prepress Worker Main Entry Point
 * 
 * Separate worker process for processing prepress jobs.
 * This is the primary/production mode.
 * 
 * Usage:
 *   npm run prepress:worker
 *   npm run prepress:worker:dev (with --watch)
 */

const CLEANUP_INTERVAL_MS = parseInt(process.env.PREPRESS_CLEANUP_INTERVAL_MS || String(30 * 60 * 1000));

async function main() {
  console.log('[Prepress Worker] Starting...');
  
  // Probe database connection
  try {
    const { probeDatabaseSchema } = await import('../../db');
    await probeDatabaseSchema();
    console.log('[Prepress Worker] Database connection verified');
  } catch (error) {
    console.error('[Prepress Worker] Database connection failed:', error);
    process.exit(1);
  }
  
  // Start job polling
  startPolling();
  
  // Start TTL cleanup
  startCleanup(CLEANUP_INTERVAL_MS);
  
  console.log('[Prepress Worker] Running');
  
  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Prepress Worker] Received ${signal}, shutting down...`);
    
    stopPolling();
    stopCleanup();
    
    console.log('[Prepress Worker] Shutdown complete');
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('[Prepress Worker] Fatal error:', error);
    process.exit(1);
  });
}

export { main as startWorker };
