import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { syncUsersToCustomers } from "./db/syncUsersToCustomers";
import { startSyncWorker } from "./workers/syncProcessor";

const app = express();

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
    // Probe database schema before starting server
    const { probeDatabaseSchema } = await import('./db');
    await probeDatabaseSchema();

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
      
      // Start QuickBooks sync worker
      if (process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET) {
        console.log('[Server] Starting QuickBooks sync worker...');
        startSyncWorker();
      } else {
        console.log('[Server] QuickBooks not configured, sync worker disabled');
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
