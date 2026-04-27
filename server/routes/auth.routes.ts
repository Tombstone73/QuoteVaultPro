/**
 * auth.routes.ts
 *
 * Auth route handlers extracted from server/routes.ts.
 *
 * Routes:
 *   GET  /api/auth/user
 *   POST /api/auth/set-password
 *
 * Placement: server/routes/auth.routes.ts
 * Registered by: server/routes.ts via registerAuthRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { authIdentities, users } from "@shared/schema";
import { storage } from "../storage";

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerAuthRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
  },
): void {
  const { isAuthenticated } = middleware;

  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      // Diagnostic logging for session verification (non-sensitive)
      if (process.env.NODE_ENV !== 'production' || process.env.DEBUG_AUTH === 'true') {
        console.log('[Auth /api/auth/user] Session ID exists:', !!req.sessionID);
        console.log('[Auth /api/auth/user] User authenticated:', !!req.user);
        console.log('[Auth /api/auth/user] Cookie header present:', !!req.headers.cookie);
      }

      const userId = getUserId(req.user);
      const user = await storage.getUser(userId!);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Set new password (forced password change on first login)
  app.post("/api/auth/set-password", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req.user);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const schema = z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(10, "New password must be at least 10 characters"),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: fromZodError(parsed.error).toString() });
      }

      const { currentPassword, newPassword } = parsed.data;

      // Verify current password
      const [identity] = await db
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.userId, userId),
            eq(authIdentities.provider, 'password')
          )
        )
        .limit(1);

      if (!identity || !identity.passwordHash) {
        return res.status(400).json({ message: "No password authentication method found" });
      }

      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(currentPassword, identity.passwordHash);

      if (!isValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password hash
      await db
        .update(authIdentities)
        .set({
          passwordHash: newPasswordHash,
          passwordSetAt: new Date(),
        })
        .where(eq(authIdentities.id, identity.id));

      // Clear mustSetPassword flag
      await db
        .update(users)
        .set({ mustSetPassword: false })
        .where(eq(users.id, userId));

      console.log(`[Set Password] User ${userId} successfully set new password`);

      res.json({
        success: true,
        message: "Password updated successfully"
      });
    } catch (error) {
      console.error("Error setting password:", error);
      res.status(500).json({ message: "Failed to update password" });
    }
  });
}
