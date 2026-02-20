/**
 * orgOnboardingService — creates a new organization + optional owner invite
 * in a single DB transaction.
 *
 * Raw invite token is returned ONCE in the response; only its SHA-256 hash
 * is stored in the database.
 */
import crypto from "crypto";
import { db } from "../db";
import { organizations, orgInvites } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface CreateOrgParams {
  name: string;
  slug: string;
  createdByUserId: string;
  createOwnerInvite: boolean;
  ownerEmail?: string;
}

export interface CreateOrgResult {
  orgId: string;
  inviteToken?: string; // raw token returned once; caller builds the link
  ownerEmail?: string;
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
  const { name, slug, createdByUserId, createOwnerInvite, ownerEmail } = params;

  return await db.transaction(async (tx) => {
    // Insert organization
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
    let inviteToken: string | undefined;

    if (createOwnerInvite && ownerEmail) {
      // Generate cryptographically random 32-byte token (64 hex chars)
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await tx.insert(orgInvites).values({
        orgId,
        email: ownerEmail.trim().toLowerCase(),
        role: "owner",
        tokenHash,
        expiresAt,
        createdByUserId,
      });

      inviteToken = rawToken;
    }

    return {
      orgId,
      inviteToken,
      ownerEmail: createOwnerInvite && ownerEmail ? ownerEmail.trim().toLowerCase() : undefined,
    };
  });
}
