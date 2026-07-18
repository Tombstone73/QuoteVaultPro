import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { authIdentities, organizations, userOrganizations, users } from "@shared/schema";
import { slugify } from "./orgOnboardingService";
import { seedDefaultPillsForOrg } from "./orderStatusPillService";

const bootstrapAdminBodySchemaBase = z.object({
  email: z.string().email("A valid email is required").max(255),
  password: z.string().min(12, "Password must be at least 12 characters").max(256),
  name: z.string().trim().min(1).max(200).optional(),
  orgName: z.string().trim().min(1).max(255).optional(),
  orgSlug: z.string().trim().min(1).max(100).regex(/^[a-z0-9-]+$/, "orgSlug must be lowercase alphanumeric with hyphens").optional(),
});

export const bootstrapAdminBodySchema = bootstrapAdminBodySchemaBase.superRefine((val, ctx) => {
  if (val.orgSlug && !val.orgName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["orgSlug"],
      message: "orgSlug requires orgName",
    });
  }
});

export type BootstrapAdminInput = z.infer<typeof bootstrapAdminBodySchema>;

export type BootstrapAdminResult =
  | {
      status: "already_bootstrapped";
      existingAdminId: string;
    }
  | {
      status: "created";
      userId: string;
      email: string;
      organizationId: string | null;
    };

const BOOTSTRAP_ADVISORY_LOCK_ID = 72051001;

function splitName(fullName?: string): { firstName: string; lastName: string | null } {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) {
    return { firstName: "Platform", lastName: "Admin" };
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export async function bootstrapPlatformAdmin(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const { firstName, lastName } = splitName(input.name);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_ADVISORY_LOCK_ID})`);

    const [existingAdmin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isPlatformAdmin, true))
      .limit(1);

    if (existingAdmin) {
      return {
        status: "already_bootstrapped",
        existingAdminId: existingAdmin.id,
      } as const;
    }

    const passwordHash = await bcrypt.hash(input.password, 12);

    const [createdUser] = await tx
      .insert(users)
      .values({
        email: normalizedEmail,
        firstName,
        lastName,
        role: "owner",
        isAdmin: true,
        isPlatformAdmin: true,
        mustSetPassword: false,
      })
      .returning({ id: users.id });

    if (!createdUser) {
      throw new Error("Failed to create platform admin user");
    }

    await tx
      .insert(authIdentities)
      .values({
        userId: createdUser.id,
        provider: "password",
        passwordHash,
        passwordSetAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [authIdentities.userId, authIdentities.provider],
        set: {
          passwordHash,
          passwordSetAt: new Date(),
          updatedAt: new Date(),
        },
      });

    let organizationId: string | null = null;

    if (input.orgName) {
      const resolvedSlug = (input.orgSlug?.trim() || slugify(input.orgName)).trim();
      if (!resolvedSlug) {
        throw new Error("Could not derive a valid org slug");
      }

      const [org] = await tx
        .insert(organizations)
        .values({
          name: input.orgName.trim(),
          slug: resolvedSlug,
          type: "external_saas",
          status: "active",
        })
        .returning({ id: organizations.id });

      if (!org) {
        throw new Error("Failed to create initial organization");
      }

      organizationId = org.id;
      await seedDefaultPillsForOrg(organizationId, tx);

      await tx
        .insert(userOrganizations)
        .values({
          userId: createdUser.id,
          organizationId,
          role: "owner",
          isDefault: true,
        })
        .onConflictDoNothing();

      await tx
        .update(users)
        .set({ lastActiveOrgId: organizationId, updatedAt: new Date() })
        .where(and(eq(users.id, createdUser.id), eq(users.isPlatformAdmin, true)));
    }

    return {
      status: "created",
      userId: createdUser.id,
      email: normalizedEmail,
      organizationId,
    } as const;
  });
}
