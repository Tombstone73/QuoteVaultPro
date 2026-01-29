import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { syncUsersToCustomers } from "./db/syncUsersToCustomers";
import { startSyncWorker } from "./workers/syncProcessor";
import { startThumbnailWorker } from "./workers/thumbnailWorker";
import { assetPreviewWorker } from "./workers/assetPreviewWorker";
import { assertStripeServerConfig } from "./lib/stripe";
import { listQuickBooksConnectedOrganizationIds, runQuickBooksSyncWorkerForOrg } from "./services/quickbooksSyncQueueWorker";
import { isWorkerEnabled, logWorkerStatus, getWorkerIntervalOverride, logWorkerTick } from "./workers/workerGates";

const app = express();

// CORS configuration for production frontend
const allowedOrigins = [
  "https://www.printershero.com",
  "http://localhost:5173", // Vite dev server
  "http://localhost:5000", // Local backend
];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests) in development
    if (!origin && process.env.NODE_ENV === "development") {
      callback(null, true);
      return;
    }
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["Set-Cookie"],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Handle preflight requests

// Trust proxy for secure cookies in production (Railway)
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Register routes and start server
(async () => {
  try {
    // Stripe configuration preflight (safe, logs once, never prints secrets)
    assertStripeServerConfig({ logOnce: true });

    // Probe database schema before starting server
    const { probeDatabaseSchema } = await import('./db');
    await probeDatabaseSchema();

    // DEV-ONLY: Log redacted DATABASE_URL on startup
    if (app.get("env") === "development") {
      const dbUrl = process.env.DATABASE_URL || "";
      let redactedDbInfo = "not_set";
      try {
        const url = new URL(dbUrl);
        redactedDbInfo = `${url.hostname}:${url.port || '5432'}${url.pathname}`;
      } catch {
        redactedDbInfo = "invalid_url";
      }
      console.log(`[Server] DATABASE_URL (redacted): ${redactedDbInfo}`);
    }

    const server = await registerRoutes(app);
    
    // Run user-to-customer sync in development
    if (app.get("env") === "development") {
      try {
        console.log('[Startup] Running user-to-customer sync...');
        await syncUsersToCustomers();
      } catch (error) {
        console.error('[Startup] User sync failed:', error);
        // Don't crash the server, just log the error
      }
    }

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error('[Server] Error handler:', err);
      res.status(status).json({ message });
    });

    // Setup Vite in development mode
    if (app.get("env") === "development") {
      try {
        await setupVite(app, server);
        console.log('[Server] Vite configured successfully');
      } catch (error) {
        console.error('[Server] Vite setup failed:', error);
        throw error;
      }
    } else {
      serveStatic(app);
    }

    // Start listening
    const port = parseInt(process.env.PORT || '5000', 10);
    const listenOptions: any = {
      port,
      host: "0.0.0.0",
    };
    if (process.platform !== 'win32') {
      listenOptions.reusePort = true;
    }
    
    server.listen(listenOptions, () => {
      log(`serving on port ${port}`);
      console.log('[Server] Ready to accept connections');

      // ===== EMAIL DIAGNOSTICS =====
      console.log('[Email] Configuration check:');
      console.log(`  - Email service: emailService module loaded`);
      console.log(`  - DB-based email settings: configured per-organization`);
      console.log(`  - Supported providers: gmail (OAuth2), smtp`);

      // ===== BACKGROUND WORKERS INITIALIZATION =====
      // All workers gated by workerGates.ts for dev/preview cost control
      
      // Thumbnail Worker
      const thumbnailsEnabled = isWorkerEnabled('THUMBNAILS', true);
      logWorkerStatus(
        'Thumbnails',
        thumbnailsEnabled,
        thumbnailsEnabled ? getWorkerIntervalOverride('THUMBNAILS', 10_000, 300_000, 'THUMBNAIL_WORKER_POLL_INTERVAL_MS') : undefined
      );
      if (thumbnailsEnabled) {
        try {
          startThumbnailWorker();
        } catch (error) {
          console.error('[Server] Thumbnail worker failed to start:', error);
        }
      }

      // Asset Preview Worker
      const assetPreviewEnabled = isWorkerEnabled('ASSET_PREVIEW', true);
      logWorkerStatus(
        'AssetPreview',
        assetPreviewEnabled,
        assetPreviewEnabled ? getWorkerIntervalOverride('ASSET_PREVIEW', 600_000, 300_000) : undefined
      );
      if (assetPreviewEnabled) {
        try {
          assetPreviewWorker.start();
        } catch (error) {
          console.error('[Server] Asset preview worker failed to start:', error);
        }
      }

      // Prepress Worker (in-process, optional)
      // Controlled by both WORKERS_ENABLED and PREPRESS_WORKER_IN_PROCESS
      const globalWorkersEnabled = process.env.WORKERS_ENABLED;
      const globalDisabled = globalWorkersEnabled !== undefined && globalWorkersEnabled.toLowerCase() === 'false';
      const prepressExplicit = process.env.PREPRESS_WORKER_IN_PROCESS === 'true';
      const prepressEnabled = prepressExplicit && !globalDisabled;
      
      logWorkerStatus('Prepress (in-process)', prepressEnabled);
      if (prepressEnabled) {
        // Fire-and-forget: prepress worker start is fail-soft
        void import('./prepress/worker/in-process')
          .then(({ startInProcessWorker }) => {
            startInProcessWorker();
          })
          .catch((error) => {
            console.error('[Server] Prepress in-process worker failed to start:', error);
          });
      }
      
      // QuickBooks Workers (only if credentials exist)
      const hasQbCreds = !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
      
      if (hasQbCreds) {
        // QB Sync Worker (accounting_sync_jobs processor)
        const qbSyncEnabled = isWorkerEnabled('QB_SYNC', true);
        logWorkerStatus(
          'QuickBooks Sync',
          qbSyncEnabled,
          qbSyncEnabled ? getWorkerIntervalOverride('QB_SYNC', 30_000, 300_000) : undefined
        );
        if (qbSyncEnabled) {
          console.log('[Server] Starting QuickBooks sync worker...');
          startSyncWorker();
        }

        // QB Queue Worker (invoice/payment outbox sync)
        const qbQueueEnabled = isWorkerEnabled('QB_QUEUE', true);
        const qbQueueInterval = getWorkerIntervalOverride(
          'QB_QUEUE',
          Number(process.env.QB_SYNC_QUEUE_INTERVAL_MS || String(5 * 60_000)),
          300_000,
          'QB_SYNC_QUEUE_INTERVAL_MS'
        );
        logWorkerStatus('QuickBooks Queue', qbQueueEnabled, qbQueueEnabled ? qbQueueInterval : undefined);
        
        if (qbQueueEnabled) {
          const settleWindowMinutes = Math.max(0, Number(process.env.QB_SYNC_SETTLE_WINDOW_MINUTES || '10'));
          const limitPerRun = Math.max(1, Math.min(100, Number(process.env.QB_SYNC_LIMIT_PER_RUN || '25')));

          console.log('[Server] QuickBooks queue worker enabled', {
            intervalMs: qbQueueInterval,
            settleWindowMinutes,
            limitPerRun,
            policy: 'interval=pending-only, flush=pending+failed',
          });

          setInterval(async () => {
            const tickStart = Date.now();
            try {
              const orgIds = await listQuickBooksConnectedOrganizationIds();
              if (orgIds.length === 0) return;

              for (const organizationId of orgIds) {
                const run = await runQuickBooksSyncWorkerForOrg({
                  organizationId,
                  settleWindowMinutes,
                  limitPerRun,
                  ignoreSettleWindow: false,
                  includeFailed: false,
                  log: false,
                });

                const attempted = run.invoices.attempted + run.payments.attempted;
                if (attempted > 0) {
                  console.log(
                    `[QB QueueTick] org=${organizationId} inv=${run.invoices.succeeded}/${run.invoices.failed} pay=${run.payments.succeeded}/${run.payments.failed}`
                  );
                }
              }
            } catch (e) {
              console.error('[QB QueueTick] failed:', e);
            } finally {
              logWorkerTick('qb_queue', Date.now() - tickStart);
            }
          }, qbQueueInterval);
        }
      } else {
        logWorkerStatus('QuickBooks Sync', false, undefined, 'no QB credentials');
        logWorkerStatus('QuickBooks Queue', false, undefined, 'no QB credentials');
      }
    });

    server.on('error', (error: any) => {
      console.error('[Server] Error:', error);
      process.exit(1);
    });
  } catch (error) {
    console.error('[Server] Fatal error:', error);
    process.exit(1);
  }
})();
