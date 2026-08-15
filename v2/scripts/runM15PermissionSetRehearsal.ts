import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M15PermissionPhysicalPostconditions, checkV2M15PermissionPhysicalPostconditions } from "../infrastructure/authorization/permissionPhysicalPostconditions.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { PostgresPermissionAuthorityReader } from "../infrastructure/authorization/postgresPermissionAuthorityRead.js";
import { PermissionSetPrincipalIssuer } from "../src/authorization/permissionSets.js";
import { randomUUID } from "node:crypto";
import { PostgresPermissionBootstrap } from "../infrastructure/authorization/postgresPermissionBootstrap.js";
import { PostgresPermissionAdministration } from "../infrastructure/authorization/postgresPermissionAdministration.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const staffIdentity = (subjectId: string) => ({ subjectId, authenticatedAt: new Date(), authenticationMethod: "session" as const });
const portalIdentity = (subjectId: string) => ({ subjectId, authenticatedAt: new Date(), authenticationMethod: "portal_session" as const });
const operationContext = (label: string) => ({ correlationId: `m15-${label}-${randomUUID()}`, businessRequestId: `m15-${label}-${randomUUID()}` });

/**
 * Guarded clone-only rehearsal. It deliberately does not import dotenv, the
 * V1 db runtime, or Drizzle config: TEST_DATABASE_URL is the sole source.
 * Pool max 3 is the minimum for later lock-holder plus two-contender probes.
 */
