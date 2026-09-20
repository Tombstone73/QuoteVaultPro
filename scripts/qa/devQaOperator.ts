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
import { DEV_QA_OPERATOR_BROWSER_EMAIL, getDevQaOperatorConfig } from "../../server/lib/devQaProvisioningGuard";
import { getRuntimeEnvironmentSummary } from "../../server/lib/runtimeEnvironment";

type Database = typeof import("../../server/db");
type Transaction = Parameters<Awaited<ReturnType<Database["db"]["transaction"]>>>[0] extends (tx: infer T) => unknown ? T : never;
type Command = "status" | "user-password-set" | "profile-apply" | "profile-restore" | "verify";
type ActiveSet = Readonly<{ id: string; name: string; capabilities: readonly string[] }>;
type UserState = Readonly<{ id: string; email: string; memberships: readonly Readonly<{ organizationId: string; active: boolean }>[]; activeSets: readonly ActiveSet[]; capabilities: readonly string[]; profile: DevQaApprovedProfile | null }>;

let databaseModule: Database | undefined;

function fail(message: string): never { throw new Error(message); }

function parseArgs(argv: readonly string[]): { command: Command; options: ReadonlyMap<string, string> } {
  const [command, ...rest] = argv;
  if (command !== "status" && command !== "user-password-set" && command !== "profile-apply" && command !== "profile-restore" && command !== "verify") {
    fail("Usage: qa:dev-operator <status|user-password-set|profile-apply|profile-restore|verify> [options]");
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
  const [user] = await tx.select({ id: users.id, email: users.email, accountType: users.accountType, isPlatformAdmin: users.isPlatformAdmin, isPlatformDeveloper: users.isPlatformDeveloper, mustSetPassword: users.mustSetPassword })
    .from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.email?.toLowerCase() !== email) fail("Dedicated DEV QA identity does not exist.");
  if (user.accountType !== "INTERNAL_USER" || user.isPlatformAdmin || user.isPlatformDeveloper || user.mustSetPassword) fail("Dedicated DEV QA identity is not an active non-platform internal user.");
  const membershipResult = await tx.execute<{ organization_id: string; is_active: boolean }>(sql`SELECT organization_id,is_active FROM user_organizations WHERE user_id=${user.id} ORDER BY organization_id`);
  const memberships = membershipResult.rows.map((row) => Object.freeze({ organizationId: row.organization_id, active: row.is_active }));
  const setResult = await tx.execute<{ id: string; name: string; capability_id: string | null }>(sql`SELECT ps.id,ps.name,catalog.id AS capability_id
    FROM v2_staff_permission_set_assignments a
    JOIN v2_permission_sets ps ON ps.id=a.permission_set_id AND ps.organization_id=a.organization_id AND ps.active=true AND ps.principal_kind='staff'
    LEFT JOIN v2_permission_set_capabilities pc ON pc.permission_set_id=ps.id AND pc.organization_id=ps.organization_id
    LEFT JOIN v2_permission_capabilities catalog ON catalog.id=pc.capability_id AND catalog.active=true
    WHERE a.user_id=${user.id} AND a.organization_id=${getDevQaOperatorConfig().organizationId} AND a.active=true
    ORDER BY ps.id,pc.capability_id`);
  const sets = new Map<string, { id: string; name: string; capabilities: string[] }>();
  for (const row of setResult.rows) {
    const entry = sets.get(row.id) ?? { id: row.id, name: row.name, capabilities: [] };
    if (row.capability_id) entry.capabilities.push(row.capability_id);
    sets.set(row.id, entry);
  }
  const activeSets = [...sets.values()].map((set) => Object.freeze({ ...set, capabilities: Object.freeze([...new Set(set.capabilities)].sort()) }));
  const capabilities = Object.freeze([...new Set(activeSets.flatMap((set) => set.capabilities))].sort());
  const profile = activeSets.length === 1 ? profileForPermissionState(activeSets[0].name, capabilities) : null;
  return Object.freeze({ id: user.id, email, memberships: Object.freeze(memberships), activeSets: Object.freeze(activeSets), capabilities, profile });
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
  if (requireApprovedProfile && !browser.profile) fail("Dedicated DEV QA browser identity does not have an approved single QA permission profile.");
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
    browser: { email: browser.email, active: true, membershipCount: browser.memberships.length, soleOrganization: browser.memberships[0]?.organizationId ?? null, profile: browser.profile, permissionSets: browser.activeSets.map((set) => set.name), capabilities: browser.capabilities, temporaryFixtureCapabilitiesPresent: isTemporaryFixtureProfile(browser.profile) },
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
  const browser = await checkedBrowser(tx, false);
  const guardian = await assertGuardian(tx);
  const definition = devQaProfileDefinition(requested);
  const state = await tx.execute<{ authority_revision: string }>(sql`SELECT authority_revision FROM v2_permission_organization_state WHERE organization_id=${config.organizationId} FOR UPDATE`);
  if (state.rowCount !== 1) fail("Dedicated DEV QA tenant has no V2 permission authority state.");
  if (browser.profile === requested) return { success: true, profile: requested, changed: false, capabilities: definition.capabilities, guardianUnchanged: true };
  const normalizedName = definition.permissionSetName.toLocaleLowerCase("en-US");
  const existingSet = await tx.execute<{ id: string; source_template_key: string | null; principal_kind: string }>(sql`SELECT id,source_template_key,principal_kind FROM v2_permission_sets WHERE organization_id=${config.organizationId} AND normalized_name=${normalizedName} FOR UPDATE`);
  let permissionSetId = existingSet.rows[0]?.id;
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
  await tx.execute(sql`INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,assignment_source) VALUES(${config.organizationId},${browser.id},${permissionSetId},'dev_qa_operator') ON CONFLICT(organization_id,user_id,permission_set_id) DO UPDATE SET active=true,assignment_source='dev_qa_operator',updated_at=now()`);
  await tx.execute(sql`UPDATE v2_staff_permission_set_assignments SET active=false,updated_at=now() WHERE organization_id=${config.organizationId} AND user_id=${browser.id} AND permission_set_id<>${permissionSetId} AND active=true`);
  await tx.execute(sql`UPDATE v2_permission_organization_state SET authority_revision=authority_revision+1,updated_at=now() WHERE organization_id=${config.organizationId}`);
  await tx.execute(sql`INSERT INTO v2_permission_audit_events(organization_id,event_type,actor_principal_kind,actor_principal_subject,permission_set_id,target_user_id,detail) VALUES(${config.organizationId},'dev_qa_profile_applied','service','dev-qa-operator',${permissionSetId},${browser.id},${JSON.stringify({ profile: requested, capabilities: definition.capabilities, source: "qa:dev-operator" })}::jsonb)`);
  const postBrowser = await readUserState(tx, DEV_QA_OPERATOR_BROWSER_EMAIL);
  assertQaOnlyMembership(postBrowser, config.organizationId);
  if (postBrowser.profile !== requested || !sameCapabilitySet(postBrowser.capabilities, definition.capabilities)) {
    fail("DEV QA profile application did not converge to the exact approved capability set.");
  }
  const postGuardian = await assertGuardian(tx);
  if (!sameCapabilitySet(postGuardian.capabilities, guardian.capabilities)) fail("DEV QA guardian changed while applying a browser profile.");
  return { success: true, profile: requested, changed: true, capabilities: postBrowser.capabilities, guardianUnchanged: true };
}

async function verify(tx: Transaction) {
  const browser = await checkedBrowser(tx, true);
  const guardian = await assertGuardian(tx);
  return { success: true, checks: { tenant: "PASS", browserExists: "PASS", browserActive: "PASS", browserSoleQaMembership: "PASS", browserApprovedProfile: "PASS", guardianExists: "PASS", guardianActive: "PASS", guardianSoleQaMembership: "PASS", guardianExactPermissionAdministration: "PASS" }, browser: { profile: browser.profile, capabilities: browser.capabilities }, guardian: { capabilities: guardian.capabilities } };
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
  rejectUnknownOptions(options, ["--email", "--profile"]);
  assertDedicatedBrowserEmail(requiredOption(options, "--email"));
  return db.transaction((tx) => profileApply(tx as Transaction, approvedDevQaProfile(requiredOption(options, "--profile"))));
}

run().then((result) => console.log(JSON.stringify(result))).catch((error: unknown) => {
  console.error(JSON.stringify({ success: false, message: error instanceof Error ? error.message : "DEV QA operator failed." }));
  process.exitCode = 1;
}).finally(async () => { await databaseModule?.pool.end(); });
