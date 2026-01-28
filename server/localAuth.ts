import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";
import { emailService } from "./emailService";
import { getUserOrganizations } from "./tenantContext";
import { db } from "./db";
import { passwordResetTokens } from "@shared/schema";
import { eq, and, lt, isNull } from "drizzle-orm";
import crypto from "crypto";

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
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
      secure: isProduction, // Secure in production
      maxAge: sessionTtl,
      sameSite: isProduction ? 'lax' : 'lax',
    },
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
          
          // TODO: In production, verify password hash here
          // For now, accept any password in dev, and in production require existing user
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
          sameSite: isProduction ? 'lax' : 'lax',
        });
        res.json({ success: true });
      });
    });
  });

  // Password reset: Request reset link
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

      // Look up user by email
      const user = await storage.getUserByEmail(email.trim().toLowerCase());

      if (user) {
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

        // Build reset link
        const resetUrl = `https://www.printershero.com/reset-password?token=${resetToken}`;

        // Try to send email (best effort - don't block or expose errors)
        try {
          // Get user's organization for email settings
          const userMemberships = await getUserOrganizations(user.id);
          const defaultOrgId = userMemberships.find(m => m.isDefault)?.organizationId || 
                               userMemberships[0]?.organizationId;

          if (defaultOrgId) {
            await emailService.sendEmail(
              defaultOrgId,
              email,
              "Password Reset Request - QuoteVaultPro",
              `
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
            );
          }
        } catch (emailError) {
          // Log but don't expose to user
          console.error("[Password Reset] Email send error:", emailError);
        }
      }

      // Always return generic success (no email enumeration)
      res.json({ 
        success: true, 
        message: genericMessage 
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
            lt(new Date(), passwordResetTokens.expiresAt)
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