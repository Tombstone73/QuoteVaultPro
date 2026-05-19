/**
 * requireDeveloperAccess.ts
 *
 * Middleware that restricts a route to users who have the platform-level
 * developer flag set (users.is_platform_developer = true).
 *
 * Key properties:
 *   - Requires an authenticated session (isAuthenticated must run first).
 *   - Reads `is_platform_developer` fresh from the DB on every request to
 *     prevent stale session values from granting or denying access.
 *   - Being a tenant owner or admin does NOT grant access — the flag must
 *     be explicitly set on the users row.
 *   - Returns 403 with the standard { message } shape used by other RBAC
 *     middleware in this codebase.
 *
 * Granting access in development (one-time SQL — see README or docs):
 *   UPDATE users SET is_platform_developer = true WHERE email = 'you@example.com';
 *
 * Usage in a route file:
 *   import { requireDeveloperAccess } from '../middleware/requireDeveloperAccess';
 *   app.get('/api/some/debug/route', isAuthenticated, requireDeveloperAccess, handler);
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

/** Handles both Replit (claims.sub) and local (id) user objects. */
function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

/**
 * Express middleware: allows only users with `is_platform_developer = true`.
 * Must be placed after `isAuthenticated` in the middleware chain.
 */
export const requireDeveloperAccess = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const userId = getUserId((req as any).user);

  if (!userId) {
    res.status(403).json({ message: "Access denied. Platform developer access required." });
    return;
  }

  try {
    // Always read from DB — never trust the session-cached user object for
    // privilege-sensitive checks (prevents stale-grant or stale-deny bugs).
    const [dbUser] = await db
      .select({ isPlatformDeveloper: users.isPlatformDeveloper })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!dbUser?.isPlatformDeveloper) {
      res.status(403).json({ message: "Access denied. Platform developer access required." });
      return;
    }

    next();
  } catch (error) {
    console.error("[requireDeveloperAccess] DB lookup failed:", {
      userId,
      message: (error as any)?.message || String(error),
    });
    res.status(500).json({ message: "Failed to verify developer access." });
  }
};
