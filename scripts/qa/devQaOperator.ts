import "dotenv/config";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { authIdentities, organizations, users } from "../../shared/schema";
import {
  DEV_QA_GUARDIAN_EMAIL,
  DEV_QA_GUARDIAN_PERMISSION_SET_NAME,
  assertDedicatedBrowserEmail,
  approvedDevQaProfile,
  devQaProfileDefinition,
  isExactGuardianCapabilitySet,
  isTemporaryFixtureProfile,
  profileForPermissionState,
  sameCapabilitySet,
  type DevQaApprovedProfile,
} from "../../server/lib/devQaOperator";
import {
  DEV_QA_OPERATOR_BROWSER_EMAIL,
  DEV_QA_OPERATOR_MANAGEMENT_EMAIL,
  DEV_QA_OPERATOR_MANAGEMENT_NAME,
  getDevQaOperatorConfig,
} from "../../server/lib/devQaProvisioningGuard";
import { getRuntimeEnvironmentSummary } from "../../server/lib/runtimeEnvironment";

type Database = typeof import("../../server/db");
type Transaction = Parameters<Parameters<Database["db"]["transaction"]>[0]>[0];
type Command = "status" | "user-password-set" | "profile-apply" | "profile-restore" | "management-bootstrap" | "verify";
type ActiveSet = Readonly<{ id: string; name: string; sourceTemplateKey: string | null; capabilities: readonly string[] }>;
type UserState = Readonly<{ nonAdmin: boolean; id: string; email: string; memberships: readonly Readonly<{ organizationId: string; active: boolean }>[]; activeSets: readonly ActiveSet[]; capabilities: readonly string[]; profile: DevQaApprovedProfile | null }>;

let databaseModule: Database | undefined;

function fail(message: string): never { throw new Error(message); }

function parseArgs(argv: readonly string[]): { command: Command; options: ReadonlyMap<string, string> } {
  const [command, ...rest] = argv;
  if (command !== "status" && command !== "user-password-set" && command !== "profile-apply" && command !== "profile-restore" && command !== "management-bootstrap" && command !== "verify") {
    fail("Usage: qa:dev-operator <status|user-password-set|profile-apply|profile-restore|management-bootstrap|verify> [options]");
  }
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]; const value = rest[index + 1];
    if (!key?.startsWith("--") || !value || options.has(key)) fail("DEV QA operator accepts only complete, non-repeated --option value pairs.");
    options.set(key, value);
  }
  return { command, options };
}

function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name)?.trim();
  if (!value) fail(`DEV QA operator requires ${name}.`);
  return value;
}

function rejectUnknownOptions(options: ReadonlyMap<string, string>, allowed: readonly string[]): void {
  for (const key of options.keys()) if (!allowed.includes(key)) fail(`DEV QA operator does not accept ${key}.`);
}

