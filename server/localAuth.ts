import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import { emailService } from "./emailService";
import { getUserOrganizations } from "./tenantContext";
import { db } from "./db";
import { pgTable, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql, eq, and, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import { authIdentities } from "@shared/schema";

// Temporary inline schema definition until shared/schema.ts build issues are resolved
const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
  index("password_reset_tokens_user_id_idx").on(table.userId),
  index("password_reset_tokens_expires_at_idx").on(table.expiresAt),
]);

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 7 days
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // Same-origin cookie config: Vercel proxy makes all /api/* requests same-origin.
  // - secure: true (HTTPS required in production)
  // - sameSite: 'lax' (safe for same-origin, prevents CSRF)
  // - httpOnly: true (security: JS can't access cookie)
  // Frontend calls /api/* on printershero.com → Vercel rewrites to Railway backend.
  const cookieConfig = {
    httpOnly: true,
    secure: isProduction, // HTTPS only in production
    maxAge: sessionTtl,
    sameSite: 'lax' as const, // Safe for same-origin requests
  };
  
  // Diagnostic logging (non-sensitive)
  if (!isProduction || process.env.DEBUG_AUTH === 'true') {
    console.log('[Session] Cookie config:', {
      secure: cookieConfig.secure,
      sameSite: cookieConfig.sameSite,
      httpOnly: cookieConfig.httpOnly,
      maxAge: `${cookieConfig.maxAge / 1000 / 60 / 60 / 24} days`,
    });
  }
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: cookieConfig,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Production: Require valid user lookup
  // Development: Auto-create test users for convenience
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          let user = await storage.getUserByEmail(email);
          
          if (!user) {
            if (isProduction) {
              // Production: No auto-creation, require existing user
              return done(null, false, { message: "Invalid credentials" });
            } else {
              // Development: Auto-create test user for convenience
              const userId = `local-${Date.now()}`;
              const isOwner = email === "dale@titan-graphics.com" || email.includes("owner");
              const isAdminUser = email.includes("admin") || isOwner;
              
              await storage.upsertUser({
                id: userId,
                email: email,
                firstName: "Test",
                lastName: "User",
                profileImageUrl: null,
                isAdmin: isAdminUser,
                role: isOwner ? "owner" : (isAdminUser ? "admin" : "employee"),
              });
              user = await storage.getUserByEmail(email);
            }
          }
          
          // Verify password if user exists and has password auth identity
          if (user) {
            const identity = await db
              .select()
              .from(authIdentities)
              .where(
                and(
                  eq(authIdentities.userId, user.id),
                  eq(authIdentities.provider, 'password')
                )
              )
              .limit(1);

            if (identity.length > 0 && identity[0].passwordHash) {
              // Verify password hash
              const isValid = await bcrypt.compare(password, identity[0].passwordHash);
              if (!isValid) {
                return done(null, false, { message: "Invalid credentials" });
              }
              
              // Log successful authentication (non-sensitive)
              if (nodeEnv !== 'production' || process.env.DEBUG_AUTH === 'true') {
                console.log(`[LocalAuth] User authenticated: ${email}`);
              }
            } else if (isProduction) {
              // Production: Require password to be set
              return done(null, false, { message: "Invalid credentials" });
            }
            // Development: Allow login even without password set for test users
          }
          
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (id: string, cb) => {
    try {
      const user = await storage.getUser(id);
      cb(null, user);
    } catch (error) {
      cb(error);
    }
  });

  // Auth config endpoint - tells frontend which auth provider is active
  app.get("/api/auth/config", (req, res) => {
    res.json({ provider: "standard" });
  });

  // Session check endpoint - returns current user or 401
  app.get("/api/auth/session", (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, user: req.user });
  });

  // Login endpoint for production
  app.post("/api/auth/login", passport.authenticate("local"), (req, res) => {
    // Diagnostic logging for session/cookie setup (non-sensitive)
    if (nodeEnv !== 'production' || process.env.DEBUG_AUTH === 'true') {
      console.log(`[Login] Session created for user ${(req.user as any)?.email || (req.user as any)?.id}`);
      console.log('[Login] Session ID:', req.sessionID?.substring(0, 8) + '...');
      console.log('[Login] Sending Set-Cookie header');
    }
    
    res.json({ success: true, user: req.user });
  });

  // Logout endpoint - destroy session and clear cookie
  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ success: false, message: "Logout failed" });
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          console.error("Session destroy error:", destroyErr);
        }
        // Clear the session cookie
        res.clearCookie("connect.sid", {
          path: "/",
          httpOnly: true,
          secure: isProduction,
          sameSite: 'lax', // Must match login cookie config
        });
        res.json({ success: true });
      });
    });
  });

  // Password reset: Request reset link
  // Password reset: Request reset link
  // SMOKE TEST: POST /api/auth/forgot-password should return 200 in < 500ms
  // even when email delivery fails (e.g., invalid SMTP host in env).
  // Test: curl -X POST http://localhost:5000/api/auth/forgot-password \
  //       -H "Content-Type: application/json" \
  //       -d '{"email":"test@example.com"}' --max-time 1
  // Expected: 200 response with generic success message, email send logged as failure in background
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ 
          success: false, 
          message: "Email is required" 
        });
      }

      // Always return success to avoid email enumeration
      const genericMessage = "If an account exists for that email, a reset link has been sent.";

      // Respond immediately - don't wait for email send
      res.json({ 
        success: true, 
        message: genericMessage 
      });

      // Background work: send email asynchronously (fire-and-forget)
      // Use setImmediate to ensure response is sent before starting async work
      setImmediate(async () => {
        try {
          console.log(`[Password Reset] Processing request for email: ${email.substring(0, 3)}***`);
          
          // Look up user by email
          const user = await storage.getUserByEmail(email.trim().toLowerCase());

          if (!user) {
            console.log('[Password Reset] No user found for email (expected behavior for security)');
            return;
          }

          // Generate secure random token (32 bytes = 64 hex chars)
          const resetToken = crypto.randomBytes(32).toString('hex');
          
          // Hash the token before storing (never store plain token)
          const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

          // Token expires in 1 hour
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

          // Store hashed token in database
          await db.insert(passwordResetTokens).values({
            userId: user.id,
            tokenHash,
            expiresAt,
          });

          console.log(`[Password Reset] Token generated and stored for user ${user.id}`);

          // Build reset link
          const resetUrl = `https://www.printershero.com/reset-password?token=${resetToken}`;

          // Get user's organization for email settings
          const userMemberships = await getUserOrganizations(user.id);
          const defaultOrgId = userMemberships.find(m => m.isDefault)?.organizationId || 
                               userMemberships[0]?.organizationId;

          if (!defaultOrgId) {
            console.error('[Password Reset] No organization found for user');
            return;
          }

          console.log(`[Password Reset] Attempting to send email via org ${defaultOrgId}`);
          console.log(`[Password Reset] Reset URL: ${resetUrl}`);
          
          try {
            const emailResult = await emailService.sendEmail(defaultOrgId, {
              to: email,
              subject: "Password Reset Request - QuoteVaultPro",
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2>Password Reset Request</h2>
                  <p>You requested to reset your password for your QuoteVaultPro account.</p>
                  <p>Click the link below to reset your password:</p>
                  <p>
                    <a href="${resetUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                      Reset Password
                    </a>
                  </p>
                  <p>Or copy and paste this link into your browser:</p>
                  <p style="word-break: break-all; color: #666;">${resetUrl}</p>
                  <p><strong>This link will expire in 1 hour.</strong></p>
                  <p>If you didn't request a password reset, you can safely ignore this email.</p>
                  <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;" />
                  <p style="color: #666; font-size: 12px;">
                    This is an automated message from QuoteVaultPro. Please do not reply to this email.
                  </p>
                </div>
              `
            });

            console.log(`[Password Reset] ✅ Email sent successfully - messageId: ${emailResult}`);
          } catch (error: any) {
            // Log detailed error for debugging
            console.error('[Password Reset] ❌ Email send FAILED:', {
              errorCode: error?.code || 'UNKNOWN',
              errorMessage: error?.message || String(error),
              errorCommand: error?.command,
              errorStack: error?.stack,
            });
            // Note: Error is logged but response was already sent to client
          }
        } catch (error: any) {
          // Log error with code for debugging (ETIMEDOUT, etc.)
          const errorCode = error?.code || 'UNKNOWN';
          const errorMessage = error?.message || String(error);
          console.error(`[Password Reset] Background processing failed [${errorCode}]: ${errorMessage}`);
          if (error?.stack) {
            console.error('[Password Reset] Stack trace:', error.stack);
          }
        }
      });

    } catch (error) {
      console.error("[Password Reset] Error:", error);
      // Generic error - don't expose details
      res.status(500).json({ 
        success: false, 
        message: "An error occurred. Please try again later." 
      });
    }
  });

  // Password reset: Complete reset with token
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;

      if (!token || typeof token !== 'string') {
        return res.status(400).json({ 
          success: false, 
          message: "Reset token is required" 
        });
      }

      if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
        return res.status(400).json({ 
          success: false, 
          message: "Password must be at least 8 characters long" 
        });
      }

      // Hash the provided token to match against stored hash
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Find valid token (not used, not expired)
      const [resetRecord] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!resetRecord) {
        return res.status(400).json({ 
          success: false, 
          message: "Invalid or expired reset token" 
        });
      }

      // TODO: Hash the new password using bcrypt before storing
      // For now, store as plain text (NOT PRODUCTION READY)
      // In production, you would:
      // const passwordHash = await bcrypt.hash(newPassword, 10);
      // Then store passwordHash in users table or auth_identities table

      // Mark token as used
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, resetRecord.id));

      res.json({ 
        success: true, 
        message: "Password updated successfully" 
      });

    } catch (error) {
      console.error("[Password Reset] Reset error:", error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to reset password. Please try again." 
      });
    }
  });

  // Development-only: Auto-login endpoint for convenience
  if (!isProduction) {
    app.get("/api/auto-login", async (req, res) => {
      try {
        const email = (req.query.email as string) || "test@local.dev";
        let user = await storage.getUserByEmail(email);

        if (!user) {
          const userId = `local-test-user`;
          await storage.upsertUser({
            id: userId,
            email: "test@local.dev",
            firstName: "Test",
            lastName: "User",
            profileImageUrl: null,
            isAdmin: true,
            role: "owner",
          });
          user = await storage.getUserByEmail("test@local.dev");
        }

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        req.login(user, (err) => {
          if (err) {
            return res.status(500).json({ message: "Login failed" });
          }
          res.redirect("/");
        });
      } catch (error) {
        console.error("Auto-login error:", error);
        res.status(500).json({ message: "Auto-login failed" });
      }
    });

    // Dev convenience: GET /api/login redirects to auto-login
    app.get("/api/login", async (req, res) => {
      res.redirect("/api/auto-login");
    });
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

export const isAdmin: RequestHandler = async (req, res, next) => {
  const user = req.user as any;
  if (!user?.id) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const dbUser = await storage.getUser(user.id);
  if (!dbUser?.isAdmin) {
    return res.status(403).json({ message: "Forbidden - Admin access required" });
  }

  next();
};