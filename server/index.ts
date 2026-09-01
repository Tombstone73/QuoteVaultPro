import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { syncUsersToCustomers } from "./db/syncUsersToCustomers";
import { getQuickBooksSyncIntervalMs, startSyncWorker } from "./workers/syncProcessor";
import { getThumbnailFallbackIntervalMs, startThumbnailWorker } from "./workers/thumbnailWorker";
import { assetPreviewWorker, getAssetPreviewFallbackIntervalMs } from "./workers/assetPreviewWorker";
import { assertStripeServerConfig } from "./lib/stripe";
import { getQuickBooksSyncStabilityWindowMs, listQuickBooksConnectedOrganizationIds, runQuickBooksSyncWorkerForOrg } from "./services/quickbooksSyncQueueWorker";
import { isWorkerEnabled, logWorkerStatus, getWorkerIntervalOverride, logWorkerTick } from "./workers/workerGates";
import { runInvoiceReminderJob } from "./invoiceReminderJob";
import { runBulkInvoiceEmailQueueWorker } from "./services/invoiceBulkEmailQueue.service";
import { reconcilePendingStripeObservations } from "./services/stripePaymentReconciliationService";
import { runMigrations } from "./runMigrations";
import { getAllowedCorsOrigins, getRuntimeConfigLogLine } from "./lib/appRuntimeConfig";
import { getStartupSharedDevDatabaseWarning } from "./lib/runtimeEnvironment";
import {
  INVOICE_LOGO_JSON_BODY_LIMIT_BYTES,
  INVOICE_LOGO_TOO_LARGE_MESSAGE,
} from "@shared/companyInfoInvoiceBranding";

const app = express();
const bootstrapModeEnabled = (process.env.BOOTSTRAP_MODE ?? "").trim().toLowerCase() === "true";

if (bootstrapModeEnabled) {
  console.warn("[BOOTSTRAP] ****************************************************************");
  console.warn("[BOOTSTRAP] BOOTSTRAP_MODE=true — bootstrap admin endpoint is ENABLED.");
  console.warn("[BOOTSTRAP] This must be temporary. Disable BOOTSTRAP_MODE after first use.");
  if (!(process.env.BOOTSTRAP_TOKEN ?? "").trim()) {
    console.warn("[BOOTSTRAP] BOOTSTRAP_TOKEN is missing while bootstrap mode is enabled.");
  }
  console.warn("[BOOTSTRAP] ****************************************************************");
}

const allowedOrigins = getAllowedCorsOrigins();

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (server-to-server, curl, same-origin Vercel proxy)
    if (!origin) {
      callback(null, true);
      return;
    }
    // Allow requests from explicitly allowed origins; deny others without throwing
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // Return false → CORS headers omitted, browser blocks the request.
      // Do NOT call callback(new Error(...)) — that causes a 500.
      callback(null, false);
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Idempotency-Key"],
  exposedHeaders: ["Set-Cookie"],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // Handle preflight requests

// Trust first reverse proxy hop for secure cookies behind hosting proxies.
app.set("trust proxy", 1);