async function readUserState(tx: Transaction, email: string): Promise<UserState> {
  const [user] = await tx.select({ id: users.id, email: users.email, accountType: users.accountType, role: users.role, isAdmin: users.isAdmin, isPlatformAdmin: users.isPlatformAdmin, isPlatformDeveloper: users.isPlatformDeveloper, mustSetPassword: users.mustSetPassword })
    .from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.email?.toLowerCase() !== email) fail("Dedicated DEV QA identity does not exist.");
  if (user.accountType !== "INTERNAL_USER" || user.isPlatformAdmin || user.isPlatformDeveloper || user.mustSetPassword) fail("Dedicated DEV QA identity is not an active non-platform internal user.");
  const membershipResult = await tx.execute<{ organization_id: string; is_active: boolean; role: string }>(sql`SELECT organization_id,is_active,role FROM user_organizations WHERE user_id=${user.id} ORDER BY organization_id`);
  const memberships = membershipResult.rows.map((row) => Object.freeze({ organizationId: row.organization_id, active: row.is_active }));
  const setResult = await tx.execute<{ id: string; name: string; source_template_key: string | null; capability_id: string | null }>(sql`SELECT ps.id,ps.name,ps.source_template_key,catalog.id AS capability_id
    FROM v2_staff_permission_set_assignments a
    JOIN v2_permission_sets ps ON ps.id=a.permission_set_id AND ps.organization_id=a.organization_id AND ps.active=true AND ps.principal_kind='staff'
    LEFT JOIN v2_permission_set_capabilities pc ON pc.permission_set_id=ps.id AND pc.organization_id=ps.organization_id
    LEFT JOIN v2_permission_capabilities catalog ON catalog.id=pc.capability_id AND catalog.active=true
    WHERE a.user_id=${user.id} AND a.organization_id=${getDevQaOperatorConfig().organizationId} AND a.active=true
    ORDER BY ps.id,pc.capability_id`);
  const sets = new Map<string, { id: string; name: string; sourceTemplateKey: string | null; capabilities: string[] }>();
  for (const row of setResult.rows) {
    const entry = sets.get(row.id) ?? { id: row.id, name: row.name, sourceTemplateKey: row.source_template_key, capabilities: [] as string[] };
    if (row.capability_id) entry.capabilities.push(row.capability_id);
    sets.set(row.id, entry);
  }
  const activeSets = [...sets.values()].map((set) => Object.freeze({ ...set, capabilities: Object.freeze([...new Set(set.capabilities)].sort()) }));
  const capabilities = Object.freeze([...new Set(activeSets.flatMap((set) => set.capabilities))].sort());
  const profile = activeSets.length === 1 ? profileForPermissionState(activeSets[0].name, capabilities, activeSets[0].sourceTemplateKey) : null;
  return Object.freeze({ nonAdmin: user.role === "employee" && !user.isAdmin && membershipResult.rows.every((row) => row.role === "member"), id: user.id, email, memberships: Object.freeze(memberships), activeSets: Object.freeze(activeSets), capabilities, profile });
}

function assertQaOnlyMembership(state: UserState, organizationId: string): void {
  if (state.memberships.length !== 1 || state.memberships[0].organizationId !== organizationId || !state.memberships[0].active) {
    fail("Dedicated DEV QA identity must have exactly one active membership in the dedicated QA tenant.");
  }
}

async function assertTenant(tx: Transaction): Promise<void> {
  const config = getDevQaOperatorConfig();
  const [organization] = await tx.select({ id: organizations.id, name: organizations.name, isArchived: organizations.isArchived, deleteState: organizations.deleteState })
    .from(organizations).where(eq(organizations.id, config.organizationId)).limit(1);
  if (!organization || organization.name !== config.organizationName || organization.isArchived || organization.deleteState !== "active") {
    fail("Dedicated PrintersHero M7 QA tenant is missing, inactive, or does not exactly match the approved identity.");
  }
}

async function assertGuardian(tx: Transaction): Promise<UserState> {
  const config = getDevQaOperatorConfig();
  const guardian = await readUserState(tx, DEV_QA_GUARDIAN_EMAIL);
  assertQaOnlyMembership(guardian, config.organizationId);
  if (guardian.activeSets.length !== 1 || guardian.activeSets[0].name !== DEV_QA_GUARDIAN_PERMISSION_SET_NAME || !isExactGuardianCapabilitySet(guardian.capabilities)) {
    fail("Dedicated DEV QA guardian is not the exact isolated permission-administrator floor identity.");
  }
  return guardian;
}

async function assertPasswordIdentity(tx: Transaction, userId: string): Promise<string> {
  const [identity] = await tx.select({ id: authIdentities.id, passwordSetAt: authIdentities.passwordSetAt })
    .from(authIdentities).where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, "password"))).limit(1);
  if (!identity || !identity.passwordSetAt) fail("Dedicated DEV QA browser identity has no established V2 password credential.");
  return identity.id;
}

