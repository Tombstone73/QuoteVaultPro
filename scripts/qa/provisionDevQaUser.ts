import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
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
    const identity = await tx.execute(sql`select current_database() as database_name, current_user as database_user`);
    if (identity.rows.length !== 1 || identity.rows[0].database_name !== config.databaseName || identity.rows[0].database_user !== config.databaseUser) {
      throw new Error('DEV QA database connection identity does not match the approved connection.');
    }

    const [organization] = await tx
      .select({ id: organizations.id, slug: organizations.slug, type: organizations.type, status: organizations.status, isArchived: organizations.isArchived, deleteState: organizations.deleteState })
      .from(organizations)
      .where(eq(organizations.id, config.organizationId))
      .limit(1);

    if (!organization || organization.slug.toLowerCase() !== config.organizationSlug || organization.type !== 'internal' || organization.status !== 'active' || organization.isArchived || organization.deleteState !== "active") {
      throw new Error("Configured DEV QA organization is missing, inactive, or does not match the expected slug.");
    }

    const matchingUsers = await tx.select().from(users).where(sql`lower(${users.email}) = ${config.email}`).limit(2);
    if (matchingUsers.length > 1) {
      throw new Error('Configured DEV QA email matches multiple identities; refusing to modify them.');
    }
    const [existingUser] = matchingUsers;
    if (existingUser && existingUser.accountType !== "INTERNAL_USER") {
      throw new Error("Configured DEV QA email belongs to a non-internal identity; refusing to modify it.");
    }

    if (existingUser) {
      const [provisioningRecord] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
        eq(auditLogs.organizationId, config.organizationId),
        eq(auditLogs.entityId, existingUser.id),
        eq(auditLogs.entityType, 'user'),
        eq(auditLogs.actionType, 'DEV_QA_USER_CREATED'),
      )).limit(1);
      if (!provisioningRecord || existingUser.firstName !== 'DEV QA' || existingUser.lastName !== 'Browser') {
        throw new Error('Configured DEV QA email belongs to an identity without dedicated QA provenance; refusing to modify it.');
      }
      const identities = await tx.select({ provider: authIdentities.provider }).from(authIdentities).where(eq(authIdentities.userId, existingUser.id));
      if (identities.some((identity) => identity.provider !== 'password')) {
        throw new Error('Configured DEV QA identity has another authentication provider; refusing to modify it.');
      }
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

    const memberships = await tx.select({ organizationId: userOrganizations.organizationId, role: userOrganizations.role })
      .from(userOrganizations).where(eq(userOrganizations.userId, user.id));
    if (memberships.length !== 1 || memberships[0].organizationId !== config.organizationId || memberships[0].role !== ORG_ADMIN_ROLE || user.isPlatformAdmin || user.isPlatformDeveloper) {
      throw new Error('DEV QA account verification failed; transaction rolled back.');
    }

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
    // Database driver errors may contain connection details; only emit our known safe failures.
    const message = error instanceof Error && /^(DEV QA|Configured DEV QA)/.test(error.message)
      ? error.message : "DEV QA provisioning failed; inspect protected Railway diagnostics.";
    console.error(JSON.stringify({ success: false, message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await databaseModule?.pool.end();
  });