async function main(): Promise<void> {
  const url=requireV2M0CloneDatabaseUrl(); const pool=new Pool({connectionString:url,max:3}); let client: Awaited<ReturnType<typeof pool.connect>>|undefined;
  try {
    await migrate(drizzle({client:pool}),{migrationsFolder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"});
    client=await pool.connect(); assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client)); const findings=await checkV2M15PermissionPhysicalPostconditions(client); assertV2M15PermissionPhysicalPostconditions(findings);
    const organizations=await client.query<{id:string}>("SELECT id FROM organizations ORDER BY id LIMIT 2"); if(organizations.rows.length<2)throw new Error("Approved clone needs two organizations for M1.5 rehearsal.");
    const [orgA,orgB]=organizations.rows.map(row=>row.id); const suffix=randomUUID(); const staff=`m15-staff-${suffix}`, flags=`m15-flags-${suffix}`, portal=`m15-portal-${suffix}`, customer=`m15-customer-${suffix}`, customerDefault=`m15-customer-default-${suffix}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO users(id,email,role,is_admin,is_platform_admin,is_platform_developer) VALUES($1,$2,'owner',true,true,true),($3,$4,'owner',true,true,true),($5,$6,'customer',true,true,true)",[staff,`m15-staff-${suffix}@example.test`,flags,`m15-flags-${suffix}@example.test`,portal,`m15-portal-${suffix}@example.test`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'owner',true)",[staff,orgA]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'M1.5 Customer','M1.5 Customer',true,'active'),($3,$2,'M1.5 Default','M1.5 Default',true,'active')",[customer,orgA,customerDefault]);
    await client.query("INSERT INTO customer_portal_access(id,organization_id,customer_id,user_id,status,email) VALUES($1,$2,$3,$4,'ACTIVE',$5)",[`pa-${suffix}`,orgA,customer,portal,`m15-portal-${suffix}@example.test`]);
    const staffSet=`staff-set-${suffix}`, portalSet=`portal-set-${suffix}`, portalDefaultSet=`portal-default-set-${suffix}`;
    await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,'M15 Staff','m15 staff','staff'),($3,$2,'M15 Portal','m15 portal','portal'),($4,$2,'M15 Portal Default','m15 portal default','portal')",[staffSet,orgA,portalSet,portalDefaultSet]);
    await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'quote.view'),($1,$2,'order.view'),($1,$3,'order.view'),($1,$3,'order.create'),($1,$4,'order.view'),($1,$4,'order.create')",[orgA,staffSet,portalSet,portalDefaultSet]);
    await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3)",[orgA,staff,staffSet]);
    await client.query("INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id) VALUES($1,$2,$3)",[orgA,`pa-${suffix}`,portalSet]);
    await client.query("INSERT INTO v2_customer_portal_ceiling_policies(organization_id,customer_id) VALUES($1,$2)",[orgA,customer]);
    await client.query("INSERT INTO v2_customer_portal_ceiling_capabilities(organization_id,customer_id,capability_id) VALUES($1,$2,'order.view')",[orgA,customer]);
    const issuer=new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(client));
    const issued=await issuer.issue(staffIdentity(staff),{organizationId:orgA}); if(issued.kind!=="staff" || !issued.authority.capabilities.includes("quote.view") || !issued.authority.capabilities.includes("order.view"))throw new Error("Staff set union did not issue expected authority.");
    if(await issuer.issue(staffIdentity(flags),{organizationId:orgA}).then(()=>true,()=>false))throw new Error("Global flags issued authority without a V2 assignment.");
    await client.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$2 AND capability_id='quote.view'",[orgA,staffSet]);
    const refreshed=await issuer.issue(staffIdentity(staff),{organizationId:orgA}); if(refreshed.kind!=="staff" || refreshed.authority.capabilities.includes("quote.view"))throw new Error("Same issuer did not freshly resolve capability removal.");
    const issuedPortal=await issuer.issue(portalIdentity(portal),{organizationId:orgA}); if(issuedPortal.kind!=="portal" || !issuedPortal.capabilities.includes("order.view") || issuedPortal.capabilities.includes("order.create"))throw new Error("Portal customer ceiling did not narrow set authority.");
    await client.query("SAVEPOINT m15_kind"); try { await client.query("INSERT INTO v2_portal_permission_set_assignments(organization_id,portal_access_id,permission_set_id) VALUES($1,$2,$3)",[orgA,`pa-${suffix}`,staffSet]); throw new Error("Assignment-kind constraint did not reject Staff set for Portal."); } catch(error) { if(error instanceof Error && error.message.includes("Assignment-kind")) throw error; await client.query("ROLLBACK TO SAVEPOINT m15_kind"); }
    await client.query("SAVEPOINT m15_foreign"); try { await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3)",[orgB,staff,staffSet]); throw new Error("Foreign organization assignment was accepted."); } catch(error) { if(error instanceof Error && error.message.includes("Foreign organization")) throw error; await client.query("ROLLBACK TO SAVEPOINT m15_foreign"); }
    await client.query("SAVEPOINT m15_immutable"); try { await client.query("UPDATE v2_permission_sets SET principal_kind='portal' WHERE id=$1 AND organization_id=$2",[staffSet,orgA]); throw new Error("Assigned permission-set kind was mutable."); } catch(error) { if(error instanceof Error && error.message.includes("Assigned permission")) throw error; await client.query("ROLLBACK TO SAVEPOINT m15_immutable"); }
    await client.query("ROLLBACK"); console.log("[m1.5-postgres] Staff/Portal issuance, freshness, ceiling, tenant, legacy-flag, and kind-hardening rehearsal passed.");
    const boot=`m15-boot-${suffix}`, limited=`m15-limited-${suffix}`, limitedSet=`m15-limited-set-${suffix}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO users(id,email,role,is_admin,is_platform_admin,is_platform_developer) VALUES($1,$2,'owner',true,true,true),($3,$4,'owner',false,false,false)",[boot,`m15-boot-${suffix}@example.test`,limited,`m15-limited-${suffix}@example.test`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'member',true),($3,$2,'member',true)",[boot,orgA,limited]);
    await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,$3,$4,'staff')",[limitedSet,orgA,`M15 Limited ${suffix}`,`m15 limited ${suffix}`]);
    await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'permissions.manageSets'),($1,$2,'permissions.assignStaff')",[orgA,limitedSet]);
    await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3)",[orgA,limited,limitedSet]); await client.query("COMMIT");
    const bootstrap=new PostgresPermissionBootstrap(client); await bootstrap.bootstrapLegacyMembership({organizationId:orgA,userId:boot,...operationContext("bootstrap")});
    const bootIssued=await issuer.issue(staffIdentity(boot),{organizationId:orgA}); if(bootIssued.kind!=="staff" || !bootIssued.authority.capabilities.includes("quote.view"))throw new Error("Bootstrap did not create V2-backed member authority.");
    await client.query("UPDATE user_organizations SET role='owner' WHERE user_id=$1 AND organization_id=$2",[boot,orgA]); await bootstrap.bootstrapLegacyMembership({organizationId:orgA,userId:boot,...operationContext("bootstrap-retry")});
    const bootstrapAssignments=await client.query("SELECT count(*)::int AS count FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2 AND assignment_source='legacy_role_bootstrap'",[orgA,boot]); if(bootstrapAssignments.rows[0].count!==1)throw new Error("Bootstrap was not one-time/idempotent.");
    const limitedIssued=await issuer.issue(staffIdentity(limited),{organizationId:orgA}); if(limitedIssued.kind!=="staff")throw new Error("Limited V2 permission administrator did not issue.");
    const administration=new PostgresPermissionAdministration(client); let escalated=false; try { await administration.assignStaff(limitedIssued,orgA,limited,(await client.query<{id:string}>("SELECT id FROM v2_permission_sets WHERE organization_id=$1 AND source_template_key='owner'",[orgA])).rows[0].id,operationContext("self-escalation")); escalated=true; } catch { /* expected grant-ceiling rejection */ }
    if(escalated)throw new Error("Limited administrator assigned an out-of-ceiling Owner set.");
    await client.query("BEGIN"); await client.query("DELETE FROM v2_permission_audit_events WHERE organization_id=$1 AND target_user_id IN($2,$3)",[orgA,boot,limited]); await client.query("DELETE FROM user_organizations WHERE organization_id=$1 AND user_id IN($2,$3)",[orgA,boot,limited]); await client.query("DELETE FROM users WHERE id IN($1,$2)",[boot,limited]); await client.query("COMMIT");
    console.log("[m1.5-postgres] bootstrap idempotence and self-escalation rehearsal passed.");
    console.log("[m1.5-postgres] migrations and normalized permission-set catalog postconditions passed.");
  }
  finally { client?.release(); await pool.end(); }
}
main().catch((error:unknown)=>{console.error(`[m1.5-postgres] rehearsal failed: ${error instanceof Error ? error.stack ?? error.message : "unknown failure"}`);process.exitCode=1;});