async function checkedBrowser(tx: Transaction, requireApprovedProfile: boolean): Promise<UserState> {
  const config = getDevQaOperatorConfig();
  await assertTenant(tx);
  const browser = await readUserState(tx, config.browserEmail);
  assertQaOnlyMembership(browser, config.organizationId);
  if (requireApprovedProfile && (!browser.profile || (browser.profile === "m78i" && !browser.nonAdmin))) fail("Dedicated DEV QA browser identity does not have an approved single QA permission profile.");
  await assertGuardian(tx);
  return browser;
}

function safeStatus(browser: UserState, guardian: UserState) {
  const runtime = getRuntimeEnvironmentSummary({ env: process.env, requestHost: "dev.printershero.com", requestOrigin: "https://dev.printershero.com" });
  return {
    success: true,
    guard: "PASS",
    runtime: { appRuntime: runtime.appRuntime, apiRuntime: runtime.apiRuntime, databaseRuntime: runtime.databaseRuntime, buildFingerprint: runtime.buildFingerprint },
    tenant: { id: getDevQaOperatorConfig().organizationId, name: getDevQaOperatorConfig().organizationName },
    browser: { email: browser.email, active: true, nonAdmin: browser.nonAdmin, membershipCount: browser.memberships.length, soleOrganization: browser.memberships[0]?.organizationId ?? null, profile: browser.profile, permissionSets: browser.activeSets.map((set) => ({ name: set.name, sourceTemplateKey: set.sourceTemplateKey })), capabilities: browser.capabilities, temporaryFixtureCapabilitiesPresent: isTemporaryFixtureProfile(browser.profile) },
    guardian: { email: guardian.email, active: true, membershipCount: guardian.memberships.length, capabilities: guardian.capabilities },
  };
}

async function status(tx: Transaction) {
  const browser = await checkedBrowser(tx, false);
  const guardian = await assertGuardian(tx);
  return safeStatus(browser, guardian);
}

async function passwordSet(tx: Transaction, options: ReadonlyMap<string, string>) {
  rejectUnknownOptions(options, ["--email", "--password-env"]);
  assertDedicatedBrowserEmail(requiredOption(options, "--email"));
  const passwordEnvironmentName = requiredOption(options, "--password-env");
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(passwordEnvironmentName)) fail("--password-env must name a protected environment variable.");
  const password = process.env[passwordEnvironmentName];
  if (!password) fail(`DEV QA operator requires ${passwordEnvironmentName} (value not logged).`);
  const browser = await checkedBrowser(tx, true);
  const identityId = await assertPasswordIdentity(tx, browser.id);
  const passwordHash = await bcrypt.hash(password, 12);
  await tx.update(authIdentities).set({ passwordHash, passwordSetAt: new Date(), updatedAt: new Date() }).where(eq(authIdentities.id, identityId));
  return { success: true, existingUserFound: true, passwordUpdated: true, organizationVerified: true, membershipUnchanged: true, permissionProfileUnchanged: true, guardianUnchanged: true };
}

