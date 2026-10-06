import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client, Pool, PoolClient } from "pg";
import type { StaffPrincipal } from "../../src/authorization/principals.js";
import { requireSafeTestDatabaseUrl } from "../../../server/tests/helpers/safeTestDatabase.js";

// External/native integration, deliberately not an automatic canonical test.
// No dotenv, secret-file discovery, migration runner, provider, or email calls.
type Outcome = { status: "fulfilled" } | { status: "rejected"; code: string; sqlstate: string | null };
type Wait = { blocker: number; waiter: number; waitEventType: string; waitEvent: string; modes: string[]; entryQuery: true };
type CleanupReceipt = { status: "not_started" | "passed" | "failed"; durationMs?: number; liveOwnedOrganizations?: number; liveOwnedUsers?: number; deletedOrganizations?: number; deletedUsers?: number; remainingOwnedOrganizations?: number; remainingOwnedUsers?: number; baselinePreserved?: boolean; errorCode?: string };
type CaseReceipt = { id: string; status: "passed" | "failed"; outcomes: Outcome[]; waits: Wait[]; counts: Record<string, number>; cleanup: CleanupReceipt; errorCode?: string; errorName?: string; errorFrames?: string[] };
export type StructuralAuthorityNativeFixtureManifest = {
  schemaVersion: 2;
  kind: "canonical-auth-proof-native-fixture";
  physicalSchemaProfile: "access05-public-catalog-v2";
  knownDifferences: ["crm_revision_positive_check_absent_on_shared_foundation"];
  targetFingerprint: string;
  foundation: { sourceHead: string; exportSha256: string; sourceFiles: Record<string, string> };
  migrations: Array<{ path: string; sha256: string; source: "foundation-commit" | "candidate" }>;
  physicalSchemaSha256: string;
};
// The external, independently reviewed fixture producer uses this exact read
// to pin this named public-catalog profile, NOT generic full-schema equivalence.
// ACL/RLS policy equivalence, extension binaries and historical migration-chain
// equivalence are not claimed. Internal trigger names are installation-specific.
// No credentials, row data or SQL execution from a manifest.
export const STRUCTURAL_AUTHORITY_SCHEMA_QUERY = `SELECT jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p')),
  'constraints',(SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'indexes',(SELECT jsonb_agg(jsonb_build_array(c.relname,x.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indislive) ORDER BY c.relname,x.relname) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgisinternal,t.tgenabled,pg_get_triggerdef(t.oid)) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
  'enums',(SELECT jsonb_agg(jsonb_build_array(t.typname,e.enumsortorder,e.enumlabel) ORDER BY t.typname,e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public'),
  'views',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relkind,c.relispopulated,c.reloptions,pg_get_viewdef(c.oid,false)) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m')),
  'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid)) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p'))
) shape`;
export type StructuralAuthorityNativeReceipt = {
  schemaVersion: 1; suite: "ACCESS05-native"; status: "passed" | "failed";
  source: { head: string; dirty: boolean; attribution: "dirty-tree" | "commit"; digests: Record<string, string> };
  target: { host: string; port: number; database: string; fingerprint: string; serverVersion?: string; serverAddress?: string };
  fixture: { kind: "canonical-auth-proof-native-fixture"; physicalSchemaProfile: "access05-public-catalog-v2"; knownDifferences: string[]; manifestSha256: string; foundationSourceHead: string; foundationExportSha256: string; migrationDigests: Record<string, string>; physicalSchemaSha256: string; fullHistoricalMigrationRehearsal: false };
  ownedFixtureIds: { organizations: string[]; users: string[] };
  backendIds: number[]; cases: CaseReceipt[]; cleanup: CleanupReceipt;
  errorCode?: string;
};
const root = fileURLToPath(new URL("../../../", import.meta.url));
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function sourceSnapshot(): Record<string, string> {
  const files = ["package.json", "package-lock.json", "server/tests/helpers/safeTestDatabase.ts",
    "v2/tests/infrastructure/structuralAuthority.native.test.ts",
    "server/db/migrations_v2/0305_v2_usable_structural_authority.sql",
    "server/db/migrations_v2/meta/_journal.json", "server/db/migrations_v2/meta/_history-integrity.json"];
  const visit = (directory: string) => {
    for (const entry of readdirSync(new URL(`../../../${directory}/`, import.meta.url), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      assert.ok(!entry.isSymbolicLink(), "Runtime source symlinks require explicit closure review");
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:[cm]?[jt]s|tsx|jsx)$/u.test(entry.name)) files.push(path);
    }
  };
  // Conservatively include all runtime sources, including transitive legacy
  // imports, rather than hand-picking directly imported authorization files.
  for (const directory of ["v2/src", "v2/infrastructure", "server", "shared"]) visit(directory);
  return Object.fromEntries([...new Set(files)].sort().map((path) => [path, digest(readFileSync(new URL(`../../../${path}`, import.meta.url)))]));
}
function code(error: unknown): string {
  if (error instanceof Error && error.message === "This setup link is invalid or expired.") return "INVALID_SETUP_LINK";
  if (error instanceof Error && error.message === "This password reset link is invalid or expired.") return "INVALID_RESET_LINK";
  const value = (error as { code?: unknown })?.code;
  return typeof value === "string" && /^[A-Z0-9_]+$/u.test(value) ? value : "ASSERTION_OR_RUNTIME_ERROR";
}
async function outcome(action: Promise<unknown>): Promise<Outcome> {
  try { await action; return { status: "fulfilled" }; }
  catch (error) { const value = code(error); return { status: "rejected", code: value, sqlstate: /^[0-9A-Z]{5}$/u.test(value) ? value : null }; }
}
function rejected(result: Outcome, allowed: readonly string[]) {
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.ok(allowed.includes(result.code), `Unexpected sanitized failure: ${result.code}`);
}
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, milliseconds = 6_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("Bounded coordination timeout"), { code: "HARNESS_TIMEOUT" })), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

type AuthorityWaitSample = { blockers: number[]; wait_event_type: string | null; wait_event: string | null; query: string; modes: string[] };

