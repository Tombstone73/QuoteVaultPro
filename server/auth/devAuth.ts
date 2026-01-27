/**
 * Dev Authentication Provider (AUTH_PROVIDER=dev)
 * 
 * DEVELOPMENT-ONLY instant login bypass for local development and emergencies.
 * 
 * CRITICAL SAFETY:
 * - Only works when AUTH_PROVIDER=dev AND NODE_ENV !== production
 * - Returns 404 in production (never 401/403 to avoid leaking existence)
 * - No logging in production
 * - No passwords
 * - No hardcoded secrets exposed to prod
 * 
 * Features:
 * - Instant login as dev@local.test (owner role)
 * - Session-based authentication (PostgreSQL store)
 * - Multi-tenant safe (auto-provisions to DEFAULT_ORGANIZATION_ID)
 * - Reuses existing session infrastructure
 * 
 * Auth endpoints:
 * - POST /api/auth/dev-login - Instant login (dev only)
 * - POST /api/auth/logout - Clear session
 * - GET /api/auth/me - Get current user
 * - GET /api/auth/config - Get auth provider type (public)
 */

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { db } from "../db";
import { users, userOrganizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger";

const DEFAULT_ORGANIZATION_ID = "org_titan_001";
const DEV_USER_EMAIL = "dev@local.test";

/**
 * Get Express session middleware with PostgreSQL store
 * 
 * Session TTL: 7 days
 * Store: PostgreSQL (sessions table)
 * Cookie: secure=false for dev (HTTP allowed)
 */
export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false, // HTTP allowed for localhost
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

/**
 * Check if dev login is allowed
 * 
 * MUST meet ALL conditions:
 * - AUTH_PROVIDER=dev
 * - NODE_ENV !== production
 */
function isDevLoginAllowed(): boolean {
  const authProvider = (process.env.AUTH_PROVIDER || "").trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  
  return authProvider === "dev" && nodeEnv !== "production";
}

/**
 * Setup dev authentication
 * 
 * Configures:
 * - Session middleware
 * - Passport initialization
 * - Dev login endpoint (POST /api/auth/dev-login)
 * - Standard endpoints (logout, me, config)
 * 
 * @param app - Express application instance
 */
export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Passport serialize/deserialize
  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const user = result[0];

      if (!user) {
        return cb(new Error("User not found"));
      }

      const { passwordHash: _, ...safeUser } = user;
      cb(null, safeUser);
    } catch (error: any) {
      console.error("[devAuth] Deserialize error:", error.message);
      cb(error);
    }
  });

  // =============================
  // Dev Login Endpoint (GUARDED)
  // =============================

  /**
   * POST /api/auth/dev-login
   * 
   * Response: { success: true, data: { user } } or 404
   * 
   * Guards:
   * - AUTH_PROVIDER=dev
   * - NODE_ENV !== production
   * 
   * If guards fail: 404 (never log, never explain)
   */
  app.post("/api/auth/dev-login", async (req, res) => {
    // Guard: Dev login only allowed in dev mode
    if (!isDevLoginAllowed()) {
      return res.status(404).end();
    }

    const requestId = req.requestId || randomId();

    try {
      logger.info("auth_dev_login_start", {
        requestId,
        organizationId: undefined,
      });

      // Find or create dev user
      let user = await db
        .select()
        .from(users)
        .where(sql`LOWER(${users.email}) = ${DEV_USER_EMAIL}`)
        .limit(1)
        .then((rows) => rows[0]);

      if (!user) {
        // Create dev user
        const userId = `user_dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        await db.insert(users).values({
          id: userId,
          email: DEV_USER_EMAIL,
          firstName: "Dev",
          lastName: "User",
          role: "owner",
          isAdmin: true,
          profileImageUrl: null,
          passwordHash: null,
        });

        user = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .then((rows) => rows[0]);

        logger.info("auth_dev_user_created", {
          requestId,
          userId: user.id,
        });
      }

      // Ensure user has organization membership
      const existingMembership = await db
        .select()
        .from(userOrganizations)
        .where(
          sql`${userOrganizations.userId} = ${user.id} AND ${userOrganizations.organizationId} = ${DEFAULT_ORGANIZATION_ID}`
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (!existingMembership) {
        await db.insert(userOrganizations).values({
          userId: user.id,
          organizationId: DEFAULT_ORGANIZATION_ID,
          role: "owner",
          isDefault: true,
        });

        logger.info("auth_dev_org_membership_created", {
          requestId,
          userId: user.id,
          organizationId: DEFAULT_ORGANIZATION_ID,
        });
      }

      // Remove passwordHash from user object
      const { passwordHash: _, ...safeUser } = user;

      // Establish session using Passport
      req.login(safeUser, (loginErr) => {
        if (loginErr) {
          logger.error("auth_dev_session_error", {
            requestId,
            userId: user.id,
            error: loginErr.message,
          });
          return res.status(500).json({
            success: false,
            message: "Failed to establish session",
          });
        }

        logger.info("auth_dev_login_success", {
          requestId,
          userId: user.id,
        });

        res.json({
          success: true,
          data: { user: safeUser },
        });
      });
    } catch (error: any) {
      logger.error("auth_dev_login_error", {
        requestId,
        organizationId: undefined,
        error: error.message,
      });

      res.status(500).json({
        success: false,
        message: "Login failed",
      });
    }
  });

  // =============================
  // Standard Auth Endpoints
  // =============================

  /**
   * POST /api/auth/logout
   * 
   * Response: { success: true }
   */
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("[devAuth] Logout error:", err);
        return res.status(500).json({
          success: false,
          message: "Logout failed",
        });
      }

      res.json({ success: true });
    });
  });

  /**
   * GET /api/auth/me
   * 
   * Returns current authenticated user or 401 if not logged in.
   * Response: { success: true, data: { user } } or 401
   */
  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    res.json({
      success: true,
      data: { user: req.user },
    });
  });

  /**
   * GET /api/auth/config
   * 
   * Returns current auth provider type (safe to expose publicly)
   * Response: { provider: "dev" }
   */
  app.get("/api/auth/config", (req, res) => {
    res.json({
      provider: "dev",
    });
  });

  console.log("[devAuth] Auth endpoints registered:");
  console.log("  POST /api/auth/dev-login (DEV ONLY)");
  console.log("  POST /api/auth/logout");
  console.log("  GET /api/auth/me");
  console.log("  GET /api/auth/config");
}

/**
 * Middleware: Require authenticated user
 * 
 * Returns 401 if user is not logged in.
 * Use on protected routes.
 */
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  
  res.status(401).json({
    success: false,
    message: "Authentication required",
  });
};

/**
 * Middleware: Require admin role
 * 
 * Returns 403 if user is not admin or owner.
 * Must be used after isAuthenticated.
 */
export const isAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  const user = req.user;
  const isAdminOrOwner = user.isAdmin || user.role === "owner" || user.role === "admin";

  if (!isAdminOrOwner) {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }

  next();
};

/**
 * Middleware: Require owner role
 * 
 * Returns 403 if user is not owner.
 * Must be used after isAuthenticated.
 */
export const isOwner: RequestHandler = (req: any, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (req.user.role !== "owner") {
    return res.status(403).json({
      success: false,
      message: "Owner access required",
    });
  }

  next();
};

// =============================
// Helper Functions
// =============================

/**
 * Generate random ID for request tracking
 */
function randomId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