async function profileApply(tx: Transaction, requested: DevQaApprovedProfile) {
  const config = getDevQaOperatorConfig();
  const definition = devQaProfileDefinition(requested);
  const state = await tx.execute<{ authority_revision: string }>(sql`SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=${config.organizationId} FOR UPDATE`);
  if (state.rowCount !== 1) fail("Dedicated DEV QA tenant has no V2 permission authority state.");
  const browser = await checkedBrowser(tx, false);
  const guardian = await assertGuardian(tx);
  if (browser.profile === requested && browser.nonAdmin) return { success: true, profile: requested, changed: false, capabilities: definition.capabilities, guardianUnchanged: true };
  let permissionSetId: string | undefined;
  if (definition.sourceTemplateKey) {
    // Assign the real built-in set. Never copy, edit, or synthesize its grants.
    const canonical = await tx.execute<{ id: string; name: string }>(sql`SELECT id,name FROM v2_permission_sets WHERE organization_id=${config.organizationId} AND source_template_key=${definition.sourceTemplateKey} AND principal_kind='staff' AND active=true FOR UPDATE`);
    permissionSetId = canonical.rows[0]?.id;
    if (canonical.rows.length !== 1 || canonical.rows[0].name !== definition.permissionSetName) fail("Canonical Operations role is missing or inactive. Deploy its migration first.");
    const grants = await tx.execute<{ capability_id: string }>(sql`SELECT pc.capability_id FROM v2_permission_set_capabilities pc JOIN v2_permission_capabilities c ON c.id=pc.capability_id AND c.active=true WHERE pc.organization_id=${config.organizationId} AND pc.permission_set_id=${permissionSetId}`);
    if (!sameCapabilitySet(grants.rows.map((row) => row.capability_id), definition.capabilities)) fail("Canonical Operations role differs from the production role contract; refusing a QA-specific repair.");
  } else {
    const normalizedName = definition.permissionSetName.toLocaleLowerCase("en-US");
    const existingSet = await tx.execute<{ id: string; source_template_key: string | null; principal_kind: string }>(sql`SELECT id,source_template_key,principal_kind FROM v2_permission_sets WHERE organization_id=${config.organizationId} AND normalized_name=${normalizedName} FOR UPDATE`);
    permissionSetId = existingSet.rows[0]?.id;
    if (existingSet.rows[0] && (existingSet.rows[0].source_template_key !== null || existingSet.rows[0].principal_kind !== "staff")) fail("Approved DEV QA permission-set name is reserved by a non-custom Staff set.");
    if (!permissionSetId) {
      const inserted = await tx.execute<{ id: string }>(sql`INSERT INTO v2_permission_sets(organization_id,name,normalized_name,description,principal_kind) VALUES(${config.organizationId},${definition.permissionSetName},${normalizedName},${definition.permissionSetDescription},'staff') RETURNING id`);
      permissionSetId = inserted.rows[0]?.id;
    }
    if (!permissionSetId) fail("Approved DEV QA permission set could not be created.");
    const otherAssignee = await tx.execute<{ user_id: string }>(sql`SELECT user_id FROM v2_staff_permission_set_assignments WHERE organization_id=${config.organizationId} AND permission_set_id=${permissionSetId} AND active=true AND user_id<>${browser.id} LIMIT 1`);
    if (otherAssignee.rowCount) fail("Approved DEV QA permission set is assigned to another Staff identity.");
    await tx.execute(sql`UPDATE v2_permission_sets SET name=${definition.permissionSetName},description=${definition.permissionSetDescription},active=true,updated_at=now() WHERE id=${permissionSetId} AND organization_id=${config.organizationId}`);
    await tx.execute(sql`DELETE FROM v2_permission_set_capabilities WHERE organization_id=${config.organizationId} AND permission_set_id=${permissionSetId}`);
    for (const capability of definition.capabilities) await tx.execute(sql`INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES(${config.organizationId},${permissionSetId},${capability})`);
  }
  // Remove legacy administrator shortcuts as well as excess V2 assignments.
  // Tenant membership itself and the separate guardian remain intact.
  await tx.update(users).set({ role: "employee", isAdmin: false, updatedAt: new Date() }).where(eq(users.id, browser.id));
  await tx.execute(sql`UPDATE user_organizations SET role='member',updated_at=now() WHERE user_id=${browser.id} AND organization_id=${config.organizationId}`);
  await tx.execute(sql`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,assignment_source) VALUES(${config.organizationId},${browser.id},${permissionSetId},'dev_qa_operator') ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,assignment_source='dev_qa_operator',updated_at=now()`);
  await tx.execute(sql`UPDATE v2_staff_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=${config.organizationId} AND user_id=${browser.id} AND permission_set_id<>${permissionSetId} AND active=true`);
  await tx.execute(sql`UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=${config.organizationId}`);
  await tx.execute(sql`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,detail) VALUES(${config.organizationId},'dev_qa_profile_applied','service','dev-qa-operator',${permissionSetId},${browser.id},${JSON.stringify({ profile: requested, capabilities: definition.capabilities, source: "qa:dev-operator" })}::jsonb)`);
  const postBrowser = await readUserState(tx, DEV_QA_OPERATOR_BROWSER_EMAIL);
  assertQaOnlyMembership(postBrowser, config.organizationId);
  if (!postBrowser.nonAdmin || postBrowser.profile !== requested || !sameCapabilitySet(postBrowser.capabilities, definition.capabilities)) {
    fail("DEV QA profile application did not converge to the exact approved capability set.");
  }
  const postGuardian = await assertGuardian(tx);
  if (!sameCapabilitySet(postGuardian.capabilities, guardian.capabilities)) fail("DEV QA guardian changed while applying a browser profile.");
  return { success: true, profile: requested, changed: true, capabilities: postBrowser.capabilities, guardianUnchanged: true };
}