async function observeAuthorityWait(
  blocker: number, waiter: number, readSample: () => Promise<AuthorityWaitSample | undefined>,
  clock = { now: () => Date.now(), pause: () => new Promise<void>((resolve) => setTimeout(resolve, 20)) },
): Promise<Wait> {
  const until = clock.now() + 5_000;
  let previous: Wait | undefined;
  while (clock.now() < until) {
    const row = await bounded(readSample(), Math.max(1, until - clock.now()));
    if (clock.now() >= until) break;
    // PostgreSQL activity and lock-manager observations are not an atomic
    // snapshot. Never combine evidence from different incomplete samples.
    if (row?.blockers.includes(blocker) && row.wait_event_type === "Lock" && row.wait_event === "advisory"
      && /^SELECT v2_authority_entry\(/u.test(row.query) && row.modes.length > 0
      && row.modes.every((mode) => mode === "ShareLock" || mode === "ExclusiveLock")) {
      const current: Wait = { blocker, waiter, waitEventType: row.wait_event_type, waitEvent: row.wait_event, modes: row.modes, entryQuery: true };
      if (previous && JSON.stringify(previous) === JSON.stringify(current)) return current;
      previous = current;
    } else previous = undefined;
    await clock.pause();
  }
  throw Object.assign(new Error("No controller-visible lock wait"), { code: "NO_LOCK_WITNESS" });
}

/** Extractable synthetic checks: no native harness evaluation or DB needed. */
export async function testAuthorityWaitObserver() {
  const checks: string[] = [];
  const valid: AuthorityWaitSample = { blockers: [11], wait_event_type: "Lock", wait_event: "advisory", query: "SELECT v2_authority_entry($1::varchar[],$2::boolean)", modes: ["ExclusiveLock"] };
  const sequence = (rows: Array<AuthorityWaitSample | undefined>) => {
    let now = 0, reads = 0;
    return {
      read: async () => rows[Math.min(reads++, rows.length - 1)],
      clock: { now: () => now, pause: async () => { now += 20; } },
      reads: () => reads,
    };
  };
  const mixed = sequence([undefined, { ...valid, wait_event_type: null }, { ...valid, wait_event_type: "Client" },
    { ...valid, query: "BEGIN" }, { ...valid, modes: [] }, { ...valid, blockers: [33] },
    { ...valid, wait_event: "transactionid" }, valid, valid]);
  const witness = await observeAuthorityWait(11, 22, mixed.read, mixed.clock);
  assert.equal(mixed.reads(), 9); assert.deepEqual(witness, { blocker: 11, waiter: 22, waitEventType: "Lock", waitEvent: "advisory", modes: ["ExclusiveLock"], entryQuery: true });
  checks.push("mixed-samples-retry-to-complete-witness");
  const interrupted = sequence([valid, { ...valid, modes: [] }, valid, valid]);
  await observeAuthorityWait(11, 22, interrupted.read, interrupted.clock); assert.equal(interrupted.reads(), 4);
  checks.push("incomplete-sample-resets-confirmation");
  const changedMode = sequence([valid, { ...valid, modes: ["ShareLock"] }, { ...valid, modes: ["ShareLock"] }]);
  assert.deepEqual((await observeAuthorityWait(11, 22, changedMode.read, changedMode.clock)).modes, ["ShareLock"]);
  assert.equal(changedMode.reads(), 3); checks.push("mode-change-needs-matching-confirmation");
  // Both rows contain some evidence, but never all required evidence at once.
  let alternatingReads = 0, alternatingNow = 0;
  await assert.rejects(observeAuthorityWait(11, 22, async () => ++alternatingReads % 2
    ? { ...valid, wait_event_type: null } : { ...valid, blockers: [] },
  { now: () => alternatingNow, pause: async () => { alternatingNow += 20; } }), { code: "NO_LOCK_WITNESS" });
  assert.equal(alternatingNow, 5_000); assert.equal(alternatingReads, 250);
  checks.push("partial-evidence-never-combines-or-passes-timeout");
  let lateNow = 0;
  await assert.rejects(observeAuthorityWait(11, 22, async () => { lateNow = 5_000; return valid; },
    { now: () => lateNow, pause: async () => {} }), { code: "NO_LOCK_WITNESS" });
  checks.push("late-complete-sample-cannot-pass-deadline");
  for (const sqlstate of ["40P01", "55P03", "57014"]) {
    const failure = Object.assign(new Error("Synthetic observer failure"), { code: sqlstate });
    await assert.rejects(observeAuthorityWait(11, 22, async () => { throw failure; }), (error) => error === failure);
    checks.push(`observer-error-${sqlstate}-propagates`);
  }
  return { checks, nativeDatabase: false as const };
}

/** A pinned real pg connection, not a SQL/result mock. The only hook is before
 * dependent work, after the runtime adapter's own entry query has completed. */
function lane(client: Client) {
  let pause: { entered: ReturnType<typeof latch>; release: ReturnType<typeof latch> } | undefined;
  const query = async (text: string, values?: unknown[]) => {
    const result = await client.query(text, values);
    if (/^SELECT v2_authority_entry\(/u.test(text) && pause) {
      const current = pause; pause = undefined; current.entered.resolve();
      await bounded(current.release.promise);
    }
    return result;
  };
  const pinned = { query, release() {} } as unknown as PoolClient;
  const pool = { connect: async () => pinned, query } as unknown as Pool;
  return { pool, client: pinned, pauseEntry() { const current = { entered: latch(), release: latch() }; pause = current; return current; } };
}

export async function runStructuralAuthorityNative(): Promise<StructuralAuthorityNativeReceipt> {
  assert.equal(process.env.ACCESS05_NATIVE_TEST_OPT_IN, "1", "Explicit native test opt-in required");
  const connectionString = requireSafeTestDatabaseUrl();
  const url = new URL(connectionString);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55485"); assert.equal(url.pathname, "/access05_test");
  // URL query parameters can override pg's destination or inject session options.
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  const manifestPath = process.env.ACCESS05_NATIVE_FIXTURE_MANIFEST;
  const manifestPin = process.env.ACCESS05_NATIVE_FIXTURE_MANIFEST_SHA256;
  assert.ok(manifestPath, "Explicit independently reviewed fixture manifest required");
  assert.match(manifestPin ?? "", /^[a-f0-9]{64}$/u, "Explicit reviewed manifest digest required");
  const manifestBytes = readFileSync(manifestPath);
  assert.equal(digest(manifestBytes), manifestPin);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as StructuralAuthorityNativeFixtureManifest;
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.kind, "canonical-auth-proof-native-fixture");
  assert.equal(manifest.physicalSchemaProfile, "access05-public-catalog-v2");
  assert.deepEqual(manifest.knownDifferences, ["crm_revision_positive_check_absent_on_shared_foundation"]);
  assert.equal(manifest.targetFingerprint, digest("postgresql://127.0.0.1:55485/access05_test"));
  assert.match(manifest.foundation.sourceHead, /^[a-f0-9]{40}$/u); assert.match(manifest.foundation.exportSha256, /^[a-f0-9]{64}$/u);
  assert.match(manifest.physicalSchemaSha256, /^[a-f0-9]{64}$/u);
  assert.ok(manifest.foundation.sourceFiles["shared/schema.ts"]);
  for (const [path, expected] of Object.entries(manifest.foundation.sourceFiles)) {
    assert.match(path, /^(?:shared|server\/prepress)\/[A-Za-z0-9_./-]+\.ts$/u); assert.ok(!path.includes(".."));
    assert.equal(digest(execFileSync("git", ["show", `${manifest.foundation.sourceHead}:${path}`], { cwd: root })), expected);
  }
  assert.ok(manifest.migrations.length > 0); assert.equal(new Set(manifest.migrations.map((migration) => migration.path)).size, manifest.migrations.length);
  for (const migration of manifest.migrations) {
    assert.match(migration.path, /^server\/db\/migrations_v2\/\d{4}_[a-z0-9_]+\.sql$/u);
    assert.ok(migration.source === "foundation-commit" || migration.source === "candidate");
    const bytes = migration.source === "candidate" ? readFileSync(new URL(`../../../${migration.path}`, import.meta.url)) : execFileSync("git", ["show", `${manifest.foundation.sourceHead}:${migration.path}`], { cwd: root });
    assert.equal(digest(bytes), migration.sha256);
  }
  assert.ok(manifest.migrations.some((migration) => migration.path === "server/db/migrations_v2/0305_v2_usable_structural_authority.sql" && migration.source === "candidate"));
  const sourceDigests = sourceSnapshot();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim().length > 0;
  const receipt: StructuralAuthorityNativeReceipt = {
    schemaVersion: 1, suite: "ACCESS05-native", status: "failed",
    source: { head, dirty, attribution: dirty ? "dirty-tree" : "commit", digests: sourceDigests },
    target: { host: url.hostname, port: Number(url.port), database: "access05_test", fingerprint: digest("postgresql://127.0.0.1:55485/access05_test") },
    fixture: { kind: manifest.kind, physicalSchemaProfile: manifest.physicalSchemaProfile, knownDifferences: manifest.knownDifferences, manifestSha256: manifestPin!, foundationSourceHead: manifest.foundation.sourceHead, foundationExportSha256: manifest.foundation.exportSha256, migrationDigests: Object.fromEntries(manifest.migrations.map((migration) => [migration.path, migration.sha256])), physicalSchemaSha256: manifest.physicalSchemaSha256, fullHistoricalMigrationRehearsal: false },
    ownedFixtureIds: { organizations: [], users: [] }, backendIds: [], cases: [], cleanup: { status: "not_started" },
  };
  // Both gates above precede pg and all runtime imports, even when URL is absent.
  const { Client: NativeClient } = await import("pg");
  const { PostgresTeamAccess } = await import("../../infrastructure/organization/postgresTeamAccess.js");
  const { PermissionSetPrincipalIssuer } = await import("../../src/authorization/permissionSets.js");
  const { PostgresPermissionAuthorityReader } = await import("../../infrastructure/authorization/postgresPermissionAuthorityRead.js");
  const { PostgresPortalCredentialLifecycle, PostgresStandaloneStaffCredentialVerifier } = await import("../../infrastructure/authentication/standaloneStaffAuth.js");
  const { isUsableStaffPasswordHash, isUsableStaffLoginEmail } = await import("../../src/authorization/staffCredentialReadiness.js");
  const { PostgresProofingTransactionRunner } = await import("../../infrastructure/proofing/postgresProofingTransaction.js");
  const { PostgresProofRecipientAccess } = await import("../../infrastructure/authorization/postgresProofRecipientAccess.js");
  const { enterAuthorityMutation } = await import("../../infrastructure/authorization/postgresAuthorityMutation.js");
  const { default: bcrypt } = await import("bcryptjs");
  const clients = Array.from({ length: 3 }, (_, i) => new NativeClient({ connectionString, application_name: `access05-native-${i}`, connectionTimeoutMillis: 5_000, query_timeout: 12_000, options: "-c statement_timeout=10000 -c lock_timeout=8000 -c idle_in_transaction_session_timeout=15000" }));
  const [controller, a, b] = clients;
  const A = lane(a), B = lane(b);
  // Fail before any delivery/readiness implementation if a replay regresses
  // into provider work. SQL adapters themselves remain real native adapters.
  const noCommunications = new Proxy({}, { get: () => () => { throw Object.assign(new Error("Native authority suite forbids communications"), { code: "PROVIDER_FORBIDDEN" }); } }) as NonNullable<ConstructorParameters<typeof PostgresTeamAccess>[1]>;
  const teamA = new PostgresTeamAccess(A.pool, noCommunications), teamB = new PostgresTeamAccess(B.pool, noCommunications);
  const ownedOrganizations = receipt.ownedFixtureIds.organizations, ownedUsers = receipt.ownedFixtureIds.users;
  const connected: Client[] = [];
  type Fixture = { org: string; users: string[]; sets: string[]; customer: string; contact: string; access: string; portalUser: string; token: string; password: string };
  let baseline: unknown;
  let current: CaseReceipt | undefined;
  const snapshotBaseline = async () => ({
    organizations: (await controller.query("SELECT to_jsonb(o) value FROM organizations o WHERE NOT(id=ANY($1::varchar[])) ORDER BY id", [ownedOrganizations])).rows,
    states: (await controller.query("SELECT to_jsonb(s) value FROM v2_permission_organization_state s WHERE NOT(organization_id=ANY($1::varchar[])) ORDER BY organization_id", [ownedOrganizations])).rows,
    users: (await controller.query("SELECT to_jsonb(u) value FROM users u WHERE NOT(id=ANY($1::varchar[])) ORDER BY id", [ownedUsers])).rows,
    identities: (await controller.query("SELECT to_jsonb(i) value FROM auth_identities i WHERE NOT(user_id=ANY($1::varchar[])) ORDER BY id", [ownedUsers])).rows,
    catalog: (await controller.query("SELECT to_jsonb(c) value FROM v2_permission_capabilities c ORDER BY id")).rows,
  });
  const tx = async (client: Client, orgs: string[], work: () => Promise<void>, exclusive = false) => {
    await client.query("BEGIN");
    try { await client.query("SELECT v2_authority_entry($1::varchar[],$2::boolean)", [orgs, exclusive]); await work(); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  };
  const cleanupOwned = async (organizationIds: string[], userIds: string[], result: CleanupReceipt) => {
    const started = Date.now();
    try {
      // Discovery is outside BEGIN: previously deleted provenance IDs must not
      // enlarge the authority entry scope. Never discover by prefix or tenant name.
      const liveOrgs = organizationIds.length ? (await controller.query<{ id: string }>("SELECT id FROM organizations WHERE id=ANY($1::varchar[]) ORDER BY id", [organizationIds])).rows.map((row) => row.id) : [];
      const liveUsers = userIds.length ? (await controller.query<{ id: string }>("SELECT id FROM users WHERE id=ANY($1::varchar[]) ORDER BY id", [userIds])).rows.map((row) => row.id) : [];
      result.liveOwnedOrganizations = liveOrgs.length; result.liveOwnedUsers = liveUsers.length;
      result.deletedOrganizations = 0; result.deletedUsers = 0;
      result.remainingOwnedOrganizations = liveOrgs.length; result.remainingOwnedUsers = liveUsers.length;
      let deletedOrganizations = 0, deletedUsers = 0;
      if (liveOrgs.length || liveUsers.length) await tx(controller, liveOrgs, async () => {
        await controller.query("DELETE FROM v2_portal_permission_set_assignments WHERE organization_id=ANY($1::varchar[])", [liveOrgs]);
        await controller.query("DELETE FROM v2_staff_permission_set_assignments WHERE organization_id=ANY($1::varchar[])", [liveOrgs]);
        await controller.query("DELETE FROM v2_principal_attributions WHERE organization_id=ANY($1::varchar[])", [liveOrgs]);
        deletedOrganizations = (await controller.query("DELETE FROM organizations WHERE id=ANY($1::varchar[])", [liveOrgs])).rowCount ?? 0;
        assert.equal(deletedOrganizations, liveOrgs.length);
        const links = await controller.query("SELECT 1 FROM users WHERE id=ANY($1::varchar[]) AND last_active_org_id IS NOT NULL", [liveUsers]);
        assert.equal(links.rowCount, 0, "Canonical ON DELETE SET NULL must execute under enrolled exclusive entry");
        deletedUsers = (await controller.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [liveUsers])).rowCount ?? 0;
        assert.equal(deletedUsers, liveUsers.length);
        await controller.query("SET CONSTRAINTS ALL IMMEDIATE");
        result.remainingOwnedOrganizations = Number((await controller.query("SELECT count(*)::int n FROM organizations WHERE id=ANY($1::varchar[])", [organizationIds])).rows[0].n);
        result.remainingOwnedUsers = Number((await controller.query("SELECT count(*)::int n FROM users WHERE id=ANY($1::varchar[])", [userIds])).rows[0].n);
        assert.equal(result.remainingOwnedOrganizations, 0); assert.equal(result.remainingOwnedUsers, 0);
      }, true);
      result.deletedOrganizations = deletedOrganizations; result.deletedUsers = deletedUsers;
      result.status = "passed";
    } catch (error) {
      result.status = "failed"; result.errorCode = code(error);
      // A failed transaction must not report its uncommitted zero-row reads as
      // successful cleanup. If verification also fails, leave counts unknown.
      delete result.remainingOwnedOrganizations; delete result.remainingOwnedUsers;
      try {
        result.remainingOwnedOrganizations = organizationIds.length ? Number((await controller.query("SELECT count(*)::int n FROM organizations WHERE id=ANY($1::varchar[])", [organizationIds])).rows[0].n) : 0;
        result.remainingOwnedUsers = userIds.length ? Number((await controller.query("SELECT count(*)::int n FROM users WHERE id=ANY($1::varchar[])", [userIds])).rows[0].n) : 0;
      } catch { /* Original cleanup failure remains fatal; no guessed counts. */ }
      throw error;
    }
    finally { result.durationMs = Date.now() - started; }
  };
  const actor = async (f: Fixture, index = 0): Promise<StaffPrincipal> => {
    const issued = await new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(controller)).issueStaff({ subjectId: f.users[index], authenticationMethod: "session", authenticatedAt: new Date() }, f.org);
    if (!issued.ok) throw issued.error;
    return issued.value;
  };
  const context = (principal: StaffPrincipal, key: string = randomUUID()) => {
    const expectedAuthorityRevision = principal.authority.authorityRevision;
    assert.ok(typeof expectedAuthorityRevision === "string", "Native actor must carry a concrete authority revision");
    return { businessRequestId: key, expectedAuthorityRevision };
  };
  const floor = async (f: Fixture) => Number((await controller.query("SELECT count(*)::int n FROM v2_usable_structural_administrators($1)", [f.org])).rows[0].n);
  const state = async (f: Fixture) => (await controller.query(`SELECT
    (SELECT count(*)::int FROM v2_operation_requests WHERE organization_id=$1) requests,
    (SELECT count(*)::int FROM v2_permission_audit_events WHERE organization_id=$1) audits,
    (SELECT count(*)::int FROM v2_principal_attributions WHERE organization_id=$1) attributions,
    (SELECT authority_revision::text FROM v2_permission_organization_state WHERE organization_id=$1) revision,
    (SELECT jsonb_agg(to_jsonb(m) ORDER BY user_id) FROM user_organizations m WHERE organization_id=$1) memberships,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY user_id,permission_set_id) FROM v2_staff_permission_set_assignments s WHERE organization_id=$1) assignments,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM v2_permission_sets s WHERE organization_id=$1) sets,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY permission_set_id,capability_id) FROM v2_permission_set_capabilities c WHERE organization_id=$1) capabilities,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY capability_id) FROM v2_organization_portal_capability_defaults d WHERE organization_id=$1) portal_defaults,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM v2_operation_requests r WHERE organization_id=$1) receipts,
    (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM users u WHERE id=ANY($2::varchar[])) users,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM auth_identities i WHERE user_id=ANY($2::varchar[])) identities`, [f.org, [...f.users, f.portalUser]])).rows[0];
  const fixture = async (administrators = 2): Promise<Fixture> => {
    const f: Fixture = { org: randomUUID(), users: [randomUUID(), randomUUID(), randomUUID()], sets: [randomUUID(), randomUUID(), randomUUID()], customer: randomUUID(), contact: randomUUID(), access: randomUUID(), portalUser: randomUUID(), token: randomUUID(), password: `Fixture-${randomUUID()}` };
    ownedOrganizations.push(f.org); ownedUsers.push(...f.users, f.portalUser);
    const passwordHash = await bcrypt.hash(f.password, 4);
    await tx(controller, [f.org], async () => {
      await controller.query("INSERT INTO organizations(id,name,slug) VALUES($1,'ACCESS05 native fixture',$2)", [f.org, `access05-${f.org}`]);
      for (const [i, user] of f.users.entries()) {
        await controller.query("INSERT INTO users(id,email,account_type,must_set_password,is_platform_developer,last_active_org_id) VALUES($1,$2,'INTERNAL_USER',false,$3,$4)", [user, `${user}@example.invalid`, i === 2, f.org]);
        await controller.query("INSERT INTO auth_identities(user_id,provider,password_hash) VALUES($1,'password',$2)", [user, passwordHash]);
        await controller.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,$3,true)", [user, f.org, i < administrators ? (i === 0 ? "owner" : "admin") : "member"]);
        await controller.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,$3,$3,'staff')", [f.sets[i], f.org, `native-${i}`]);
        await controller.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'order.view')", [f.org, f.sets[i]]);
        await controller.query("DELETE FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2", [f.org, user]);
        await controller.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id,active,assignment_source) VALUES($1,$2,$3,true,'manual')", [f.org, user, f.sets[i]]);
      }
      await controller.query("INSERT INTO users(id,email,account_type,role,must_set_password,last_active_org_id) VALUES($1,$2,'PORTAL_CUSTOMER','customer',false,$3)", [f.portalUser, `${f.portalUser}@example.invalid`, f.org]);
      await controller.query("INSERT INTO customers(id,organization_id,company_name) VALUES($1,$2,'ACCESS05 native customer')", [f.customer, f.org]);
      await controller.query("INSERT INTO customer_contacts(id,organization_id,customer_id,first_name,last_name,email,status) VALUES($1,$2,$3,'Native','Contact',$4,'active')", [f.contact, f.org, f.customer, `${f.portalUser}@example.invalid`]);
      await controller.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')", [f.org, f.customer, f.contact]);
      await controller.query("INSERT INTO customer_portal_access(id,organization_id,customer_id,contact_id,user_id,email,status) VALUES($1,$2,$3,$4,$5,$6,'PENDING_INVITE')", [f.access, f.org, f.customer, f.contact, f.portalUser, `${f.portalUser}@example.invalid`]);
      await controller.query("INSERT INTO customer_portal_invite_tokens(organization_id,access_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [f.org, f.access, digest(f.token)]);
    }, true);
    assert.equal(await floor(f), administrators);
    return f;
  };
  const waitFor = async (blocker: number, waiter: number): Promise<Wait> => {
    return observeAuthorityWait(blocker, waiter, async () => {
      await controller.query("SELECT pg_stat_clear_snapshot()");
      return (await controller.query<AuthorityWaitSample>(`SELECT a.wait_event_type,a.wait_event,a.query,pg_blocking_pids(a.pid) blockers,
        COALESCE((SELECT array_agg(l.mode::text ORDER BY l.mode) FROM pg_locks l
          WHERE l.pid=a.pid AND l.locktype='advisory' AND (l.classid=73050305 OR (l.classid=0 AND l.objid=73050305)) AND NOT l.granted),'{}'::text[]) modes
        FROM pg_stat_activity a WHERE a.pid=$1`, [waiter])).rows[0];
    });
  };
  const race = async (winner: () => Promise<unknown>, loser: () => Promise<unknown>, duringWait?: () => Promise<void>) => {
    const pause = A.pauseEntry();
    const first = outcome(winner()); let second: Promise<Outcome> | undefined;
    let coordinationError: unknown;
    try {
      await bounded(pause.entered.promise);
      second = outcome(loser());
      current!.waits.push(await waitFor(receipt.backendIds[1], receipt.backendIds[2]));
      await duringWait?.();
    } catch (error) { coordinationError = error; }
    finally { pause.release.resolve(); }
    const results = await Promise.all([first, second ?? Promise.resolve<Outcome>({ status: "rejected", code: "NOT_STARTED", sqlstate: null })]);
    current!.outcomes.push(...results);
    if (coordinationError) throw coordinationError;
    return results;
  };
  const runCase = async (id: string, work: () => Promise<void>) => {
    const organizationStart = ownedOrganizations.length, userStart = ownedUsers.length;
    current = { id, status: "failed", outcomes: [], waits: [], counts: {}, cleanup: { status: "not_started" } }; receipt.cases.push(current);
    try {
      let bodyFailed = false, bodyError: unknown;
      try {
        await work(); assert.ok(current.outcomes.every((result) => result.status !== "rejected" || !["40P01", "55P03", "57014"].includes(result.code)));
        // Preserve the surviving-tenant invariant before case teardown, rather
        // than allowing the final empty-fixture check to become vacuous.
        const floorless = await controller.query("SELECT count(*)::int n FROM organizations o WHERE delete_state='active' AND NOT is_archived AND status IN ('active','trial') AND (NOT EXISTS(SELECT 1 FROM v2_permission_organization_state s WHERE s.organization_id=o.id AND s.admin_floor_enforced) OR NOT EXISTS(SELECT 1 FROM v2_usable_structural_administrators(o.id)))");
        current.counts.zeroAuthorityActiveTenants = Number(floorless.rows[0].n); assert.equal(current.counts.zeroAuthorityActiveTenants, 0);
      } catch (error) { bodyFailed = true; bodyError = error; }
      const cleanupStarted = Date.now();
      try {
        try { await a.query("ROLLBACK"); } finally { await b.query("ROLLBACK"); }
        await cleanupOwned(ownedOrganizations.slice(organizationStart), ownedUsers.slice(userStart), current.cleanup);
      } catch (error) {
        current.cleanup.status = "failed"; current.cleanup.errorCode ??= code(error); current.cleanup.durationMs ??= Date.now() - cleanupStarted;
        if (!bodyFailed) throw error;
      }
      if (bodyFailed) throw bodyError;
      current.status = "passed";
    }
    catch (error) {
      current.errorCode = code(error);
      if (error instanceof Error) {
        current.errorName = ["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError"].includes(error.name) ? error.name : "Error";
        // Locations only: never serialize error messages, SQL details, inputs or credentials.
        current.errorFrames = (error.stack ?? "").split("\n").flatMap((line) => {
          const match = line.match(/structuralAuthority\.native\.test\.ts:(\d{1,6}):(\d{1,6})\)?$/u);
          return match ? [`structuralAuthority.native.test.ts:${match[1]}:${match[2]}`] : [];
        }).slice(0, 8);
      }
      throw error;
    }
  };
  try {
    for (const client of clients) { await client.connect(); connected.push(client); }
    for (const client of clients) receipt.backendIds.push(Number((await client.query("SELECT pg_backend_pid() pid")).rows[0].pid));
    assert.equal(new Set(receipt.backendIds).size, 3);
    const server = (await controller.query("SELECT current_database() database,host(inet_server_addr()) address,inet_server_port() port,current_setting('server_version') version")).rows[0];
    assert.equal(server.database, "access05_test"); assert.equal(server.address, "127.0.0.1"); assert.equal(server.port, 55485); assert.match(server.version, /^17\.10(?:\s|$)/u);
    receipt.target.serverVersion = server.version; receipt.target.serverAddress = server.address;
    await controller.query("SELECT 'v2_authority_entry(character varying[],boolean)'::regprocedure,'v2_usable_structural_administrators(character varying)'::regprocedure");
    // 0000 is a production-aligned marker, not an empty-database foundation.
    // This explicitly labeled, pinned canonical fixture is not a fabricated
    // 299-migration rehearsal and never inserts migration-ledger rows.
    assert.equal(digest(JSON.stringify((await controller.query(STRUCTURAL_AUTHORITY_SCHEMA_QUERY)).rows[0].shape)), manifest.physicalSchemaSha256);
    const lastOrgFk = await controller.query("SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=ANY(k.conkey) JOIN pg_attribute target ON target.attrelid=k.confrelid AND target.attnum=ANY(k.confkey) WHERE k.conrelid='users'::regclass AND k.confrelid='organizations'::regclass AND k.contype='f' AND k.convalidated AND k.confdeltype='n' AND cardinality(k.conkey)=1 AND cardinality(k.confkey)=1 AND a.attname='last_active_org_id' AND target.attname='id'");
    assert.equal(lastOrgFk.rowCount, 1);
    baseline = await snapshotBaseline();

    await runCase("staff-email-sql-js-actual-verifier-parity", async () => {
      const own = await fixture(), email = `${own.users[1]}@example.invalid`;
      const verifier = new PostgresStandaloneStaffCredentialVerifier(A.pool);
      const vectors: Array<[string, string, boolean]> = [
        ["canonical", email, true], ["uppercase", email.toUpperCase(), true],
        ["tab-only", "\t", false], ["newline-only", "\n", false],
        ["space-padded", ` ${email} `, false], ["tab-prefixed", `\t${email}`, false],
        ["newline-suffixed", `${email}\n`, false], ["crlf-suffixed", `${email}\r\n`, false],
      ];
      const before = await state(own);
      for (const [label, stored, ready] of vectors) {
        await a.query("BEGIN");
        try {
          await enterAuthorityMutation(a, [own.org], true);
          await a.query("UPDATE users SET email=$2 WHERE id=$1", [own.users[1], stored]);
          assert.equal(isUsableStaffLoginEmail(stored), ready, label);
          assert.equal((await a.query("SELECT v2_staff_login_ready($1) ready", [own.users[1]])).rows[0].ready, ready, label);
          // Match the mounted login route's input trimming, while exercising the
          // real credential verifier and bcrypt comparison on the same native TX.
          assert.equal(Boolean(await verifier.authenticate(stored.trim(), own.password)), ready, label);
          assert.equal(Boolean(await verifier.currentStaff(own.users[1])), ready, label);
          assert.equal((await a.query("SELECT count(*)::int n FROM v2_usable_structural_administrators($1)", [own.org])).rows[0].n, ready ? 2 : 1, label);
          current!.counts[label] = ready ? 1 : 0;
        } finally { await a.query("ROLLBACK"); }
      }
      assert.deepEqual(await state(own), before);
    });

    await runCase("staff-password-strict-length-sql-js-verifier-parity", async () => {
      const own = await fixture(), email = `${own.users[1]}@example.invalid`;
      const valid = (await controller.query("SELECT password_hash FROM auth_identities WHERE user_id=$1", [own.users[1]])).rows[0].password_hash as string;
      const verifier = new PostgresStandaloneStaffCredentialVerifier(A.pool);
      const vectors: Array<[string, string, boolean]> = [
        ["canonical-60", valid, true], ["terminal-newline-61", `${valid}\n`, false],
        ["terminal-crlf-62", `${valid}\r\n`, false], ["terminal-space-61", `${valid} `, false],
        ["truncated-59", valid.slice(0, -1), false], ["newline-in-60", `${valid.slice(0, -1)}\n`, false],
      ];
      const before = await state(own);
      for (const [label, value, ready] of vectors) {
        await a.query("BEGIN");
        try {
          await enterAuthorityMutation(a, [own.org], true);
          await a.query("UPDATE auth_identities SET password_hash=$2 WHERE user_id=$1", [own.users[1], value]);
          assert.equal(isUsableStaffPasswordHash(value), ready, label);
          assert.equal((await a.query("SELECT v2_staff_login_ready($1) ready", [own.users[1]])).rows[0].ready, ready, label);
          assert.equal(Boolean(await verifier.authenticate(email, own.password)), ready, label);
          assert.equal(Boolean(await verifier.currentStaff(own.users[1])), ready, label);
          current!.counts[label] = ready ? 1 : 0;
        } finally { await a.query("ROLLBACK"); }
      }
      assert.deepEqual(await state(own), before);
    });

    await runCase("new-tenant-retains-six-0293-portal-defaults", async () => {
      const own = await fixture(1);
      const defaults = (await controller.query("SELECT capability_id FROM v2_organization_portal_capability_defaults WHERE organization_id=$1 ORDER BY capability_id", [own.org])).rows.map((row) => row.capability_id);
      assert.deepEqual(defaults, ["invoice.view", "order.view", "payment.record", "payment.view", "proof.respond", "quote.view"]);
      current!.counts.defaultCapabilities = defaults.length;
    });

    await runCase("state-delete-rebootstrap-cannot-regrant", async () => {
      const own = await fixture(1);
      await tx(controller, [own.org], async () => {
        await controller.query("DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id IN (SELECT id FROM v2_permission_sets WHERE organization_id=$1 AND source_template_key IS NOT NULL)", [own.org]);
        await controller.query("DELETE FROM v2_organization_portal_capability_defaults WHERE organization_id=$1 AND capability_id='invoice.view'", [own.org]);
      });
      const before = await state(own);
      await tx(controller, [own.org], async () => { await controller.query("SELECT v2_bootstrap_permission_organization($1)", [own.org]); });
      assert.deepEqual(await state(own), before);
      const result = await outcome(tx(a, [own.org], async () => {
        await a.query("DELETE FROM v2_permission_organization_state WHERE organization_id=$1", [own.org]);
        await a.query("SELECT v2_bootstrap_permission_organization($1)", [own.org]);
      }));
      current!.outcomes.push(result); rejected(result, ["23514"]);
      assert.deepEqual(await state(own), before);
      assert.equal((await controller.query("SELECT count(*)::int n FROM v2_organization_authority_enrollments WHERE organization_id=$1", [own.org])).rows[0].n, 1);
    });

    for (const operation of ["disable", "weaken-role", "assignment"] as const) await runCase(`race-${operation}-fresh-loser-retry`, async () => {
      const f = await fixture(), other = await fixture(1), key1 = randomUUID(), key2 = randomUUID();
      const emptySet = randomUUID();
      if (operation === "assignment") {
        await tx(controller, [f.org], async () => { await controller.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,'empty','empty','staff')", [emptySet, f.org]); });
      }
      const initial = await actor(f);
      const change = (team: InstanceType<typeof PostgresTeamAccess>, index: number, principal: StaffPrincipal, key: string) => operation === "disable"
        ? team.setMembershipActive(principal, f.org, f.users[index], false, context(principal, key))
        : operation === "assignment" ? team.replaceStaffAssignments(principal, f.org, f.users[index], [emptySet], context(principal, key))
          : team.updateCustomSet(principal, f.org, f.sets[index], { name: `native-${index}`, capabilities: ["order.view"], active: false }, context(principal, key));
      const results = await race(() => change(teamA, 1, initial, key1), () => change(teamB, 0, initial, key2), async () => {
        await tx(controller, [other.org], async () => { await controller.query("UPDATE user_organizations SET updated_at=now() WHERE organization_id=$1 AND user_id=$2", [other.org, other.users[1]]); });
        current!.counts.unrelatedTenantProgress = 1;
      });
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], ["STALE_STATE"]); assert.equal(await floor(f), 1);
      const before = await state(f), fresh = await actor(f);
      const retry = await outcome(change(teamB, 0, fresh, key2)); current!.outcomes.push(retry); rejected(retry, ["CONFLICT"]);
      assert.deepEqual(await state(f), before); current!.counts.survivingAdministrators = await floor(f);
      await change(teamA, 1, fresh, key1); assert.deepEqual(await state(f), before);
      const changedBody = await outcome(change(teamA, 0, fresh, key1));
      rejected(changedBody, ["IDEMPOTENCY_CONFLICT"]); assert.deepEqual(await state(f), before);
    });

    for (const mutation of ["demotion", "remove"] as const) await runCase(`race-structural-${mutation}-deferred-floor`, async () => {
      const own = await fixture();
      const mutate = async (client: PoolClient, userId: string) => {
        await client.query("BEGIN");
        try {
          await enterAuthorityMutation(client, [own.org]);
          await client.query(mutation === "demotion" ? "UPDATE user_organizations SET role='member' WHERE organization_id=$1 AND user_id=$2" : "DELETE FROM user_organizations WHERE organization_id=$1 AND user_id=$2", [own.org, userId]);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK"); throw error; }
      };
      const results = await race(() => mutate(A.client, own.users[1]), () => mutate(B.client, own.users[0]));
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], ["23514"]); assert.equal(await floor(own), 1);
      current!.counts.survivingAdministrators = 1;
    });

    await runCase("race-enrollment-versus-removal", async () => {
      const f = await fixture(1);
      await tx(controller, [f.org], async () => { await controller.query("UPDATE user_organizations SET role='admin',is_active=false WHERE organization_id=$1 AND user_id=$2", [f.org, f.users[1]]); });
      const p = await actor(f);
      const results = await race(() => teamA.setMembershipActive(p, f.org, f.users[1], true, context(p)), () => teamB.setMembershipActive(p, f.org, f.users[0], false, context(p)));
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], ["STALE_STATE"]); assert.equal(await floor(f), 2);
      const fresh = await actor(f); await teamB.setMembershipActive(fresh, f.org, f.users[0], false, context(fresh)); assert.equal(await floor(f), 1);
    });

    await runCase("replay-same-actor-body-and-fresh-authority", async () => {
      const f = await fixture(), p = await actor(f), key = randomUUID();
      await teamA.setMembershipActive(p, f.org, f.users[1], false, context(p, key));
      const before = await state(f);
      await teamB.setMembershipActive(p, f.org, f.users[1], false, context(p, key)); assert.deepEqual(await state(f), before);
      const different = await actor(f, 2);
      rejected(await outcome(teamB.setMembershipActive(different, f.org, f.users[1], false, context(different, key))), ["FORBIDDEN"]);
      rejected(await outcome(teamB.setMembershipActive(p, f.org, f.users[0], false, context(p, key))), ["IDEMPOTENCY_CONFLICT"]);
      await tx(controller, [f.org], async () => { await controller.query("UPDATE user_organizations SET role=(CASE WHEN user_id=$2 THEN 'member' ELSE 'admin' END)::org_member_role WHERE organization_id=$1 AND user_id=ANY($3::varchar[])", [f.org, f.users[0], [f.users[0], f.users[2]]]); });
      const revoked = await state(f);
      rejected(await outcome(teamB.setMembershipActive(p, f.org, f.users[1], false, context(p, key))), ["FORBIDDEN"]);
      assert.deepEqual(await state(f), revoked); current!.counts.successfulRequests = Number(before.requests);
    });

    const inputs: Array<[string, string, boolean]> = [
      ["membership-delete", "DELETE FROM user_organizations WHERE organization_id=$1 AND user_id=$2", false],
      ["membership-inactive", "UPDATE user_organizations SET is_active=false WHERE organization_id=$1 AND user_id=$2", false],
      ["membership-demotion", "UPDATE user_organizations SET role='member' WHERE organization_id=$1 AND user_id=$2", false],
      ["user-delete", "DELETE FROM users WHERE id=$2", true],
      ["user-account-type", "UPDATE users SET account_type='PORTAL_CUSTOMER' WHERE id=$2", true],
      ["user-email-blank", "UPDATE users SET email=' ' WHERE id=$2", true],
      ["user-email-null", "UPDATE users SET email=NULL WHERE id=$2", true],
      ["user-password-pending", "UPDATE users SET must_set_password=true WHERE id=$2", true],
      ["identity-delete", "DELETE FROM auth_identities WHERE user_id=$2", true],
      ["identity-provider", "UPDATE auth_identities SET provider='google' WHERE user_id=$2", true],
      ["identity-user-rebind", "UPDATE auth_identities SET user_id=$4 WHERE user_id=$2", true],
      ["identity-hash-null", "UPDATE auth_identities SET password_hash=NULL WHERE user_id=$2", true],
      ["identity-hash-invalid", "UPDATE auth_identities SET password_hash='not-a-hash' WHERE user_id=$2", true],
      ["assignment-delete", "DELETE FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2", false],
      ["assignment-inactive", "UPDATE v2_staff_permission_set_assignments SET active=false WHERE organization_id=$1 AND user_id=$2", false],
      ["assignment-user-rebind", "UPDATE v2_staff_permission_set_assignments SET user_id=$4 WHERE organization_id=$1 AND user_id=$2", false],
      ["set-inactive", "UPDATE v2_permission_sets SET active=false WHERE organization_id=$1 AND id=$3", false],
      ["set-principal-kind", "UPDATE v2_permission_sets SET principal_kind='portal' WHERE organization_id=$1 AND id=$3", false],
      ["set-capability-delete", "DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1 AND permission_set_id=$3", false],
      ["state-false", "UPDATE v2_permission_organization_state SET admin_floor_enforced=false WHERE organization_id=$1", false],
      ["state-missing", "DELETE FROM v2_permission_organization_state WHERE organization_id=$1", false],
      ["lifecycle-invalid", "UPDATE organizations SET delete_state='invalid' WHERE id=$1", false],
    ];
    for (const [id, sql, exclusive] of inputs) await runCase(`floor-input-${id}`, async () => {
      const f = await fixture(1);
      const before = await state(f);
      // Explicit casts consume every parameter even when the mutation uses only $2.
      const result = await outcome(tx(a, [f.org], async () => { await a.query(`WITH parameters AS (SELECT $1::varchar,$2::varchar,$3::varchar,$4::varchar) ${sql}`, [f.org, f.users[0], f.sets[0], id === "assignment-user-rebind" ? f.users[1] : f.portalUser]); }, exclusive));
      current!.outcomes.push(result); rejected(result, ["23514"]); assert.equal(await floor(f), 1); assert.deepEqual(await state(f), before);
      current!.counts.survivingAdministrators = 1;
    });

    await runCase("catalog-active-input-rollback", async () => {
      await fixture(1);
      const before = await snapshotBaseline();
      const result = await outcome(tx(a, [], async () => { await a.query("UPDATE v2_permission_capabilities SET active=false WHERE id='order.view'"); }, true));
      current!.outcomes.push(result); rejected(result, ["23514"]); assert.deepEqual(await snapshotBaseline(), before);
    });

    await runCase("pending-invite-platform-and-capability-only-not-floor", async () => {
      const pending = await fixture(1);
      await tx(controller, [pending.org], async () => {
        await controller.query("INSERT INTO org_invites(id,org_id,email,role,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,'admin',$4,now()+interval '1 hour',$5)", [randomUUID(), pending.org, `${randomUUID()}@example.invalid`, digest(randomUUID()), pending.users[0]]);
        await controller.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'permissions.manageSets'),($1,$2,'permissions.assignStaff')", [pending.org, pending.sets[2]]);
      });
      assert.equal(await floor(pending), 1);
      const p = await actor(pending); const before = await state(pending);
      rejected(await outcome(teamA.setMembershipActive(p, pending.org, pending.users[0], false, context(p))), ["CONFLICT"]);
      assert.deepEqual(await state(pending), before);
    });

    await runCase("frozen-first-write-and-unenrolled-tables", async () => {
      const f = await fixture(1);
      const before = await state(f);
      for (const statement of [
        "INSERT INTO users(id,email) VALUES($1,$2)",
        "UPDATE users SET email=email WHERE id=$1", "DELETE FROM auth_identities WHERE user_id=$1",
        "UPDATE user_organizations SET role=role WHERE organization_id=$1",
        "UPDATE v2_staff_permission_set_assignments SET active=active WHERE organization_id=$1",
        "UPDATE v2_permission_sets SET active=active WHERE organization_id=$1",
        "DELETE FROM v2_permission_set_capabilities WHERE organization_id=$1",
        "UPDATE v2_permission_organization_state SET admin_floor_enforced=false WHERE organization_id=$1",
        "UPDATE v2_permission_capabilities SET active=active WHERE id=$1",
        "UPDATE customer_portal_access SET status=status WHERE organization_id=$1",
        "DELETE FROM customer_portal_invite_tokens WHERE organization_id=$1",
        "DELETE FROM v2_portal_password_reset_tokens WHERE organization_id=$1",
        "DELETE FROM v2_portal_permission_set_assignments WHERE organization_id=$1",
        "DELETE FROM org_invites WHERE org_id=$1",
        "UPDATE organizations SET status=status WHERE id=$1",
        "TRUNCATE v2_staff_authority_enrollments",
      ]) {
        await a.query("BEGIN");
        const count = statement.includes("$2") ? 2 : statement.includes("$1") ? 1 : 0;
        const result = await outcome(a.query(statement, count === 2 ? [randomUUID(), `${randomUUID()}@example.invalid`] : count === 1 ? [f.org] : []));
        await a.query("ROLLBACK"); current!.outcomes.push(result); rejected(result, ["25000"]);
      }
      assert.deepEqual(await state(f), before);
    });

    await runCase("bootstrap-pending-and-lifecycle-reactivation", async () => {
      const f = await fixture(1);
      const org = randomUUID(); ownedOrganizations.push(org);
      const result = await outcome(tx(a, [org], async () => {
        await a.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Pending-only bootstrap',$2)", [org, `access05-${org}`]);
        await a.query("INSERT INTO org_invites(id,org_id,email,role,token_hash,expires_at,created_by_user_id) VALUES($1,$2,$3,'admin',$4,now()+interval '1 hour',$5)", [randomUUID(), org, `${randomUUID()}@example.invalid`, digest(randomUUID()), f.users[0]]);
      }, true));
      current!.outcomes.push(result); rejected(result, ["23514"]);
      assert.equal((await controller.query("SELECT 1 FROM organizations WHERE id=$1", [org])).rowCount, 0);
      await tx(controller, [org], async () => { await controller.query("INSERT INTO organizations(id,name,slug,is_archived) VALUES($1,'Archived fixture',$2,true)", [org, `access05-${org}`]); }, true);
      rejected(await outcome(tx(a, [org], async () => { await a.query("UPDATE organizations SET is_archived=false WHERE id=$1", [org]); })), ["23514"]);
      const row = (await controller.query("SELECT is_archived FROM organizations WHERE id=$1", [org])).rows[0]; assert.equal(row.is_archived, true);
    });

    await runCase("reenable-does-not-regrant-deleted-assignment", async () => {
      const own = await fixture();
      await tx(controller, [own.org], async () => { await controller.query("DELETE FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2", [own.org, own.users[1]]); await controller.query("UPDATE user_organizations SET is_active=false WHERE organization_id=$1 AND user_id=$2", [own.org, own.users[1]]); });
      const p = await actor(own); await teamA.setMembershipActive(p, own.org, own.users[1], true, context(p));
      assert.equal((await controller.query("SELECT 1 FROM v2_staff_permission_set_assignments WHERE organization_id=$1 AND user_id=$2", [own.org, own.users[1]])).rowCount, 0); assert.equal(await floor(own), 1);
    });

    for (const lifecycle of ["suspended", "pending_delete", "soft_deleted"] as const) await runCase(`lifecycle-${lifecycle}-cannot-reactivate-floorless`, async () => {
      const own = await fixture(1);
      await tx(controller, [own.org], async () => {
        await controller.query(lifecycle === "suspended" ? "UPDATE organizations SET status='suspended' WHERE id=$1" : "UPDATE organizations SET delete_state=$2 WHERE id=$1", lifecycle === "suspended" ? [own.org] : [own.org, lifecycle]);
        await controller.query("UPDATE user_organizations SET is_active=false WHERE organization_id=$1 AND user_id=$2", [own.org, own.users[0]]);
      });
      const result = await outcome(tx(a, [own.org], async () => { await a.query(lifecycle === "suspended" ? "UPDATE organizations SET status='active' WHERE id=$1" : "UPDATE organizations SET delete_state='active' WHERE id=$1", [own.org]); }));
      current!.outcomes.push(result); rejected(result, ["23514"]);
      const row = (await controller.query("SELECT status,delete_state FROM organizations WHERE id=$1", [own.org])).rows[0];
      assert.equal(lifecycle === "suspended" ? row.status : row.delete_state, lifecycle);
    });

    await runCase("late-entry-upgrade-isolation-and-wrong-scope-denied", async () => {
      const own = await fixture(), other = await fixture();
      const attempts: Array<() => Promise<unknown>> = [
        async () => { await a.query("SELECT 1 FROM users WHERE id=$1 FOR UPDATE", [own.users[0]]); await enterAuthorityMutation(a, [own.org], true); },
        async () => { await enterAuthorityMutation(a, [own.org]); await enterAuthorityMutation(a, [own.org], true); },
        async () => { await a.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); await enterAuthorityMutation(a, [own.org]); },
        async () => { await enterAuthorityMutation(a, [own.org]); await a.query("UPDATE user_organizations SET role='member' WHERE organization_id=$1 AND user_id=$2", [other.org, other.users[0]]); },
        async () => { await a.query("SELECT set_config('v2.authority_entry',jsonb_build_object('xid',txid_current()::text,'exclusive',true,'organizations',jsonb_build_array($1::text))::text,true)", [own.org]); await a.query("UPDATE users SET email=email WHERE id=$1", [own.users[0]]); },
      ];
      for (const attempt of attempts) {
        await a.query("BEGIN"); const result = await outcome(attempt()); await a.query("ROLLBACK");
        current!.outcomes.push(result); rejected(result, ["25000"]);
      }
      assert.equal(await floor(own), 2); assert.equal(await floor(other), 2);
    });

    await runCase("non-success-receipt-cannot-replay", async () => {
      const own = await fixture(), p = await actor(own);
      for (const status of ["in_progress", "permanent_failure"] as const) {
        const key = randomUUID();
        await tx(controller, [own.org], async () => { await controller.query("INSERT INTO v2_operation_requests(organization_id,operation,business_request_id,payload_fingerprint,status,initiated_principal_kind,initiated_principal_subject,staff_actor_user_id) VALUES($1,'team_access.staff_membership_disabled.v1',$2,$3,$4,'staff',$5,$5)", [own.org, key, digest(JSON.stringify({ userId: own.users[1], active: false })), status, p.userId]); });
        const before = await state(own);
        const result = await outcome(teamA.setMembershipActive(p, own.org, own.users[1], false, context(p, key)));
        current!.outcomes.push(result); rejected(result, ["CONFLICT"]); assert.deepEqual(await state(own), before);
      }
    });

    for (const operation of ["created", "cloned", "updated", "portal"] as const) await runCase(`persisted-v1-${operation}-provable-intent-only`, async () => {
      const own = await fixture(), p = await actor(own), key = randomUUID();
      const setId = own.sets[1], name = "native-1", capabilities = ["order.view"] as const;
      const portalSet = (await controller.query("SELECT id FROM v2_permission_sets WHERE organization_id=$1 AND source_template_key='customer_full_portal'", [own.org])).rows[0].id as string;
      const portalInput = { customerId: own.customer, contactId: own.contact, permissionSetId: portalSet };
      const legacyOperation = operation === "portal" ? "team_access.portal_access_bootstrapped.v1" : `team_access.permission_set_${operation}.v1`;
      const originalIntent = operation === "created" ? { permissionSetId: setId, name, capabilities }
        : operation === "cloned" ? { permissionSetId: setId, sourcePermissionSetId: own.sets[0], name }
          : operation === "updated" ? { permissionSetId: setId, name, capabilities, active: true } : portalInput;
      // Persisted compatibility fixture, NOT evidence of a provider delivery.
      const savedResult = operation === "portal" ? { portalAccessId: own.access, status: "pending", deliveryState: "succeeded" } : { permissionSetId: setId };
      await tx(controller, [own.org], async () => {
        await controller.query("INSERT INTO v2_operation_requests(organization_id,operation,business_request_id,payload_fingerprint,status,result_json,completed_at,initiated_principal_kind,initiated_principal_subject,staff_actor_user_id) VALUES($1,$2,$3,$4,'succeeded',$5::jsonb,now(),'staff',$6,$6)", [own.org, legacyOperation, key, digest(JSON.stringify(originalIntent)), JSON.stringify(savedResult), p.userId]);
        // Frozen receipt, not today's mutable role, is the replay authority.
        await controller.query("UPDATE v2_permission_sets SET name='Later role name',normalized_name='later role name',description='Later description' WHERE organization_id=$1 AND id=$2", [own.org, setId]);
      });
      const before = await state(own);
      const invoke = (principal: StaffPrincipal, changed = false, unprovableDescription = false): Promise<unknown> => {
        const roleInput = { name: changed ? "Changed intent" : name, ...(unprovableDescription ? { description: "Unrecorded original description" } : {}) };
        if (operation === "created") return teamA.createCustomSet(principal, own.org, { ...roleInput, capabilities }, context(principal, key));
        if (operation === "cloned") return teamA.cloneStaffSet(principal, own.org, own.sets[0], roleInput, context(principal, key));
        if (operation === "updated") return teamA.updateCustomSet(principal, own.org, setId, { ...roleInput, capabilities, active: true }, context(principal, key));
        return teamA.bootstrapPortalAccess(principal, own.org, { ...portalInput, ...(changed ? { contactId: randomUUID() } : {}) }, context(principal, key));
      };
      if (operation === "portal") assert.deepEqual(await invoke(p), savedResult);
      else {
        // Both an originally empty and an originally meaningful description
        // produce this SAME shipped v1 digest/result. An empty retry cannot
        // prove which original intent succeeded. Never bless that ambiguity.
        const omittedDescription = await outcome(invoke(p)); current!.outcomes.push(omittedDescription);
        rejected(omittedDescription, ["CONFLICT"]);
      }
      assert.deepEqual(await state(own), before);
      const changed = await outcome(invoke(p, true)); current!.outcomes.push(changed); rejected(changed, [operation === "portal" ? "IDEMPOTENCY_CONFLICT" : "CONFLICT"]);
      if (operation !== "portal") {
        const unprovable = await outcome(invoke(p, false, true)); current!.outcomes.push(unprovable); rejected(unprovable, ["CONFLICT"]);
      }
      const foreignActor = await outcome(invoke(await actor(own, 2))); current!.outcomes.push(foreignActor); rejected(foreignActor, ["FORBIDDEN"]);
      assert.deepEqual(await state(own), before);
      for (const status of ["in_progress", "permanent_failure"] as const) {
        await tx(controller, [own.org], async () => { await controller.query("UPDATE v2_operation_requests SET status=$4 WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3", [own.org, legacyOperation, key, status]); });
        const nonSuccessful = await state(own), denied = await outcome(invoke(p)); current!.outcomes.push(denied); rejected(denied, ["CONFLICT"]);
        assert.deepEqual(await state(own), nonSuccessful);
      }
      await tx(controller, [own.org], async () => { await controller.query("UPDATE v2_operation_requests SET status='succeeded' WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3", [own.org, legacyOperation, key]); });
      await tx(controller, [own.org], async () => { await controller.query("UPDATE users SET must_set_password=true WHERE id=$1", [p.userId]); }, true);
      const unavailable = await state(own), noCredentials = await outcome(invoke(p)); current!.outcomes.push(noCredentials); rejected(noCredentials, ["FORBIDDEN"]);
      assert.deepEqual(await state(own), unavailable);
      await tx(controller, [own.org], async () => { await controller.query("UPDATE users SET must_set_password=false WHERE id=$1", [p.userId]); }, true);
      if (operation === "portal") {
        await tx(controller, [own.org], async () => { await controller.query("UPDATE v2_operation_requests SET result_json=jsonb_set(result_json,'{deliveryState}','\"suppressed\"') WHERE organization_id=$1 AND operation=$2 AND business_request_id=$3", [own.org, legacyOperation, key]); });
        const suppressedBefore = await state(own);
        const suppressed = await outcome(invoke(p)); current!.outcomes.push(suppressed); rejected(suppressed, ["CONFLICT"]);
        assert.deepEqual(await state(own), suppressedBefore);
      }
      // Successful receipts still require fresh authority, even with the exact
      // old key/body and the original stale client-side principal.
      await tx(controller, [own.org], async () => { await controller.query("UPDATE user_organizations SET role='member' WHERE organization_id=$1 AND user_id=$2", [own.org, p.userId]); });
      const revoked = await state(own), denied = await outcome(invoke(p)); current!.outcomes.push(denied); rejected(denied, ["FORBIDDEN"]);
      assert.deepEqual(await state(own), revoked);
      current!.counts.replayedLegacyReceipts = operation === "portal" ? 1 : 0; current!.counts.newRequestRows = Number(before.requests) - 1;
      assert.equal(current!.counts.newRequestRows, 0);
    });

    for (const operation of ["create", "clone", "update"] as const) await runCase(`modern-v2-${operation}-description-bound-replay`, async () => {
      const own = await fixture(), p = await actor(own), key = randomUUID();
      const invoke = (description: string): Promise<unknown> => {
        const input = { name: `Modern ${operation}`, description };
        if (operation === "create") return teamA.createCustomSet(p, own.org, { ...input, capabilities: ["order.view"] }, context(p, key));
        if (operation === "clone") return teamA.cloneStaffSet(p, own.org, own.sets[1], input, context(p, key));
        return teamA.updateCustomSet(p, own.org, own.sets[1], { ...input, capabilities: ["order.view"], active: true }, context(p, key));
      };
      const original = await invoke("Original meaningful description"), before = await state(own);
      assert.deepEqual(await invoke("Original meaningful description"), original);
      assert.deepEqual(await state(own), before);
      for (const description of ["", "Changed meaningful description"]) {
        const changed = await outcome(invoke(description)); current!.outcomes.push(changed); rejected(changed, ["IDEMPOTENCY_CONFLICT"]);
        assert.deepEqual(await state(own), before);
      }
      assert.equal(Number(before.requests), 1);
      assert.equal((await controller.query("SELECT operation FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2", [own.org, key])).rows[0].operation.endsWith(".v2"), true);
      current!.counts.successfulRequestRows = 1;
    });

    await runCase("portal-credentials-exclusive-scope-does-not-revise-unrelated-tenant", async () => {
      const own = await fixture(), unrelated = await fixture();
      const before = await state(unrelated);
      const ownBefore = await state(own);
      const credentials = new PostgresPortalCredentialLifecycle(A.pool, undefined);
      await credentials.establishCredentials(own.token, `Setup-${randomUUID()}`);
      assert.deepEqual(await state(unrelated), before);
      const afterSetup = await state(own);
      assert.equal(BigInt(afterSetup.revision) - BigInt(ownBefore.revision), 1n);
      const resetToken = randomUUID();
      await tx(controller, [own.org], async () => { await controller.query("INSERT INTO v2_portal_password_reset_tokens(access_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [own.access, own.org, digest(resetToken)]); });
      await credentials.resetPassword(resetToken, `Reset-${randomUUID()}`);
      assert.deepEqual(await state(unrelated), before);
      assert.equal(BigInt((await state(own)).revision) - BigInt(afterSetup.revision), 1n);
      current!.counts.unrelatedAuthorityRevisionChanges = 0;
      current!.counts.affectedAuthorityRevisionChanges = 2;
    });

    await runCase("team-versus-portal-credentials-state-identity-order", async () => {
      const own = await fixture(), p = await actor(own), before = await state(own);
      const credentials = new PostgresPortalCredentialLifecycle(B.pool, undefined);
      const results = await race(() => teamA.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)), () => credentials.establishCredentials(own.token, `Unused-${randomUUID()}`));
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], ["INVALID_SETUP_LINK"]);
      const portal = (await controller.query("SELECT status,user_id,password_set_at FROM customer_portal_access WHERE id=$1", [own.access])).rows[0];
      assert.equal(portal.status, "DISABLED"); assert.equal(portal.password_set_at, null);
      assert.equal((await controller.query("SELECT 1 FROM auth_identities WHERE user_id=$1", [own.portalUser])).rowCount, 0);
      assert.equal(Number((await state(own)).requests), Number(before.requests) + 1);
    });

    await runCase("portal-credentials-versus-team-exclusive-entry", async () => {
      const own = await fixture(), p = await actor(own);
      const credentials = new PostgresPortalCredentialLifecycle(A.pool, undefined);
      const results = await race(() => credentials.establishCredentials(own.token, `Native-${randomUUID()}`), () => teamB.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)));
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], ["STALE_STATE"]);
      assert.equal((await controller.query("SELECT status FROM customer_portal_access WHERE id=$1", [own.access])).rows[0].status, "ACTIVE");
      assert.equal((await controller.query("SELECT count(*)::int n FROM auth_identities WHERE user_id=$1", [own.portalUser])).rows[0].n, 1);
      const fresh = await actor(own); await teamB.setPortalAccessStatus(fresh, own.org, own.access, "disabled", context(fresh));
    });

    for (const resetFirst of [true, false]) await runCase(`portal-reset-team-${resetFirst ? "reset-first" : "team-first"}`, async () => {
      const own = await fixture();
      await new PostgresPortalCredentialLifecycle(A.pool, undefined).establishCredentials(own.token, `Initial-${randomUUID()}`);
      const resetToken = randomUUID(), resetId = randomUUID();
      await tx(controller, [own.org], async () => { await controller.query("INSERT INTO v2_portal_password_reset_tokens(id,access_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')", [resetId, own.access, own.org, digest(resetToken)]); });
      const p = await actor(own), before = (await controller.query("SELECT password_hash FROM auth_identities WHERE user_id=$1", [own.portalUser])).rows[0].password_hash;
      const credentials = new PostgresPortalCredentialLifecycle(resetFirst ? A.pool : B.pool, undefined);
      const reset = () => credentials.resetPassword(resetToken, `Reset-${randomUUID()}`);
      const results = resetFirst
        ? await race(reset, () => teamB.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)))
        : await race(() => teamA.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)), reset);
      assert.equal(results[0].status, "fulfilled"); rejected(results[1], [resetFirst ? "STALE_STATE" : "INVALID_RESET_LINK"]);
      const after = (await controller.query("SELECT password_hash FROM auth_identities WHERE user_id=$1", [own.portalUser])).rows[0].password_hash;
      if (resetFirst) assert.notEqual(after, before); else assert.equal(after, before);
      const token = (await controller.query("SELECT used_at,revoked_at FROM v2_portal_password_reset_tokens WHERE id=$1", [resetId])).rows[0];
      if (resetFirst) { assert.ok(token.used_at); assert.equal(token.revoked_at, null); }
      else { assert.equal(token.used_at, null); assert.ok(token.revoked_at); }
      current!.counts.passwordChanges = resetFirst ? 1 : 0;
    });

    for (const proofFirst of [true, false]) await runCase(`proof-recipient-team-${proofFirst ? "proof-first" : "team-first"}`, async () => {
      const own = await fixture();
      await tx(controller, [own.org], async () => { await controller.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,'proof.issue')", [own.org, own.sets[0]]); });
      const p = await actor(own), before = await state(own);
      const connection = proofFirst ? A : B;
      const runner = new PostgresProofingTransactionRunner(connection.pool);
      const proof = () => runner.transaction(async () => {
        // Rollback-only canonical rows satisfy actual Proof/Auth joins and FKs.
        // They are never committed or issued, and no delivery job is created.
        const product = randomUUID(), document = randomUUID(), line = randomUUID(), work = randomUUID(), version = randomUUID();
        await connection.client.query("INSERT INTO products(id,organization_id,name,description) VALUES($1,$2,'Native fixture','Rollback-only fixture')", [product, own.org]);
        await connection.client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,contact_id,currency) VALUES($1,$2,'order',1,'NATIVE-1',$3,$4,'USD')", [document, own.org, own.customer, own.contact]);
        await connection.client.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [document, own.org]);
        await connection.client.query(`INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision)
          VALUES($1,$2,$3,0,$4,'Rollback fixture',1,'USD',100,100,100,100,$5,$5,'{}','{}','{}')`, [line, own.org, document, product, randomUUID()]);
        await connection.client.query("INSERT INTO v2_proof_works(id,organization_id,order_document_id,order_line_id,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,$4,'staff',$5,$5)", [work, own.org, document, line, p.userId]);
        await connection.client.query("INSERT INTO v2_proof_versions(id,organization_id,proof_work_id,sequence,created_principal_kind,created_principal_subject,created_staff_actor_user_id) VALUES($1,$2,$3,1,'staff',$4,$4)", [version, own.org, work, p.userId]);
        const result = await new PostgresProofRecipientAccess(connection.client).ensureForProofIssue({ organizationId: own.org, proofVersionId: version, recipientContactId: own.contact, staffActorUserId: p.userId });
        assert.equal(result.portalAccessId, own.access);
        assert.equal((await connection.client.query("SELECT count(*)::int n FROM v2_portal_permission_set_assignments WHERE organization_id=$1 AND portal_access_id=$2 AND active", [own.org, own.access])).rows[0].n, 1);
        current!.counts.recipientMutationObservedBeforeRollback = 1;
        throw Object.assign(new Error("Intentional rollback after real recipient mutation"), { code: "INJECTED_ROLLBACK" });
      }, own.org, p);
      const results = proofFirst
        ? await race(proof, () => teamB.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)))
        : await race(() => teamA.setPortalAccessStatus(p, own.org, own.access, "disabled", context(p)), proof);
      rejected(results[proofFirst ? 0 : 1], [proofFirst ? "INJECTED_ROLLBACK" : "CONFLICT"]); assert.equal(results[proofFirst ? 1 : 0].status, "fulfilled");
      assert.equal(Number((await state(own)).requests), Number(before.requests) + 1);
      for (const table of ["v2_proof_versions", "v2_proof_works", "v2_sales_documents", "v2_portal_permission_set_assignments"]) {
        const count = Number((await controller.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1`, [own.org])).rows[0].n);
        assert.equal(count, 0); current!.counts[table] = count;
      }
    });
    await runCase("no-zero-surviving-active-tenants", async () => {
      const result = await controller.query("SELECT count(*)::int n FROM organizations o WHERE delete_state='active' AND NOT is_archived AND status IN ('active','trial') AND (NOT EXISTS(SELECT 1 FROM v2_permission_organization_state s WHERE s.organization_id=o.id AND s.admin_floor_enforced) OR NOT EXISTS(SELECT 1 FROM v2_usable_structural_administrators(o.id)))");
      current!.counts.zeroAuthorityActiveTenants = Number(result.rows[0].n); assert.equal(current!.counts.zeroAuthorityActiveTenants, 0);
    });
    assert.deepEqual(sourceSnapshot(), receipt.source.digests, "Runtime closure changed during native proof (including additions/deletions)");
    assert.equal(digest(JSON.stringify((await controller.query(STRUCTURAL_AUTHORITY_SCHEMA_QUERY)).rows[0].shape)), manifest.physicalSchemaSha256);
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), head);
    receipt.status = "passed";
  } catch (error) { receipt.errorCode = code(error); }
  finally {
    try {
      for (const client of connected) await client.query("ROLLBACK");
      await cleanupOwned(ownedOrganizations, ownedUsers, receipt.cleanup);
      receipt.cleanup.remainingOwnedOrganizations = ownedOrganizations.length ? Number((await controller.query("SELECT count(*)::int n FROM organizations WHERE id=ANY($1::varchar[])", [ownedOrganizations])).rows[0].n) : 0;
      receipt.cleanup.remainingOwnedUsers = ownedUsers.length ? Number((await controller.query("SELECT count(*)::int n FROM users WHERE id=ANY($1::varchar[])", [ownedUsers])).rows[0].n) : 0;
      assert.equal(receipt.cleanup.remainingOwnedOrganizations, 0); assert.equal(receipt.cleanup.remainingOwnedUsers, 0);
      if (baseline !== undefined) { assert.deepEqual(await snapshotBaseline(), baseline); receipt.cleanup.baselinePreserved = true; }
      receipt.cleanup.status = "passed";
    } catch (error) { receipt.cleanup.status = "failed"; receipt.cleanup.errorCode ??= code(error); receipt.status = "failed"; receipt.errorCode ??= code(error); if (connected.includes(controller)) await controller.query("ROLLBACK").catch(() => {}); }
    await Promise.all(connected.map((client) => client.end().catch(() => {})));
  }
  try {
    assert.deepEqual(sourceSnapshot(), receipt.source.digests, "Runtime closure changed during cleanup");
    assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), head);
    assert.equal(digest(readFileSync(manifestPath)), manifestPin, "Reviewed fixture manifest changed during proof");
  } catch (error) { receipt.status = "failed"; receipt.errorCode ??= code(error); }
  return receipt;
}

if (process.env.ACCESS05_NATIVE_TEST_OPT_IN === "1") {
  runStructuralAuthorityNative().then((receipt) => { console.log(JSON.stringify(receipt)); if (receipt.status !== "passed") process.exitCode = 1; }, (error: unknown) => { console.log(JSON.stringify({ schemaVersion: 1, suite: "ACCESS05-native", status: "failed", phase: "preflight", errorCode: code(error) })); process.exitCode = 1; });
} else {
  console.log(JSON.stringify({ schemaVersion: 1, suite: "ACCESS05-native", status: "not_run", reason: "Explicit ACCESS05_NATIVE_TEST_OPT_IN=1, guarded TEST_DATABASE_URL, and independently reviewed fixture manifest plus SHA256 required" }));
}
