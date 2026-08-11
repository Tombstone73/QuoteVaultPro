import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { getDevQaProvisioningConfig } from "../../server/lib/devQaProvisioningGuard";
import { auditLogs, authIdentities, organizations, userOrganizations, users } from "../../shared/schema";

const ORG_ADMIN_ROLE = "admin" as const;
let databaseModule: typeof import("../../server/db") | undefined;

async function provision() {
  const config = getDevQaProvisioningConfig();
  const passwordHash = await bcrypt.hash(config.password, 12);
  databaseModule = await import("../../server/db");
  const { db } = databaseModule;

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id, slug: organizations.slug, isArchived: organizations.isArchived, deleteState: organizations.deleteState })
      .from(organizations)
      .where(eq(organizations.id, config.organizationId))
      .limit(1);

    if (!organization || organization.slug.toLowerCase() !== config.organizationSlug || organization.isArchived || organization.deleteState !== "active") {
      throw new Error("Configured DEV QA organization is missing, inactive, or does not match the expected slug.");
    }

    const [existingUser] = await tx.select().from(users).where(eq(users.email, config.email)).limit(1);
    if (existingUser && existingUser.accountType !== "INTERNAL_USER") {
      throw new Error("Configured DEV QA email belongs to a non-internal identity; refusing to modify it.");
    }

    if (existingUser) {
      const otherMembership = await tx
        .select({ organizationId: userOrganizations.organizationId })
        .from(userOrganizations)
        .where(and(eq(userOrganizations.userId, existingUser.id), ne(userOrganizations.organizationId, config.organizationId)))
        .limit(1);
      if (otherMembership.length > 0) {
        throw new Error("Configured DEV QA email already has another organization membership; refusing to modify it.");
      }
    }

    const now = new Date();
    const user = existingUser
      ? (await tx
          .update(users)
          .set({
            firstName: "DEV QA",
            lastName: "Browser",
            role: "admin",
            isAdmin: true,
            isPlatformAdmin: false,
            isPlatformDeveloper: false,
            mustSetPassword: false,
            lastActiveOrgId: config.organizationId,
            updatedAt: now,
          })
          .where(eq(users.id, existingUser.id))
          .returning())[0]
      : (await tx
          .insert(users)
          .values({
            email: config.email,
            firstName: "DEV QA",
            lastName: "Browser",
            role: "admin",
            isAdmin: true,
            isPlatformAdmin: false,
            isPlatformDeveloper: false,
            mustSetPassword: false,
            lastActiveOrgId: config.organizationId,
          })
          .returning())[0];

    await tx
      .insert(authIdentities)
      .values({ userId: user.id, provider: "password", passwordHash, passwordSetAt: now })
      .onConflictDoUpdate({
        target: [authIdentities.userId, authIdentities.provider],
        set: { passwordHash, passwordSetAt: now, updatedAt: now },
      });

    await tx
      .insert(userOrganizations)
      .values({ userId: user.id, organizationId: config.organizationId, role: ORG_ADMIN_ROLE, isDefault: true })
      .onConflictDoUpdate({
        target: [userOrganizations.userId, userOrganizations.organizationId],
        set: { role: ORG_ADMIN_ROLE, isDefault: true, updatedAt: now },
      });

    await tx.insert(auditLogs).values({
      organizationId: config.organizationId,
      userId: user.id,
      userName: "DEV QA provisioner",
      actionType: existingUser ? "DEV_QA_USER_REPAIRED" : "DEV_QA_USER_CREATED",
      entityType: "user",
      entityId: user.id,
      entityName: "Dedicated DEV QA browser user",
      description: "Dedicated DEV QA browser user provisioned through the guarded CLI.",
      newValues: { role: ORG_ADMIN_ROLE, organizationId: config.organizationId, source: "qa:provision-dev-user" },
      ipAddress: "cli",
      userAgent: "qa-provision-dev-user",
    });

    return { created: !existingUser, userId: user.id, organizationId: config.organizationId, role: ORG_ADMIN_ROLE };
  });
}

provision()
  .then((result) => {
    // Deliberately no email, password, hash, connection string, or token output.
    console.log(JSON.stringify({ success: true, ...result }));
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "DEV QA provisioning failed.";
    console.error(JSON.stringify({ success: false, message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await databaseModule?.pool.end();
  });