/**
 * One-time recovery for the dedicated DEV QA tenant's intentionally
 * non-interactive guardian. The live membership trigger creates the canonical
 * Owner assignment and advances authority revision; this command supplies only
 * the fixed, reviewed missing membership and its tenant-scoped audit event.
 */
async function managementBootstrap(tx: Transaction) {
  const config = getDevQaOperatorConfig();
  await assertTenant(tx);
  const browserBefore = await checkedBrowser(tx, true);
  const guardianBefore = await assertGuardian(tx);
  const [management] = await tx.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, accountType: users.accountType, isPlatformAdmin: users.isPlatformAdmin, isPlatformDeveloper: users.isPlatformDeveloper, mustSetPassword: users.mustSetPassword })
    .from(users).where(eq(users.email, DEV_QA_OPERATOR_MANAGEMENT_EMAIL)).limit(1);
  if (!management || management.email?.toLowerCase() !== DEV_QA_OPERATOR_MANAGEMENT_EMAIL) fail("Reviewed DEV management identity does not exist.");
  if (`${management.firstName ?? ""} ${management.lastName ?? ""}`.trim() !== DEV_QA_OPERATOR_MANAGEMENT_NAME) fail("Reviewed DEV management identity does not match the approved Owner identity.");
  if (management.accountType !== "INTERNAL_USER" || management.isPlatformAdmin || management.isPlatformDeveloper || management.mustSetPassword) fail("Reviewed DEV management identity is not an active non-platform internal Staff identity.");
  const normalOwner = await tx.execute<{ organization_id: string }>(sql`SELECT organization_id FROM user_organizations WHERE user_id=${management.id} AND organization_id<>${config.organizationId} AND is_active=true AND role='owner' LIMIT 1`);
  if (normalOwner.rowCount !== 1) fail("Reviewed DEV management identity must already be an Owner of another active DEV organization.");
  const membership = await tx.execute<{ role: string; is_active: boolean }>(sql`SELECT role,is_active FROM user_organizations WHERE user_id=${management.id} AND organization_id=${config.organizationId} FOR UPDATE`);
  if (membership.rowCount > 1) fail("Reviewed DEV management identity has duplicate QA memberships.");
  if (membership.rowCount === 1 && (!membership.rows[0]!.is_active || membership.rows[0]!.role !== "owner")) fail("Reviewed DEV management identity has an unexpected QA membership; refusing to alter it.");
  if (membership.rowCount === 0) {
    // v2_permission_membership_bootstrap provides the real Owner set,
    // assignment source, authority revision, and administrator-floor state.
    await tx.execute(sql`INSERT INTO user_organizations(user_id,organization_id,role,is_default,is_active) VALUES(${management.id},${config.organizationId},'owner',false,true)`);
  }
  const ownerAssignment = await tx.execute<{ permission_set_id: string }>(sql`SELECT a.permission_set_id FROM v2_staff_permission_set_assignments a JOIN v2_permission_sets s ON s.id=a.permission_set_id AND s.organization_id=a.organization_id WHERE a.organization_id=${config.organizationId} AND a.user_id=${management.id} AND a.active=true AND s.active=true AND s.principal_kind='staff' AND s.source_template_key='owner'`);
  if (ownerAssignment.rowCount !== 1) fail("Canonical QA Owner permission-set assignment was not established.");
  const changed = membership.rowCount === 0;
  if (changed) await tx.execute(sql`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,correlation_id,detail) VALUES(${config.organizationId},'dev_qa_management_bootstrapped','service','dev-qa-management-bootstrap',${ownerAssignment.rows[0]!.permission_set_id},${management.id},${`dev-qa-management-bootstrap:${management.id}`},${JSON.stringify({ source: "dev_qa_management_bootstrap", businessRequestId: "dev-qa-management-bootstrap:v1", structuralRole: "owner" })}::jsonb)`);
  const browserAfter = await checkedBrowser(tx, true);
  const guardianAfter = await assertGuardian(tx);
  if (!sameCapabilitySet(browserBefore.capabilities, browserAfter.capabilities) || browserBefore.profile !== browserAfter.profile || !browserAfter.nonAdmin) fail("QA browser identity changed during management bootstrap.");
  if (!sameCapabilitySet(guardianBefore.capabilities, guardianAfter.capabilities)) fail("QA guardian changed during management bootstrap.");
  return { success: true, changed, management: { email: DEV_QA_OPERATOR_MANAGEMENT_EMAIL, structuralRole: "owner", canonicalOwnerAssignment: true }, qaBrowserUnchanged: true, guardianUnchanged: true };
}

