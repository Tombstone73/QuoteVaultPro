import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
import { getDevQaMutationProvisioningConfig } from "../../server/lib/devQaProvisioningGuard";
import { devQaMutationProvisioningPlan } from "../../server/lib/devQaMutationProvisioning";
import { auditLogs, authIdentities, organizations, userOrganizations, users } from "../../shared/schema";

let databaseModule: typeof import("../../server/db") | undefined;

async function provision() {
  const config = getDevQaMutationProvisioningConfig();
  const plan = devQaMutationProvisioningPlan(config);
  const passwordHash = await bcrypt.hash(config.mutationPassword, 12);
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

    const [existingUser] = await tx.select().from(users).where(eq(users.email, plan.account.email)).limit(1);
    if (existingUser && existingUser.accountType !== "INTERNAL_USER") {
      throw new Error("Configured DEV QA mutation email belongs to a non-internal identity; refusing to modify it.");
    }
    if (existingUser) {
      const otherMembership = await tx
        .select({ organizationId: userOrganizations.organizationId })
        .from(userOrganizations)
        .where(and(eq(userOrganizations.userId, existingUser.id), ne(userOrganizations.organizationId, config.organizationId)))
        .limit(1);
      if (otherMembership.length > 0) throw new Error("Configured DEV QA mutation identity already has another organization membership; refusing to modify it.");
    }

    const now = new Date();
    const user = existingUser
      ? (await tx.update(users).set({ firstName: plan.account.firstName, lastName: plan.account.lastName, role: plan.account.role, isAdmin: plan.account.isAdmin, isPlatformAdmin: false, isPlatformDeveloper: false, mustSetPassword: false, lastActiveOrgId: config.organizationId, updatedAt: now }).where(eq(users.id, existingUser.id)).returning())[0]
      : (await tx.insert(users).values({ email: plan.account.email, firstName: plan.account.firstName, lastName: plan.account.lastName, role: plan.account.role, isAdmin: plan.account.isAdmin, isPlatformAdmin: false, isPlatformDeveloper: false, mustSetPassword: false, lastActiveOrgId: config.organizationId }).returning())[0];
    if (!user) throw new Error("DEV QA mutation identity could not be created.");

    await tx.insert(authIdentities).values({ userId: user.id, provider: "password", passwordHash, passwordSetAt: now }).onConflictDoUpdate({ target: [authIdentities.userId, authIdentities.provider], set: { passwordHash, passwordSetAt: now, updatedAt: now } });
    await tx.insert(userOrganizations).values({ userId: user.id, organizationId: config.organizationId, role: plan.membership.role, isDefault: true }).onConflictDoUpdate({ target: [userOrganizations.userId, userOrganizations.organizationId], set: { role: plan.membership.role, isDefault: true, updatedAt: now } });
    // `is_active` predates the shared Drizzle projection but remains a hard
    // V2 permission-assignment invariant. Converge a pre-existing, inactive
    // membership rather than creating an assignment that cannot authorize.
    await tx.execute(sql`UPDATE user_organizations SET is_active=true,updated_at=${now} WHERE user_id=${user.id} AND organization_id=${config.organizationId}`);

    await tx.execute(sql`INSERT INTO v2_permission_organization_state(organization_id) VALUES(${config.organizationId}) ON CONFLICT DO NOTHING`);
    const existingSet = await tx.execute<{ id: string; source_template_key: string | null; principal_kind: string }>(sql`SELECT id,source_template_key,principal_kind FROM v2_permission_sets WHERE organization_id=${config.organizationId} AND normalized_name=${plan.permissionSet.name.toLocaleLowerCase("en-US")} FOR UPDATE`);
    let permissionSetId = existingSet.rows[0]?.id;
    if (existingSet.rows[0] && (existingSet.rows[0].source_template_key !== null || existingSet.rows[0].principal_kind !== plan.permissionSet.principalKind)) {
      throw new Error("DEV QA mutation permission-set name is already reserved by a non-custom Staff set.");
    }
    if (!permissionSetId) {
      const inserted = await tx.execute<{ id: string }>(sql`INSERT INTO v2_permission_sets(organization_id,name,normalized_name,description,principal_kind) VALUES(${config.organizationId},${plan.permissionSet.name},${plan.permissionSet.name.toLocaleLowerCase("en-US")},${plan.permissionSet.description},${plan.permissionSet.principalKind}) RETURNING id`);
      permissionSetId = inserted.rows[0]?.id;
    } else {
      await tx.execute(sql`UPDATE v2_permission_sets SET name=${plan.permissionSet.name},description=${plan.permissionSet.description},active=true,updated_at=now() WHERE id=${permissionSetId} AND organization_id=${config.organizationId}`);
    }
    if (!permissionSetId) throw new Error("DEV QA mutation permission set could not be created.");

    const otherAssignees = await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM v2_staff_permission_set_assignments WHERE organization_id=${config.organizationId} AND permission_set_id=${permissionSetId} AND active=true AND user_id<>${user.id} LIMIT 1`);
    if (otherAssignees.rows[0]) throw new Error("DEV QA mutation permission set is assigned to another Staff identity; refusing to change it.");
    const otherAssignments = await tx.execute<{ permission_set_id: string }>(sql`SELECT permission_set_id FROM v2_staff_permission_set_assignments WHERE organization_id=${config.organizationId} AND user_id=${user.id} AND active=true AND permission_set_id<>${permissionSetId} LIMIT 1`);
    if (otherAssignments.rows[0]) throw new Error("DEV QA mutation identity has an unrelated active permission set; refusing to broaden it.");

    await tx.execute(sql`DELETE FROM v2_permission_set_capabilities WHERE organization_id=${config.organizationId} AND permission_set_id=${permissionSetId} AND capability_id NOT IN (${sql.join(plan.permissionSet.capabilities.map((capability) => sql`${capability}`), sql`, `)})`);
    for (const capability of plan.permissionSet.capabilities) {
      await tx.execute(sql`INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES(${config.organizationId},${permissionSetId},${capability}) ON CONFLICT DO NOTHING`);
    }
    await tx.execute(sql`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,assignment_source) VALUES(${config.organizationId},${user.id},${permissionSetId},'dev_qa_mutation') ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,assignment_source='dev_qa_mutation',updated_at=now()`);
    await tx.execute(sql`UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=${config.organizationId}`);
    await tx.insert(auditLogs).values({ organizationId: config.organizationId, userId: user.id, userName: "DEV QA mutation provisioner", actionType: "DEV_QA_MUTATION_ACTOR_ENSURED", entityType: "user", entityId: user.id, entityName: "Dedicated DEV QA mutation user", description: "Dedicated DEV-only QA mutation user converged through the guarded provisioner.", newValues: { permissionSet: plan.permissionSet.name, capabilities: plan.permissionSet.capabilities, source: "qa:provision-dev-mutation-user" }, ipAddress: "cli", userAgent: "qa-provision-dev-mutation-user" });
    await tx.execute(sql`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,detail) VALUES(${config.organizationId},'dev_qa_mutation_provisioned','service','dev-qa-mutation-provisioner',${permissionSetId},${user.id},${JSON.stringify({ capabilities: plan.permissionSet.capabilities, source: "qa:provision-dev-mutation-user" })}::jsonb)`);
    return { created: !existingUser, permissionSetCreated: !existingSet.rows[0], userId: user.id, organizationId: config.organizationId, permissionSetId, capabilities: plan.permissionSet.capabilities };
  });
}

provision().then((result) => {
  console.log(JSON.stringify({ success: true, created: result.created, permissionSetCreated: result.permissionSetCreated, organizationId: result.organizationId, capabilities: result.capabilities }));
}).catch((error: unknown) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : "DEV QA mutation provisioning failed." }));
  process.exitCode = 1;
}).finally(async () => {
  await databaseModule?.pool.end();
});
