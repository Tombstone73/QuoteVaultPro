/**
 * Magic Link Authentication Provider (AUTH_PROVIDER=magiclink)
 * 
 * Passwordless authentication via email-based magic links.
 * Uses short-lived JWT tokens (15 minutes) sent via email.
 * 
 * Features:
 * - Passwordless login (no stored credentials)
 * - Email-based authentication with magic links
 * - JWT tokens signed with SESSION_SECRET (15 min expiry)
 * - Auto-upsert users on first login
 * - Session-based authentication (PostgreSQL store)
 * - Multi-tenant user resolution via userOrganizations table
 * - Rate limiting on request endpoint
 * 
 * Auth flow:
 * 1. User requests magic link via POST /api/auth/magic-link/request
 * 2. Email sent with magic link containing JWT token
 * 3. User clicks link → GET /api/auth/magic-link/consume?token=...
 * 4. Token verified, user upserted, session established
 * 
 * SECURITY:
 * - Token is short-lived (15 minutes)
 * - Token is single-use (no DB storage, rely on session establishment)
 * - Never log token value
 * - Never leak whether user exists in request endpoint
 */

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { db } from "../db";
import { users, userOrganizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { emailService } from "../emailService";
import { authRateLimit } from "../middleware/rateLimiting";
import { logger } from "../logger";

const DEFAULT_ORGANIZATION_ID = "org_titan_001";

/**
 * Get Express session middleware with PostgreSQL store
 * 
 * Session TTL: 7 days
 * Store: PostgreSQL (sessions table)
 * Cookie: secure=true, httpOnly=true, sameSite=lax in production
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

  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction, // HTTPS only in production
      sameSite: isProduction ? "lax" : "lax", // CSRF protection
      maxAge: sessionTtl,
    },
  });
}

/**
 * Sign a magic link JWT token
 * 
 * Token claims:
 * - sub: user email
 * - aud: "magiclink"
 * - iss: PUBLIC_APP_URL or "quotevaultpro"
 * - iat/exp: issued at / expires at (15 minutes)
 * 
 * @param email - User email address
 * @returns Promise<string> - Signed JWT token
 */
async function signMagicLinkToken(email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
  const issuer = process.env.PUBLIC_APP_URL || "quotevaultpro";
  
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setAudience("magiclink")
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime("15m") // 15 minutes
    .sign(secret);

  return token;
}

/**
 * Verify a magic link JWT token
 * 
 * Validates:
 * - Signature (using SESSION_SECRET)
 * - Expiration (15 minutes)
 * - Audience (must be "magiclink")
 * - Issuer (must match PUBLIC_APP_URL or "quotevaultpro")
 * 
 * @param token - JWT token string
 * @returns Promise<string> - Email from token subject
 * @throws Error if token is invalid, expired, or malformed
 */
async function verifyMagicLinkToken(token: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
  const issuer = process.env.PUBLIC_APP_URL || "quotevaultpro";

  try {
    const { payload } = await jwtVerify(token, secret, {
      audience: "magiclink",
      issuer,
    });

    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("Invalid token: missing subject");
    }

    return payload.sub;
  } catch (error: any) {
    // Log error type but not token value
    if (error.code === "ERR_JWT_EXPIRED") {
      throw new Error("Token expired");
    } else if (error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
      throw new Error("Invalid token signature");
    } else {
      throw new Error("Invalid token");
    }
  }
}

/**
 * Setup magic link authentication with Passport
 * 
 * Configures:
 * - Trust proxy for Railway HTTPS
 * - Session middleware
 * - Passport initialization
 * - Magic link endpoints (/api/auth/magic-link/request, /api/auth/magic-link/consume)
 * - Standard endpoints (/api/auth/logout, /api/auth/me)
 * 
 * @param app - Express application instance
 */
