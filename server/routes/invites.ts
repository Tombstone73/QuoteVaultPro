/**
 * invites.ts — /api/invites router
 *
 * Routes (ALL PUBLIC — no auth required):
 *   GET  /api/invites/preview?token=...  — validate token state, return metadata
 *   POST /api/invites/accept             — accept invite, create user if needed, login
 *
 * Security model:
 *   - Token is a 32-byte random hex string; only its SHA-256 hash is stored.
 *   - These endpoints are PUBLIC (email link-clicked by new users).
 *   - All error shapes use stable JSON envelopes: { success: false, message, code? }
 *   - Unexpected errors never surface raw DB messages.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db";
import {
  orgInvites,
  organizations,
  users,
  authIdentities,
  userOrganizations,
} from "@shared/schema";
import { eq, isNull } from "drizzle-orm";
import { sha256Hex } from "../lib/tokenHash";
import { writePlatformAuditLog } from "../services/platformAuditLogService";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const previewQuerySchema = z.object({
  token: z.string().min(1, "Token required"),
});

const acceptBodySchema = z.object({
  token: z.string().min(1, "Token required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Valid enum values for userOrganizations.role (must match orgMemberRoleEnum). */
const VALID_ORG_ROLES = ["owner", "admin", "manager", "member"] as const;
type OrgMemberRole = (typeof VALID_ORG_ROLES)[number];

function toOrgRole(role: string): OrgMemberRole {
  return VALID_ORG_ROLES.includes(role as OrgMemberRole)
    ? (role as OrgMemberRole)
    : "member";
}

// ─── Route registration ────────────────────────────────────────────────────────

