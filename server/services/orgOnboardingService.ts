/**
 * orgOnboardingService — creates a new organization + required owner invite
 * in a single DB transaction.
 *
 * OwnerEmail is ALWAYS required. An invite is ALWAYS created alongside the org.
 * Raw invite token is returned ONCE in the response; only its SHA-256 hash is stored.
 */
import crypto from "crypto";
import { db } from "../db";
import { organizations, orgInvites } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { sha256Hex } from "../lib/tokenHash";
import { assertProductionMapReady, ensureProductionMapForOrg } from "./productionMapService";
import { seedDefaultPillsForOrg } from "./orderStatusPillService";

export interface CreateOrgParams {
  name: string;
  slug: string;
  createdByUserId: string;
  ownerEmail: string; // always required; invite is always created
}

export interface CreateOrgResult {
  orgId: string;
  slug: string;
  inviteToken: string; // raw token returned once; caller builds the invite link
  ownerEmail: string;
}

/**
 * Error thrown when a duplicate unaccepted invite exists for (org_id, email).
 * Should result in 409 Conflict at the route layer.
 */
export class DuplicateInviteError extends Error {
  constructor(orgId: string, email: string) {
    super(`An unaccepted invite for ${email} in org ${orgId} already exists.`);
    this.name = "DuplicateInviteError";
  }
}

/** Slugify a string: lowercase, spaces → hyphens, strip non-alphanumeric. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function createOrgWithInvite(params: CreateOrgParams): Promise<CreateOrgResult> {
  const { name, slug, createdByUserId, ownerEmail } = params;
  const normalizedEmail = ownerEmail.trim().toLowerCase();

  return await db.transaction(async (tx) => {
    // ── 1. Insert organization ──────────────────────────────────────────────
    const [org] = await tx
      .insert(organizations)
      .values({
        name: name.trim(),
        slug: slug.trim(),
        type: "external_saas",
        status: "active",
      })
      .returning({ id: organizations.id });

    if (!org) throw new Error("Failed to create organization");

    const orgId = org.id;

    // A tenant is not operational until its canonical production map exists.
    // Use the same transaction so a failed bootstrap cannot leave an orphan org.
    assertProductionMapReady(await ensureProductionMapForOrg(orgId, tx));
    await seedDefaultPillsForOrg(orgId, tx);

    // ── 2. Guard duplicate unaccepted invite (mirrors partial UNIQUE index) ─
    // The DB index (org_id, email) WHERE accepted_at IS NULL will also enforce
    // this, but we pre-check to produce a structured error rather than a raw PG error.
    const [existing] = await tx
      .select({ id: orgInvites.id })
      .from(orgInvites)
      .where(
        and(
          eq(orgInvites.orgId, orgId),
          eq(orgInvites.email, normalizedEmail),
          isNull(orgInvites.acceptedAt)
        )
      )
      .limit(1);

    if (existing) {
      throw new DuplicateInviteError(orgId, normalizedEmail);
    }

    // ── 3. Generate token + insert invite ───────────────────────────────────
    const rawToken = crypto.randomBytes(32).toString("hex"); // 64 hex chars
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await tx.insert(orgInvites).values({
      orgId,
      email: normalizedEmail,
      role: "owner",
      tokenHash,
      expiresAt,
      createdByUserId,
    });

    return {
      orgId,
      slug: slug.trim(),
      inviteToken: rawToken,
      ownerEmail: normalizedEmail,
    };
  });
}
