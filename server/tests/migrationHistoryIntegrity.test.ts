import { afterEach, describe, expect, test } from "@jest/globals";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const guard = path.join(repoRoot, "scripts", "check-migration-history-integrity.mjs");
const scratchRoots: string[] = [];

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "printershero-migration-integrity-"));
  scratchRoots.push(root);
  const migrations = path.join(root, "server", "db", "migrations_v2");
  const meta = path.join(migrations, "meta");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(migrations, "0000_baseline.sql"), "select 1;\n");
  fs.writeFileSync(path.join(migrations, "0001_first.sql"), "select 2;\n");
  const entries = [
    { idx: 0, when: 0, tag: "0000_baseline", breakpoints: true },
    { idx: 1, when: 1, tag: "0001_first", breakpoints: true },
  ];
  fs.writeFileSync(path.join(meta, "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries }, null, 2));
  const canonical = entries.map((entry) => `${entry.idx}\t${entry.when}\t${entry.tag}\t${hash(fs.readFileSync(path.join(migrations, `${entry.tag}.sql`)))}`).join("\n") + "\n";
  fs.writeFileSync(path.join(meta, "_history-integrity.json"), JSON.stringify({
    version: 1,
    purpose: "CI trust anchor for immutable V2 migration history",
    entryCount: entries.length,
    immutableThrough: { idx: 1, when: 1, tag: "0001_first" },
    canonicalSha256: hash(canonical),
  }, null, 2));
  return { root, migrations, meta, entries };
}

function run(root: string) {
  return () => execFileSync(process.execPath, [guard], {
    cwd: repoRoot,
    env: { ...process.env, MIGRATION_HISTORY_ROOT: root },
    encoding: "utf8",
    stdio: "pipe",
  });
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("V2 migration history integrity guard", () => {
  test("passes an unchanged protected journal", () => {
    const fixture = createFixture();
    expect(run(fixture.root)).not.toThrow();
  });

  test("uses Git-canonical line endings rather than checkout-specific CRLF bytes", () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.migrations, "0001_first.sql"), "select 2;\r\n");
    expect(run(fixture.root)).not.toThrow();
  });

  test("fails closed when a later journal entry is backfilled below the protected frontier", () => {
    const fixture = createFixture();
    fixture.entries.push({ idx: 2, when: 1, tag: "0002_backfilled", breakpoints: true });
    fs.writeFileSync(path.join(fixture.migrations, "0002_backfilled.sql"), "select 3;\n");
    fs.writeFileSync(path.join(fixture.meta, "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: fixture.entries }, null, 2));
    expect(run(fixture.root)).toThrow(/backfilled\/lower migration timestamp/i);
  });

  test("fails closed when protected migration SQL changes", () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.migrations, "0001_first.sql"), "select 999;\n");
    expect(run(fixture.root)).toThrow(/historical migration SQL or journal metadata changed/i);
  });
});
