import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresStaffMembershipAuthorityReader } from "../infrastructure/compatibility/postgresStaffMembershipRead.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { TemporaryStaffCompatibilityPrincipalIssuer } from "../src/authorization/temporaryStaffPrincipalIssuer.js";

const identity = (subjectId: string) => ({ subjectId, authenticatedAt: new Date(), authenticationMethod: "session" as const });

/** Clone-only, transaction-rolled-back proof of current membership authority reads. */
async function main(): Promise<void> {
  const url = requireV2M0CloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  const suffix = randomUUID();
  try {
    client = await pool.connect();
    const organizations = await client.query<{ id: string }>("SELECT id FROM organizations ORDER BY id LIMIT 2");
    if (organizations.rows.length < 2) throw new Error("Approved clone needs two organizations for M1.4 authority rehearsal.");
    const [orgA, orgB] = organizations.rows.map((row) => row.id);
    const staff = `m14-staff-${suffix}`;
    const flagsOnly = `m14-flags-only-${suffix}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email, role, is_admin, is_platform_admin, is_platform_developer) VALUES ($1, $2, 'owner', true, true, true)", [staff, `m14-${suffix}@example.test`]);
    await client.query("INSERT INTO users (id, email, role, is_admin, is_platform_admin, is_platform_developer) VALUES ($1, $2, 'owner', true, true, true)", [flagsOnly, `m14-flags-${suffix}@example.test`]);
    await client.query("INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'member')", [staff, orgA, orgB]);

    const issuer = new TemporaryStaffCompatibilityPrincipalIssuer(new PostgresStaffMembershipAuthorityReader(client));
    const admin = await issuer.issueStaff({ identity: identity(staff), requestedOrganizationId: orgA });
    const member = await issuer.issueStaff({ identity: identity(staff), requestedOrganizationId: orgB });
    const noMembership = await issuer.issueStaff({ identity: identity(flagsOnly), requestedOrganizationId: orgA });
    if (!admin.ok || !admin.value.authority.capabilities.includes("invoice.issue")) throw new Error("Admin membership did not issue expected scoped authority.");
    if (!member.ok || member.value.authority.capabilities.includes("invoice.issue")) throw new Error("Organization-specific member authority was not narrowed.");
    if (noMembership.ok) throw new Error("Global user admin/platform flags bypassed membership authority.");

    await client.query("UPDATE user_organizations SET role = 'member' WHERE user_id = $1 AND organization_id = $2", [staff, orgA]);
    const changed = await issuer.issueStaff({ identity: identity(staff), requestedOrganizationId: orgA });
    if (!changed.ok || changed.value.authority.capabilities.includes("invoice.issue")) throw new Error("Role change was not reflected on fresh issuance.");
    await client.query("DELETE FROM user_organizations WHERE user_id = $1 AND organization_id = $2", [staff, orgA]);
    if ((await issuer.issueStaff({ identity: identity(staff), requestedOrganizationId: orgA })).ok) throw new Error("Removed membership still issued authority.");
    await client.query("INSERT INTO user_organizations (user_id, organization_id, role) VALUES ($1, $2, 'admin')", [staff, orgA]);
    await client.query("UPDATE organizations SET status = 'suspended' WHERE id = $1", [orgA]);
    if ((await issuer.issueStaff({ identity: identity(staff), requestedOrganizationId: orgA })).ok) throw new Error("Suspended organization still issued Staff authority.");
    console.log("[m1.4-postgres] scoped Staff authority compatibility rehearsal passed.");
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* transaction may not have begun */ }
    client?.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[m1.4-postgres] rehearsal failed: ${error instanceof Error ? error.message : "unknown failure"}`);
  process.exitCode = 1;
});
