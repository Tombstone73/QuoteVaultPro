/**
 * me.ts — /api/me router
 *
 * Routes (authenticated, NOT org-scoped):
 *   GET  /api/me/orgs          — list orgs the user belongs to + lastActiveOrgId
 *   POST /api/me/active-org    — set the user's active org (persists to DB)
 *
 * These endpoints intentionally bypass tenantContext middleware so they
 * work even when no active org has been selected yet.
 */

import { Router } from "express";
import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { users, userOrganizations, organizations } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { writePlatformAuditLog } from "../services/platformAuditLogService";
import { resolveActiveOrganization } from "@shared/activeOrganization";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Handles both Replit (claims.sub) and local (id) auth objects. */
function getUserId(user: any): string | undefined {
  return user?.claims?.sub ?? user?.id;
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const setActiveOrgBodySchema = z.object({
  orgId: z.string().min(1, "orgId is required"),
});

// ─── Route registration ───────────────────────────────────────────────────────

export function registerMeRoutes(app: Express) {
  const router = Router();

  // ── GET /api/me/orgs ────────────────────────────────────────────────────────
  router.get("/orgs", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      // Fetch all org memberships for the user
      const memberships = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          isArchived: organizations.isArchived,
          role: userOrganizations.role,
          isDefault: userOrganizations.isDefault,
        })
        .from(userOrganizations)
        .innerJoin(
          organizations,
          eq(userOrganizations.organizationId, organizations.id)
        )
        .where(and(eq(userOrganizations.userId, userId), eq(organizations.isArchived, false)));

      // Fetch current lastActiveOrgId
      const [userRow] = await db
        .select({ lastActiveOrgId: users.lastActiveOrgId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const activeOrganization = resolveActiveOrganization(memberships, userRow?.lastActiveOrgId);

      return res.json({
        success: true,
        data: {
          orgs: memberships,
          // Return the same effective membership tenantContext will use when a
          // legacy session has not yet persisted an active organization.
          lastActiveOrgId: activeOrganization?.id ?? null,
        },
      });
    } catch (err) {
      console.error("[me/orgs] error:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch organizations." });
    }
  });

  // ── POST /api/me/active-org ─────────────────────────────────────────────────
  router.post("/active-org", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const userId = getUserId(req.user);
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const parsed = setActiveOrgBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request",
      });
    }

    const { orgId } = parsed.data;

    try {
      // Verify user has a membership in this org (don't leak org existence)
      const [membership] = await db
        .select({ role: userOrganizations.role, isArchived: organizations.isArchived })
        .from(userOrganizations)
        .innerJoin(organizations, eq(userOrganizations.organizationId, organizations.id))
        .where(
          and(
            eq(userOrganizations.userId, userId),
            eq(userOrganizations.organizationId, orgId),
            eq(organizations.isArchived, false)
          )
        )
        .limit(1);

      if (!membership) {
        return res.status(404).json({
          success: false,
          message: "Organization not found or you do not have access.",
        });
      }

      // Persist active org choice
      await db
        .update(users)
        .set({ lastActiveOrgId: orgId })
        .where(eq(users.id, userId));

      // Audit log (platform-level — crosses org context)
      await writePlatformAuditLog({
        action: "user.active_org.set",
        actorUserId: userId,
        actorEmail: (req.user as any)?.email ?? "unknown",
        req,
        orgId,
        metadata: { orgId },
      });

      return res.json({
        success: true,
        data: { lastActiveOrgId: orgId },
      });
    } catch (err) {
      console.error("[me/active-org] error:", err);
      return res.status(500).json({ success: false, message: "Failed to update active organization." });
    }
  });

  app.use("/api/me", router);
}