async function verify(tx: Transaction) {
  const browser = await checkedBrowser(tx, true);
  const guardian = await assertGuardian(tx);
  return { success: true, checks: { tenant: "PASS", browserExists: "PASS", browserActive: "PASS", browserSoleQaMembership: "PASS", browserApprovedProfile: "PASS", browserOperationsRole: browser.profile === "m78i" ? "PASS" : "TEMPORARY_FIXTURE", guardianExists: "PASS", guardianActive: "PASS", guardianSoleQaMembership: "PASS", guardianExactPermissionAdministration: "PASS" }, browser: { profile: browser.profile, role: browser.activeSets[0]?.sourceTemplateKey ?? null, nonAdmin: browser.nonAdmin, capabilities: browser.capabilities }, guardian: { capabilities: guardian.capabilities } };
}

async function run(): Promise<unknown> {
  const { command, options } = parseArgs(process.argv.slice(2));
  getDevQaOperatorConfig();
  databaseModule = await import("../../server/db");
  const { db } = databaseModule;
  if (command === "status") { rejectUnknownOptions(options, []); return db.transaction((tx) => status(tx as Transaction)); }
  if (command === "verify") { rejectUnknownOptions(options, []); return db.transaction((tx) => verify(tx as Transaction)); }
  if (command === "user-password-set") return db.transaction((tx) => passwordSet(tx as Transaction, options));
  if (command === "profile-restore") { rejectUnknownOptions(options, ["--email"]); if (options.has("--email")) assertDedicatedBrowserEmail(requiredOption(options, "--email")); return db.transaction((tx) => profileApply(tx as Transaction, "m78i")); }
  if (command === "management-bootstrap") { rejectUnknownOptions(options, []); return db.transaction((tx) => managementBootstrap(tx as Transaction)); }
  rejectUnknownOptions(options, ["--email", "--profile"]);
  assertDedicatedBrowserEmail(requiredOption(options, "--email"));
  return db.transaction((tx) => profileApply(tx as Transaction, approvedDevQaProfile(requiredOption(options, "--profile"))));
}

run().then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : "DEV QA operator failed." }));
  process.exitCode = 1;
}).finally(async () => { await databaseModule?.pool.end(); });