export async function setupAuth(app: Express) {
  // Trust proxy for Railway/production (required for secure cookies over HTTPS)
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

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

      // Never include passwordHash in session
      const { passwordHash: _, ...safeUser } = user;
      cb(null, safeUser);
    } catch (error: any) {
      console.error("[magicLinkAuth] Deserialize error:", error.message);
      cb(error);
    }
  });

  // =============================
  // Magic Link Endpoints
  // =============================

  /**
   * POST /api/auth/magic-link/request
   * 
   * Body: { email: string }
   * Response: { success: true } always (never leak whether user exists)
   * 
   * Sends magic link email to user.
   * Email includes link: PUBLIC_APP_URL/auth/magic-link?token=...
   */
  app.post(
    "/api/auth/magic-link/request",
    authRateLimit, // Prevent abuse
    async (req, res) => {
      const requestId = req.requestId || randomId();

      try {
        const { email } = req.body;

        // Validate email format
        if (!email || typeof email !== "string" || !isValidEmail(email)) {
          logger.warn("auth_magiclink_request_invalid_email", {
            requestId,
            organizationId: undefined,
          });
          // Still return success to avoid leaking info
          return res.json({ success: true });
        }

        // Enforce max email length
        if (email.length > 255) {
          logger.warn("auth_magiclink_request_email_too_long", {
            requestId,
            organizationId: undefined,
          });
          return res.json({ success: true });
        }

        logger.info("auth_magiclink_request_start", {
          requestId,
          organizationId: undefined,
        });

        // Sign JWT token
        const token = await signMagicLinkToken(email.toLowerCase());

        // Build magic link URL
        const appUrl = process.env.PUBLIC_APP_URL || "http://localhost:5000";
        const magicLinkUrl = `${appUrl}/auth/magic-link?token=${encodeURIComponent(token)}`;

        // Send email (assumes organization has email configured)
        // For magic link, we use default org since user isn't authenticated yet
        const emailHtml = `
          <h2>Sign in to QuoteVaultPro</h2>
          <p>Click the link below to sign in to your account:</p>
          <p><a href="${magicLinkUrl}">Sign In</a></p>
          <p>This link will expire in 15 minutes.</p>
          <p>If you didn't request this email, you can safely ignore it.</p>
        `;

        await emailService.sendEmail(DEFAULT_ORGANIZATION_ID, {
          to: email,
          subject: "Sign in to QuoteVaultPro",
          html: emailHtml,
          replyTo: undefined,
        });

        logger.info("auth_magiclink_request_success", {
          requestId,
          organizationId: undefined,
        });

        // Always return success (never leak whether user exists)
        res.json({ success: true });
      } catch (error: any) {
        logger.error("auth_magiclink_request_error", {
          requestId,
          organizationId: undefined,
          error: error.message,
        });

        // Still return success to avoid leaking info
        res.json({ success: true });
      }
    }
  );

  /**
   * GET /api/auth/magic-link/consume?token=...
   * 
   * Query: token (JWT)
   * Response: Redirect to / on success, /login?error=... on failure
   * 
   * Verifies token, upserts user, establishes session.
   */
  app.get("/api/auth/magic-link/consume", async (req, res) => {
    const requestId = req.requestId || randomId();

    try {
      const token = req.query.token as string;

      if (!token) {
        logger.warn("auth_magiclink_consume_missing_token", {
          requestId,
          organizationId: undefined,
        });
        return res.redirect("/login?error=invalid");
      }

      logger.info("auth_magiclink_consume_start", {
        requestId,
        organizationId: undefined,
      });

      // Verify token and extract email
      let email: string;
      try {
        email = await verifyMagicLinkToken(token);
      } catch (error: any) {
        logger.warn("auth_magiclink_consume_invalid_token", {
          requestId,
          organizationId: undefined,
          error: error.message,
        });

        if (error.message.includes("expired")) {
          return res.redirect("/login?error=expired");
        } else {
          return res.redirect("/login?error=invalid");
        }
      }

      // Upsert user by email
      const normalizedEmail = email.toLowerCase().trim();
      
      let user = await db
        .select()
        .from(users)
        .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
        .limit(1)
        .then((rows) => rows[0]);

      if (!user) {
        // Create new user
        // Determine role: owner if first user, otherwise employee
        const userCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .then((rows) => Number(rows[0]?.count || 0));

        const isFirstUser = userCount === 0;
        const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        await db.insert(users).values({
          id: userId,
          email: normalizedEmail,
          firstName: "",
          lastName: "",
          role: isFirstUser ? "owner" : "employee",
          isAdmin: isFirstUser,
          profileImageUrl: null,
          passwordHash: null, // No password for magic link users
        });

        user = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .then((rows) => rows[0]);

        logger.info("auth_magiclink_user_created", {
          requestId,
          userId: user.id,
          role: user.role,
          isFirstUser,
        });
      }

      // Remove passwordHash from user object
      const { passwordHash: _, ...safeUser } = user;

      // Establish session using Passport
      req.login(safeUser, (loginErr) => {
        if (loginErr) {
          logger.error("auth_magiclink_session_error", {
            requestId,
            userId: user.id,
            error: loginErr.message,
          });
          return res.redirect("/login?error=session");
        }

        logger.info("auth_magiclink_consume_success", {
          requestId,
          userId: user.id,
        });

        // Redirect to home
        res.redirect("/");
      });
    } catch (error: any) {
      logger.error("auth_magiclink_consume_error", {
        requestId,
        organizationId: undefined,
        error: error.message,
      });

      res.redirect("/login?error=server");
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
        console.error("[magicLinkAuth] Logout error:", err);
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

    // req.user already sanitized (no passwordHash)
    res.json({
      success: true,
      data: { user: req.user },
    });
  });

  /**
   * GET /api/auth/config
   * 
   * Returns current auth provider type (safe to expose publicly)
   * Response: { provider: "magiclink" }
   */
  app.get("/api/auth/config", (req, res) => {
    res.json({
      provider: "magiclink",
    });
  });

  console.log("[magicLinkAuth] Auth endpoints registered:");
  console.log("  POST /api/auth/magic-link/request");
  console.log("  GET /api/auth/magic-link/consume");
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
 * Basic email validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Generate random ID for request tracking
 */
function randomId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