export function registerInviteRoutes(app: import("express").Express): void {
  const router = Router();

  /**
   * GET /api/invites/preview?token=...
   *
   * Validates token state without consuming/accepting the invite.
   * Returns: { status: 'valid'|'invalid'|'expired'|'used', email?, orgName?, emailAlreadyRegistered? }
   */
  router.get("/preview", async (req: Request, res: Response) => {
    const parse = previewQuerySchema.safeParse(req.query);
    if (!parse.success) {
      return res
        .status(400)
        .json({ success: false, status: "invalid", message: "Token is required." });
    }

    // Fingerprint: first 8 chars of hash — enough to correlate logs without exposing token
    const tokenHash = sha256Hex(parse.data.token);
    const tokenFp = tokenHash.slice(0, 8);
    console.log(`[Invite Preview] token received fingerprint=${tokenFp}`);

    try {
      const [invite] = await db
        .select({
          id: orgInvites.id,
          email: orgInvites.email,
          orgId: orgInvites.orgId,
          expiresAt: orgInvites.expiresAt,
          acceptedAt: orgInvites.acceptedAt,
        })
        .from(orgInvites)
        .where(eq(orgInvites.tokenHash, tokenHash))
        .limit(1);

      if (!invite) {
        console.log(`[Invite Preview] invalid — not found fingerprint=${tokenFp}`);
        return res.status(404).json({
          success: false,
          status: "invalid",
          message: "Invite not found or is invalid.",
        });
      }

      if (invite.acceptedAt) {
        console.log(`[Invite Preview] invalid — already accepted inviteId=${invite.id} fingerprint=${tokenFp}`);
        return res.status(409).json({
          success: false,
          status: "used",
          message: "This invite has already been accepted.",
        });
      }

      if (new Date(invite.expiresAt) < new Date()) {
        console.log(`[Invite Preview] invalid — expired inviteId=${invite.id} expiresAt=${invite.expiresAt} fingerprint=${tokenFp}`);
        return res.status(410).json({
          success: false,
          status: "expired",
          message: "This invite has expired. Please ask your administrator for a new one.",
        });
      }

      // Fetch org name for display
      const [org] = await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, invite.orgId))
        .limit(1);

      // Check if this email is already registered
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, invite.email))
        .limit(1);

      console.log(`[Invite Preview] valid inviteId=${invite.id} orgId=${invite.orgId} emailAlreadyRegistered=${!!existingUser} fingerprint=${tokenFp}`);
      return res.json({
        success: true,
        status: "valid",
        email: invite.email,
        orgName: org?.name ?? invite.orgId,
        orgId: invite.orgId,
        emailAlreadyRegistered: !!existingUser,
        expiresAt: invite.expiresAt,
      });
    } catch (err) {
      console.error("[invites/preview] error:", err);
      return res.status(500).json({
        success: false,
        status: "error",
        message: "Failed to validate invite. Please try again.",
      });
    }
  });

  /**
   * POST /api/invites/accept
   * Body: { token: string, password?: string }
   *
   * Flow:
   *  1. Validate token → 404/409/410 for invalid/used/expired
   *  2. If user with invite.email exists: use it
   *     Else: require password → create user + auth identity
   *  3. Upsert org membership (idempotent)
   *  4. Mark invite accepted_at = now
   *  5. req.login → session cookie set
   *  6. Audit log
   */
  router.post("/accept", async (req: Request, res: Response) => {
    const parse = acceptBodySchema.safeParse(req.body);
    if (!parse.success) {
      return res
        .status(400)
        .json({ success: false, message: parse.error.issues[0].message });
    }

    const { token, password } = parse.data;
    const tokenHash = sha256Hex(token);
    const tokenFp = tokenHash.slice(0, 8);
    console.log(`[Invite Accept] token received fingerprint=${tokenFp}`);

    // ── Validate invite ───────────────────────────────────────────────────────
    let invite: typeof orgInvites.$inferSelect;

    try {
      const rows = await db
        .select()
        .from(orgInvites)
        .where(eq(orgInvites.tokenHash, tokenHash))
        .limit(1);

      if (!rows[0]) {
        console.log(`[Invite Accept] invalid — not found fingerprint=${tokenFp}`);
        return res
          .status(404)
          .json({ success: false, message: "Invite not found or is invalid." });
      }
      invite = rows[0];
    } catch (err) {
      console.error("[Invite Accept] lookup error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Failed to accept invite. Please try again." });
    }

    if (invite.acceptedAt) {
      console.log(`[Invite Accept] invalid — already accepted inviteId=${invite.id} fingerprint=${tokenFp}`);
      return res
        .status(409)
        .json({ success: false, message: "This invite has already been accepted." });
    }

    if (new Date(invite.expiresAt) < new Date()) {
      console.log(`[Invite Accept] invalid — expired inviteId=${invite.id} fingerprint=${tokenFp}`);
      return res
        .status(410)
        .json({
          success: false,
          message: "This invite has expired. Please ask your administrator for a new one.",
        });
    }

    console.log(`[Invite Accept] token valid inviteId=${invite.id} orgId=${invite.orgId} fingerprint=${tokenFp}`);

    const { orgId, email, role: inviteRole } = invite;
    let userId: string;
    let createdUser = false;

    // ── Resolve or create user ────────────────────────────────────────────────
    try {
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        userId = existingUser.id;
        console.log(`[Invite Accept] user resolved — existing userId=${userId} fingerprint=${tokenFp}`);
      } else {
        // New user — password required
        if (!password) {
          console.log(`[Invite Accept] failed — password required for new user email (masked) fingerprint=${tokenFp}`);
          return res.status(400).json({
            success: false,
            code: "PASSWORD_REQUIRED",
            message: "Please set a password for your new account.",
            email,
          });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const isOwner = inviteRole === "owner";

        const [newUser] = await db
          .insert(users)
          .values({
            email,
            role: isOwner ? "owner" : "employee",
            isAdmin: isOwner,
            firstName: null,
            lastName: null,
          })
          .returning({ id: users.id });

        if (!newUser) throw new Error("Failed to create user record");

        userId = newUser.id;
        createdUser = true;
        console.log(`[Invite Accept] user created userId=${userId} fingerprint=${tokenFp}`);

        // Create auth identity — passwordSetAt=now() means permanent, not forced-change
        await db.insert(authIdentities).values({
          userId,
          provider: "password",
          passwordHash,
          passwordSetAt: new Date(), // explicit set — not a temp/forced password
        });
        console.log(`[Invite Accept] password setup completed userId=${userId} fingerprint=${tokenFp}`);
      }
    } catch (err: any) {
      console.error(`[Invite Accept] failed — user resolution error fingerprint=${tokenFp}:`, err);
      await writePlatformAuditLog({
        action: "org.invite.accept.failed",
        actorEmail: email,
        req,
        orgId,
        metadata: { error: "user_resolution_failed", message: String(err?.message ?? err) },
      });
      return res
        .status(500)
        .json({ success: false, message: "Failed to accept invite. Please try again." });
    }

    // ── Upsert org membership ─────────────────────────────────────────────────
    try {
      const orgRole = toOrgRole(inviteRole ?? "member");

      await db
        .insert(userOrganizations)
        .values({
          userId,
          organizationId: orgId,
          role: orgRole,
          isDefault: false,
        })
        .onConflictDoNothing();
    } catch (err: any) {
      console.error("[invites/accept] membership upsert error:", err);
      await writePlatformAuditLog({
        action: "org.invite.accept.failed",
        actorUserId: userId,
        actorEmail: email,
        req,
        orgId,
        metadata: { error: "membership_failed", message: String(err?.message ?? err) },
      });
      return res
        .status(500)
        .json({ success: false, message: "Failed to create org membership. Please try again." });
    }

    // ── Mark invite accepted ──────────────────────────────────────────────────
    try {
      await db
        .update(orgInvites)
        .set({ acceptedAt: new Date() })
        .where(eq(orgInvites.id, invite.id));
    } catch (err) {
      // Non-fatal: membership already created; log and continue
      console.error("[invites/accept] mark accepted error:", err);
    }
    // ── Persist active org: set users.last_active_org_id to the invited org ────────
    try {
      await db
        .update(users)
        .set({ lastActiveOrgId: orgId })
        .where(eq(users.id, userId));
    } catch (err) {
      // Non-fatal: tenant context will re-resolve on next request
      console.error("[invites/accept] set lastActiveOrgId error:", err);
    }
    // ── Audit log ─────────────────────────────────────────────────────────────
    await writePlatformAuditLog({
      action: "org.invite.accept",
      actorUserId: userId,
      actorEmail: email,
      req,
      orgId,
      metadata: { orgId, inviteId: invite.id, email, userId, createdUser },
    });

    // ── Auto-login: set session cookie ────────────────────────────────────────
    try {
      const [fullUser] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (fullUser) {
        await new Promise<void>((resolve, reject) => {
          req.login(fullUser, (err) => (err ? reject(err) : resolve()));
        });
      }
    } catch (err) {
      // Non-fatal: user must log in manually if this fails
      console.error("[invites/accept] auto-login failed:", err);
    }

    console.log(`[Invite Accept] completed — userId=${userId} orgId=${orgId} createdUser=${createdUser} fingerprint=${tokenFp}`);
    return res.json({
      success: true,
      data: { orgId, userId, email },
    });
  });

  app.use("/api/invites", router);
}