console.log(getRuntimeConfigLogLine());
const sharedDevDatabaseWarning = getStartupSharedDevDatabaseWarning();
if (sharedDevDatabaseWarning) {
  console.warn(sharedDevDatabaseWarning);
}

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: INVOICE_LOGO_JSON_BODY_LIMIT_BYTES,
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

    // Run Drizzle migrations before anything that depends on schema.
    // Set DRIZZLE_AUTO_MIGRATE=0 to disable in an emergency.
    console.log("[Migrations] index.ts → about to call runMigrations()");
    await runMigrations();
    console.log("[Migrations] index.ts → runMigrations() returned successfully");

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

    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const isInvoiceLogoSizeError = status === 413 && req.path === "/api/company-settings/invoice-logo";
      const message = isInvoiceLogoSizeError ? INVOICE_LOGO_TOO_LARGE_MESSAGE : (err.message || "Internal Server Error");
      console.error('[Server] Error handler:', err);
      res.status(status).json(isInvoiceLogoSizeError ? { success: false, message } : { message });
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
        thumbnailsEnabled ? getThumbnailFallbackIntervalMs() : undefined,
        thumbnailsEnabled ? 'upload/import triggers enabled; fallback sweep only' : undefined
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
        assetPreviewEnabled ? getAssetPreviewFallbackIntervalMs() : undefined,
        assetPreviewEnabled ? 'asset create/import triggers enabled; fallback sweep only' : undefined
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
          qbSyncEnabled ? getQuickBooksSyncIntervalMs() : undefined
        );
        if (qbSyncEnabled) {
          console.log('[Server] Starting QuickBooks sync worker...');
          startSyncWorker();
        }

        // QB Queue Worker (invoice/payment outbox sync)
        const qbQueueEnabled = isWorkerEnabled('QB_QUEUE', true);
        const qbQueueInterval = getWorkerIntervalOverride(
          'QB_QUEUE',
          60 * 60_000,
          300_000,
          ['QUICKBOOKS_SYNC_INTERVAL_MS', 'QB_SYNC_QUEUE_INTERVAL_MS']
        );
        logWorkerStatus('QuickBooks Queue', qbQueueEnabled, qbQueueEnabled ? qbQueueInterval : undefined);
        
        if (qbQueueEnabled) {
          const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
          const limitPerRun = Math.max(1, Math.min(100, Number(process.env.QB_SYNC_LIMIT_PER_RUN || '25')));

          console.log('[Server] QuickBooks queue worker enabled', {
            intervalMs: qbQueueInterval,
            stabilityWindowMs,
            limitPerRun,
            policy: 'interval=pending-only, flush=pending+failed',
          });

          const qbQueueTimer = setInterval(async () => {
            const tickStart = Date.now();
            try {
              const orgIds = await listQuickBooksConnectedOrganizationIds();
              if (orgIds.length === 0) return;

              for (const organizationId of orgIds) {
                const run = await runQuickBooksSyncWorkerForOrg({
                  organizationId,
                  stabilityWindowMs,
                  limitPerRun,
                  ignoreStabilityWindow: false,
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
          qbQueueTimer.unref?.();
        }
      } else {
        logWorkerStatus('QuickBooks Sync', false, undefined, 'no QB credentials');
        logWorkerStatus('QuickBooks Queue', false, undefined, 'no QB credentials');
      }

      // Invoice Reminder Worker
      // Default: DISABLED in all environments — must be explicitly opted in.
      // Enable via: WORKER_INVOICE_REMINDERS_ENABLED=true (or legacy INVOICE_REMINDER_JOB_ENABLED=true)
      const invoiceReminderJobLegacy = (process.env.INVOICE_REMINDER_JOB_ENABLED ?? '').toLowerCase() === 'true';
      const invoiceReminderEnabled =
        isWorkerEnabled('INVOICE_REMINDERS', false) || invoiceReminderJobLegacy;
      const invoiceReminderInterval = getWorkerIntervalOverride(
        'INVOICE_REMINDERS',
        60 * 60 * 1000,       // production default: 1 hour
        60 * 60 * 1000,       // non-production default: 1 hour (but gate keeps it off)
      );
      logWorkerStatus(
        'Invoice Reminders',
        invoiceReminderEnabled,
        invoiceReminderEnabled ? invoiceReminderInterval : undefined,
      );

      if (invoiceReminderEnabled) {
        console.log('[Server] Invoice reminder automation ENABLED. Emails will be sent automatically.');
        setInterval(async () => {
          const tickStart = Date.now();
          try {
            const summary = await runInvoiceReminderJob();
            if (summary.remindersSent > 0 || summary.remindersFailed > 0) {
              console.log(
                `[ReminderTick] sent=${summary.remindersSent} failed=${summary.remindersFailed} skipped=${summary.skipped} orgs=${summary.organizationsChecked}`,
              );
            }
          } catch (e) {
            console.error('[ReminderTick] Unexpected error:', e);
          } finally {
            logWorkerTick('invoice_reminders', Date.now() - tickStart);
          }
        }, invoiceReminderInterval);
      } else {
        console.log('[Server] Invoice reminder automation DISABLED. No reminder emails will be sent automatically. Enable with WORKER_INVOICE_REMINDERS_ENABLED=true.');
      }

      // Bulk invoice email delivery is durable and asynchronous. It is enabled
      // in production by default, but remains off in non-production unless an
      // operator explicitly enables WORKER_BULK_INVOICE_EMAILS_ENABLED.
      const bulkInvoiceEmailEnabled = isWorkerEnabled('BULK_INVOICE_EMAILS', true);
      const bulkInvoiceEmailInterval = getWorkerIntervalOverride(
        'BULK_INVOICE_EMAILS',
        15_000,
        60_000,
      );
      logWorkerStatus(
        'Bulk Invoice Email',
        bulkInvoiceEmailEnabled,
        bulkInvoiceEmailEnabled ? bulkInvoiceEmailInterval : undefined,
      );
      if (bulkInvoiceEmailEnabled) {
        const runBulkInvoiceEmailTick = async () => {
          const tickStart = Date.now();
          try {
            const summary = await runBulkInvoiceEmailQueueWorker();
            if (summary.processed > 0) {
              console.log(`[BulkInvoiceEmailTick] processed=${summary.processed} sent=${summary.sent} failed=${summary.failed}`);
            }
            logWorkerTick('bulk_invoice_emails', Date.now() - tickStart, summary.processed);
          } catch (error) {
            console.error('[BulkInvoiceEmailTick] Unexpected error:', error);
          }
        };
        const bulkInvoiceEmailTimer = setInterval(runBulkInvoiceEmailTick, bulkInvoiceEmailInterval);
        bulkInvoiceEmailTimer.unref?.();
      }

      const paymentReconciliationEnabled = isWorkerEnabled('PAYMENT_RECONCILIATION', true);
      const paymentReconciliationInterval = getWorkerIntervalOverride(
        'PAYMENT_RECONCILIATION',
        60 * 1000,
        5 * 60 * 1000,
      );
      logWorkerStatus('Payment Reconciliation', paymentReconciliationEnabled, paymentReconciliationEnabled ? paymentReconciliationInterval : undefined);
      if (paymentReconciliationEnabled) {
        const runPaymentReconciliation = async () => {
          const tickStart = Date.now();
          try {
            const summary = await reconcilePendingStripeObservations();
            if (summary.processed || summary.failed) console.log(`[PaymentReconciliationTick] processed=${summary.processed} failed=${summary.failed}`);
            logWorkerTick('payment_reconciliation', Date.now() - tickStart, summary.processed + summary.failed);
          } catch (error) {
            console.error('[PaymentReconciliationTick] Unexpected error:', error);
          }
        };
        void runPaymentReconciliation();
        const paymentReconciliationTimer = setInterval(runPaymentReconciliation, paymentReconciliationInterval);
        paymentReconciliationTimer.unref?.();
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
