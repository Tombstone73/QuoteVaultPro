import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";

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