/**
 * Standard Authentication Provider (AUTH_PROVIDER=standard)
 * 
 * Production-ready email/password authentication for Railway deployment.
 * Uses Passport LocalStrategy with bcrypt password verification and PostgreSQL session store.
 * 
 * Features:
 * - Email/password login with bcrypt verification
 * - Session-based authentication (PostgreSQL store)
 * - Multi-tenant user resolution via userOrganizations table
 * - Secure cookie configuration for HTTPS (Railway/production)
 * - Case-insensitive email lookup
 * - Role-based access control middleware
 * 
 * Auth endpoints:
 * - POST /api/auth/login - Login with email/password
 * - POST /api/auth/logout - Clear session
 * - GET /api/auth/me - Get current user
 * 
 * SECURITY: Never expose passwordHash in responses. Never log passwords.
 */

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import { db } from "../db";
import { users, userOrganizations, authIdentities } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { verifyPassword } from "./passwordUtils";
import { authRateLimit } from "../middleware/rateLimiting";
import { requestPasswordReset, resetPasswordWithToken } from "./passwordResetService";
import { validatePasswordStrength } from "./passwordUtils";

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
 * Setup standard authentication with Passport LocalStrategy
 * 
 * Configures:
 * - Trust proxy for Railway HTTPS
 * - Session middleware
 * - Passport initialization
 * - LocalStrategy with email/password verification
 * - Auth endpoints (/api/auth/login, /api/auth/logout, /api/auth/me)
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

  // Passport LocalStrategy: email/password authentication
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          // Case-insensitive email lookup
          const result = await db
            .select()
            .from(users)
            .where(sql`LOWER(${users.email}) = LOWER(${email})`)
            .limit(1);

          const user = result[0];

          if (!user) {
            // Don't leak whether email exists
            return done(null, false, { message: "Invalid email or password" });
          }

          // Check if user has at least one org membership (multi-tenant safety)
          const memberships = await db
            .select()
            .from(userOrganizations)
            .where(eq(userOrganizations.userId, user.id))
            .limit(1);

          if (memberships.length === 0) {
            return done(null, false, {
              message: "User has no organization memberships. Please contact support.",
            });
          }

          // Lookup password identity in auth_identities
          const identityResult = await db
            .select()
            .from(authIdentities)
            .where(
              and(
                eq(authIdentities.userId, user.id),
                eq(authIdentities.provider, 'password')
              )
            )
            .limit(1);

          const passwordIdentity = identityResult[0];

          if (!passwordIdentity || !passwordIdentity.passwordHash) {
            return done(null, false, {
              message: "Password not set. Use 'Forgot password' to set it.",
            });
          }

          // Verify password with bcrypt
          const isValidPassword = await verifyPassword(password, passwordIdentity.passwordHash);

          if (!isValidPassword) {
            return done(null, false, { message: "Invalid email or password" });
          }

          // Password verified successfully - return user profile
          return done(null, user);
        } catch (error: any) {
          console.error("[standardAuth] Login error:", error.message);
          return done(error);
        }
      }
    )
  );

  // Passport serialize/deserialize
  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const user = result[0];

      if (!user) {
        return cb(new Error("User not found"));
      }

      // Return user profile (no sensitive fields in users table)
      cb(null, user);
    } catch (error: any) {
      console.error("[standardAuth] Deserialize error:", error.message);
      cb(error);
    }
  });

  // Auth endpoints

  /**
   * POST /api/auth/login
   * 
   * Body: { email: string, password: string }
   * Response: { success: true, data: { user } } or { success: false, message: string }
   */
  app.post(
    "/api/auth/login",
    authRateLimit, // Prevent brute force attacks
    (req, res, next) => {
      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          console.error("[standardAuth] Login error:", err.message);
          return res.status(500).json({
            success: false,
            message: "Login failed due to server error",
          });
        }

        if (!user) {
          return res.status(401).json({
            success: false,
            message: info?.message || "Invalid credentials",
          });
        }

        // Establish session
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error("[standardAuth] Session error:", loginErr.message);
            return res.status(500).json({
              success: false,
              message: "Failed to establish session",
            });
          }

          // Success: return user without passwordHash
          res.json({
            success: true,
            data: { user },
          });
        });
      })(req, res, next);
    }
  );

  /**
   * POST /api/auth/logout
   * 
   * Response: { success: true }
   */
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        console.error("[standardAuth] Logout error:", err);
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
   * Response: { provider: "standard" }
   */
  app.get("/api/auth/config", (req, res) => {
    res.json({
      provider: "standard",
    });
  });

  /**
   * POST /api/auth/forgot-password
   * 
   * Request password reset email
   * Body: { email: string }
   * Response: { success: true, message: string }
   * 
   * SECURITY: Always returns success to prevent email enumeration
   */
  app.post("/api/auth/forgot-password", authRateLimit, async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Always returns success (no enumeration)
    await requestPasswordReset(email);

    res.json({
      success: true,
      message: "If an account exists with that email, a password reset link has been sent.",
    });
  });

  /**
   * POST /api/auth/reset-password
   * 
   * Reset password using token from email
   * Body: { token: string, newPassword: string }
   * Response: { success: true } or { success: false, message: string }
   * 
   * OPTIONAL: Auto-login user after successful reset
   */
  app.post("/api/auth/reset-password", authRateLimit, async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Reset token is required",
      });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({
        success: false,
        message: "New password is required",
      });
    }

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.message,
      });
    }

    // Reset password
    const result = await resetPasswordWithToken(token, newPassword);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to reset password",
      });
    }

    // Auto-login user after successful reset (optional but recommended UX)
    if (result.userId) {
      try {
        const userResult = await db
          .select()
          .from(users)
          .where(eq(users.id, result.userId))
          .limit(1);

        const user = userResult[0];

        if (user) {
          // Create session
          const { passwordHash: _, ...safeUser } = user;
          
          await new Promise<void>((resolve, reject) => {
            req.login(safeUser, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          return res.json({
            success: true,
            message: "Password reset successfully. You are now logged in.",
            data: { user: safeUser },
          });
        }
      } catch (loginError: any) {
        console.error("[standardAuth] Auto-login after reset failed:", loginError.message);
        // Still return success for password reset (login can be done manually)
      }
    }

    res.json({
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    });
  });

  console.log("[standardAuth] Auth endpoints registered:");
  console.log("  POST /api/auth/login");
  console.log("  POST /api/auth/logout");
  console.log("  GET /api/auth/me");
  console.log("  GET /api/auth/config");
  console.log("  POST /api/auth/forgot-password");
  console.log("  POST /api/auth/reset-password");
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

/**
 * Helper: Get user's default organization
 * 
 * Queries userOrganizations table to find user's default org.
 * Falls back to DEFAULT_ORGANIZATION_ID if no membership found.
 * 
 * @param userId - User ID
 * @returns Promise<string> - Organization ID
 */
export async function getUserDefaultOrganization(userId: string): Promise<string> {
  try {
    const result = await db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.userId, userId))
      .orderBy(sql`${userOrganizations.isDefault} DESC, ${userOrganizations.createdAt} ASC`)
      .limit(1);

    if (result.length > 0) {
      return result[0].organizationId;
    }

    // Fallback to default org
    return DEFAULT_ORGANIZATION_ID;
  } catch (error: any) {
    console.error("[standardAuth] Error getting default org:", error.message);
    return DEFAULT_ORGANIZATION_ID;
  }
}
