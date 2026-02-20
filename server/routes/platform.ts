/**
 * platform.ts — /api/platform router
 *
 * Routes:
 *   POST /api/platform/reauth      — step-up password re-entry (any logged-in user)
 *   POST /api/platform/orgs        — create org (platform-admin only + step-up required)
 *
 * Authorization model:
 *   - requirePlatformAdminOr404: unauthenticated OR non-platform-admin → 404
 *   - requireStepUp: allows if (a) session.platformReauthAt within 10 min
 *                          OR (b) user.lastLoginAt within 15 min
 *     If not satisfied → 401 { success:false, code:'STEP_UP_REQUIRED' }
 *     This middleware only runs AFTER requirePlatformAdminOr404, so non-admins
 *     never see step-up errors.
 */

import { Router, type RequestHandler } from "express";
import type { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db";
import { authIdentities, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { writePlatformAuditLog } from "../services/platformAuditLogService";
import { createOrgWithInvite, slugify } from "../services/orgOnboardingService";

// ─── Session type augmentation ────────────────────────────────────────────────
declare module "express-session" {
  interface SessionData {
    platformReauthAt?: number; // Date.now() timestamp, ms
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Handles both Replit (claims.sub) and local (id) auth user objects. */
function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

/** Base URL for invite links: prefer APP_URL env var, then fall back to request origin. */
function getBaseUrl(req: Request): string {
  return (process.env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

// ─── Middleware: requirePlatformAdminOr404 ────────────────────────────────────
/**
 * Returns 404 for unauthenticated requests AND for authenticated non-platform-admins.
 * This way the route's existence is never revealed to non-admins.
 */
const requirePlatformAdminOr404: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(404).json({ message: "Not Found" });
  }

  const userId = getUserId(req.user);
  if (!userId) {
    return res.status(404).json({ message: "Not Found" });
  }

  // Fetch fresh from DB to prevent session-cached stale value
  const [dbUser] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!dbUser?.isPlatformAdmin) {
    return res.status(404).json({ message: "Not Found" });
  }

  next();
};

// ─── Middleware: requireStepUp ────────────────────────────────────────────────
const REAUTH_WINDOW_MS = 10 * 60 * 1000;   // 10 minutes
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;   // 15 minutes

const requireStepUp: RequestHandler = async (req, res, next) => {
  const now = Date.now();

  // (a) Recent explicit re-auth via /api/platform/reauth
  const reauthAt = req.session.platformReauthAt;
  if (reauthAt && now - reauthAt < REAUTH_WINDOW_MS) {
    return next();
  }

  // (b) Recent login within 15 minutes based on user.lastLoginAt
  const userId = getUserId(req.user);
  if (userId) {
    const [dbUser] = await db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (dbUser?.lastLoginAt) {
      const loginAge = now - new Date(dbUser.lastLoginAt).getTime();
      if (loginAge < LOGIN_WINDOW_MS) {
        return next();
      }
    }
  }

  return res.status(401).json({ success: false, code: "STEP_UP_REQUIRED" });
};

// ─── Rate limiter: 5 org creations per hour per IP ───────────────────────────
const orgCreateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combine IP + userId for per-user limiting where possible
    const ip = req.ip ?? "unknown";
    const userId = getUserId(req.user) ?? "anon";
    return `${ip}:${userId}`;
  },
  message: { success: false, message: "Too many organization creation requests. Try again later." },
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const reauthBodySchema = z.object({
  password: z.string().min(1, "Password required"),
});

const createOrgBodySchema = z.object({
  name: z.string().min(1, "Org name required").max(255),
  slug: z.string().max(100).regex(/^[a-z0-9-]*$/, "Slug must be lowercase alphanumeric with hyphens").optional(),
  createOwnerInvite: z.boolean().default(false),
  ownerEmail: z.string().email().optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────
export function registerPlatformRoutes(app: import("express").Express): void {
  const router = Router();

  /**
   * POST /api/platform/reauth
   * Any authenticated user (not admin-gated) — for step-up upgrade.
   */
  router.post("/reauth", async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const parse = reauthBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ success: false, message: parse.error.issues[0].message });
    }

    const { password } = parse.data;
    const userId = getUserId(req.user);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // Look up auth identity
    const [identity] = await db
      .select()
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, "password")))
      .limit(1);

    const actorEmail = (req.user as any)?.email ?? "unknown";

    if (!identity?.passwordHash) {
      await writePlatformAuditLog({
        action: "platform.reauth",
        actorUserId: userId,
        actorEmail,
        req,
        metadata: { ok: false, reason: "no_password_identity" },
      });
      return res.status(401).json({ success: false });
    }

    const isValid = await bcrypt.compare(password, identity.passwordHash);

    await writePlatformAuditLog({
      action: "platform.reauth",
      actorUserId: userId,
      actorEmail,
      req,
      metadata: { ok: isValid },
    });

    if (!isValid) {
      return res.status(401).json({ success: false });
    }

    req.session.platformReauthAt = Date.now();
    return res.json({ success: true });
  });

  /**
   * POST /api/platform/orgs
   * Platform-admin only + step-up required.
   */
  router.post(
    "/orgs",
    requirePlatformAdminOr404,
    requireStepUp,
    orgCreateRateLimit,
    async (req: Request, res: Response) => {
      const parse = createOrgBodySchema.safeParse(req.body);
      if (!parse.success) {
        return res.status(400).json({ success: false, message: parse.error.issues[0].message });
      }

      const { name, slug: rawSlug, createOwnerInvite, ownerEmail } = parse.data;
      const resolvedSlug = (rawSlug && rawSlug.trim()) ? rawSlug.trim() : slugify(name);

      if (!resolvedSlug) {
        return res.status(400).json({ success: false, message: "Could not derive a valid slug from org name." });
      }

      const userId = getUserId(req.user)!;
      const actorEmail = (req.user as any)?.email ?? "unknown";

      try {
        const result = await createOrgWithInvite({
          name,
          slug: resolvedSlug,
          createdByUserId: userId,
          createOwnerInvite: !!(createOwnerInvite && ownerEmail),
          ownerEmail,
        });

        // Build invite link if token was created
        let inviteLink: string | undefined;
        if (result.inviteToken) {
          inviteLink = `${getBaseUrl(req)}/accept-invite?token=${result.inviteToken}`;
        }

        await writePlatformAuditLog({
          action: "org.create",
          actorUserId: userId,
          actorEmail,
          req,
          orgId: result.orgId,
          metadata: {
            orgId: result.orgId,
            name,
            slug: resolvedSlug,
            createdOwnerInvite: !!(createOwnerInvite && ownerEmail),
            ownerEmail: ownerEmail ?? null,
          },
        });

        return res.status(201).json({
          success: true,
          data: {
            orgId: result.orgId,
            inviteLink,
            ownerEmail: result.ownerEmail,
          },
        });
      } catch (err: any) {
        // Unique constraint on slug → user-friendly error
        if (err?.message?.includes("unique") || err?.code === "23505") {
          return res.status(409).json({ success: false, message: "An organization with that slug already exists." });
        }
        console.error("[platform/orgs] create error:", err);
        return res.status(500).json({ success: false, message: "Failed to create organization." });
      }
    }
  );

  app.use("/api/platform", router);
}
