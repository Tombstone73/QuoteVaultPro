#!/usr/bin/env tsx

/**
 * Prepress Worker Entry Script
 * 
 * Standalone worker process for processing prepress jobs.
 * 
 * Usage:
 *   npm run prepress:worker
 *   npm run prepress:worker:dev (with --watch for development)
 */

import { startWorker } from "../server/prepress/worker/main";

startWorker();
