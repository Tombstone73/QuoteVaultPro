import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";

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
      secure: false, // Set to false for local development
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Simple local strategy - auto-login as test user
  passport.use(
    new LocalStrategy(
      {
        usernameField: "email",
        passwordField: "password",
      },
      async (email, password, done) => {
        try {
          // For local dev, accept any login and create/get user
          let user = await storage.getUserByEmail(email);
          
          if (!user) {
            // Create a test user
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

  // GET endpoint that redirects to auto-login for convenience
  app.get("/api/login", async (req, res) => {
    res.redirect("/api/auto-login");
  });

  // Simple login endpoint for local development
  app.post("/api/login", passport.authenticate("local"), (req, res) => {
    res.json({ success: true, user: req.user });
  });

  // Auto-login endpoint for easy development
  app.get("/api/auto-login", async (req, res) => {
    try {
      // Get email from query parameter, or use default test user
      const email = (req.query.email as string) || "test@local.dev";
      let user = await storage.getUserByEmail(email);

      if (!user) {
        // If user doesn't exist, create a default test user
        const userId = `local-test-user`;
        await storage.upsertUser({
          id: userId,
          email: "test@local.dev",
          firstName: "Test",
          lastName: "User",
          profileImageUrl: null,
          isAdmin: true, // Make test user an admin
          role: "owner", // Make test user an owner for full access
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

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
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

