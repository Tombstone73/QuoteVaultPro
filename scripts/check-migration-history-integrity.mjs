#!/usr/bin/env node
/**
 * Prevents two migration-history failures that Drizzle's timestamp ledger
 * cannot detect: editing an already-recorded migration and adding a migration
 * behind the current journal frontier.
 *
 * The committed manifest is an intentionally small, reviewable trust anchor.
 * Normal CI use is read-only. `--refresh` is allowed only when the previously
 * protected history is byte-for-byte unchanged and the new entries are a
 * strictly later append.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The override exists solely for hermetic tests; CI and developer commands use
// the repository root derived from this script.
const root = process.env.MIGRATION_HISTORY_ROOT
  ? path.resolve(process.env.MIGRATION_HISTORY_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "server", "db", "migrations_v2");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");
const manifestPath = path.join(migrationsDir, "meta", "_history-integrity.json");
const refresh = process.argv.slice(2).includes("--refresh");
// Historic migration source remains immutable. This is the one reviewed
// exception for the 0231/0232 transaction that PostgreSQL rejected before
// either migration could be recorded in a shared ledger.
const permittedUnappliedRepairs = new Map([
  ["af7525e574de33570676458314ce398b900443dc2c9cd3727058fbdea43c92e3", [
    "0231_v2_fulfillment_handoff_document_snapshots",
    "0232_v2_fulfillment_handoff_snapshot_tenant_key",
  ]],
  ["07aaf39aa4b5c3a12afc863574e981199a942e855e46a48c985b1d06bfd7970b", [
    "0257_v2_finance_paged_ledger_read_model",
  ]],
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function loadJournal() {
  const raw = JSON.parse(readFileSync(journalPath, "utf8"));
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) fail("journal has no entries");
  const entries = raw.entries.map(({ idx, tag, when }) => ({ idx, tag, when })).sort((a, b) => a.idx - b.idx);
  const tags = new Set();
  let previous = null;

  for (const entry of entries) {
    if (!Number.isInteger(entry.idx) || entry.idx < 0) fail(`invalid idx for ${entry.tag}`);
    if (!Number.isInteger(entry.when) || entry.when < 0) fail(`invalid when for ${entry.tag}`);
    if (typeof entry.tag !== "string" || !/^[a-z0-9_]+$/i.test(entry.tag)) fail(`invalid tag for idx=${entry.idx}`);
    if (tags.has(entry.tag)) fail(`duplicate journal tag: ${entry.tag}`);
    if (previous && entry.idx <= previous.idx) fail(`journal idx is not strictly increasing at ${entry.tag}`);
    if (previous && entry.when <= previous.when) {
      fail(`backfilled/lower migration timestamp: ${entry.tag} (${entry.when}) is not greater than ${previous.tag} (${previous.when})`);
    }
    const source = path.join(migrationsDir, `${entry.tag}.sql`);
    try { readFileSync(source); } catch { fail(`missing SQL source for journal tag: ${entry.tag}`); }
    tags.add(entry.tag);
    previous = entry;
  }

  // Drizzle reads only the journal. A manually added SQL file that is absent
  // from it is silently excluded from every canonical migration run, even
  // though it looks present in the repository and build artifact.
  const orphanedSql = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name.slice(0, -".sql".length))
    .filter((tag) => !tags.has(tag))
    .sort();
  if (orphanedSql.length > 0) {
    fail(`migration SQL file(s) are absent from the journal and will not be applied: ${orphanedSql.join(", ")}`);
  }

  return entries;
}

function canonical(entries) {
  return entries.map((entry) => {
    const source = readFileSync(path.join(migrationsDir, `${entry.tag}.sql`));
    return `${entry.idx}\t${entry.when}\t${entry.tag}\t${sha256(source)}`;
  }).join("\n") + "\n";
}

function makeManifest(entries, previousManifest) {
  const last = entries.at(-1);
  const manifest = {
    version: 1,
    purpose: "CI trust anchor for immutable V2 migration history",
    entryCount: entries.length,
    immutableThrough: { idx: last.idx, when: last.when, tag: last.tag },
    canonicalSha256: sha256(canonical(entries)),
  };
  const repairs = recordedUnappliedRepairs(previousManifest);
  if (repairs.length > 0) manifest.unappliedRepairs = repairs;
  return manifest;
}

function recordedUnappliedRepairs(manifest) {
  if (!manifest) return [];
  if (manifest.unappliedRepairs !== undefined) {
    if (!Array.isArray(manifest.unappliedRepairs)) fail("invalid recorded unapplied migration repair metadata");
    if (manifest.unappliedRepair !== undefined) fail("cannot mix legacy and plural unapplied migration repair metadata");
    return manifest.unappliedRepairs;
  }
  return manifest.unappliedRepair === undefined ? [] : [manifest.unappliedRepair];
}

function validateRecordedUnappliedRepairs(manifest, entries) {
  const repairs = recordedUnappliedRepairs(manifest);
  const seenPriorDigests = new Set();
  for (const repair of repairs) {
    if (
      !repair ||
      typeof repair.priorCanonicalSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(repair.priorCanonicalSha256) ||
      !Array.isArray(repair.tags) ||
      repair.tags.length === 0 ||
      repair.tags.some((tag) => typeof tag !== "string") ||
      typeof repair.reason !== "string" ||
      repair.reason.length === 0
    ) fail("invalid recorded unapplied migration repair metadata");

    if (seenPriorDigests.has(repair.priorCanonicalSha256)) {
      fail("duplicate recorded unapplied migration repair metadata");
    }
    seenPriorDigests.add(repair.priorCanonicalSha256);

    const permittedTags = permittedUnappliedRepairs.get(repair.priorCanonicalSha256);
    if (
      !permittedTags ||
      permittedTags.length !== repair.tags.length ||
      permittedTags.some((tag, index) => tag !== repair.tags[index])
    ) fail("recorded unapplied migration repair is not a permitted immutable-history exception");

    const protectedTags = new Set(entries.filter((entry) => entry.idx <= manifest.immutableThrough.idx).map((entry) => entry.tag));
    if (repair.tags.some((tag) => !protectedTags.has(tag))) {
      fail("recorded unapplied migration repair references a tag outside protected history");
    }
  }
}

function verifyManifest(manifest, entries) {
  if (manifest?.version !== 1 || !Number.isInteger(manifest.entryCount) || !manifest.immutableThrough || typeof manifest.canonicalSha256 !== "string") {
    fail("invalid migration history integrity manifest");
  }
  if (entries.length < manifest.entryCount) fail("journal lost entries protected by the integrity manifest");

  // Journal idx values are strictly ordered but are not guaranteed dense: historic
  // entries can legitimately be absent. The manifest's immutable frontier is the
  // stable identity, so select through that frontier rather than by array offset.
  const protectedEntries = entries.filter((entry) => entry.idx <= manifest.immutableThrough.idx);
  if (protectedEntries.length !== manifest.entryCount) {
    fail("protected migration entry count does not match the immutable journal frontier");
  }
  const protectedLast = protectedEntries.at(-1);
  if (
    protectedLast.idx !== manifest.immutableThrough.idx ||
    protectedLast.when !== manifest.immutableThrough.when ||
    protectedLast.tag !== manifest.immutableThrough.tag
  ) fail("journal order/tag/timestamp changed inside protected migration history");

  validateRecordedUnappliedRepairs(manifest, entries);
  const protectedDigest = sha256(canonical(protectedEntries));
  if (protectedDigest !== manifest.canonicalSha256) {
    fail("historical migration SQL or journal metadata changed; create a new repair migration instead of editing applied history");
  }
  return protectedEntries;
}

try {
  const entries = loadJournal();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const protectedEntries = verifyManifest(manifest, entries);
  const additions = entries.filter((entry) => entry.idx > protectedEntries.at(-1).idx);

  if (additions.length === 0) {
    console.log(`[migration-integrity] PASSED: ${entries.length} protected V2 migrations are unchanged.`);
  } else if (!refresh) {
    fail(`${additions.length} new migration(s) are not yet recorded in the integrity manifest. Run the reviewed refresh command after confirming this is an append-only change.`);
  } else {
    const nextManifest = makeManifest(entries, manifest);
    writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    console.log(`[migration-integrity] REFRESHED: protected append-only V2 history through ${nextManifest.immutableThrough.tag}.`);
  }
} catch (error) {
  console.error(`[migration-integrity] FAILED: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
}
