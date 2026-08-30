import { Pool } from "pg";
import { SupabaseArtworkBinaryStorage } from "../../v2/infrastructure/artwork/artworkBinaryStorage.js";
import { PostgresArtworkStorageUploadLedger } from "../../v2/infrastructure/artwork/artworkStorageUploadLedger.js";
import { ArtworkStorageReconciler } from "../../v2/infrastructure/artwork/artworkStorageReconciler.js";

const value = (name: string): string | undefined => process.argv.slice(2).find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes("--apply");
const limit = Number(value("limit") ?? "50");
const hours = Number(value("grace-hours") ?? process.env.ARTWORK_STORAGE_RECONCILIATION_GRACE_HOURS ?? "48");

if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("limit must be an integer from 1 to 200.");
if (!Number.isInteger(hours) || hours < 24 || hours > 720) throw new Error("grace-hours must be an integer from 24 to 720.");
if (apply && process.env.ARTWORK_STORAGE_RECONCILIATION_ENABLED?.trim().toLowerCase() !== "true") throw new Error("Apply requires ARTWORK_STORAGE_RECONCILIATION_ENABLED=true.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, application_name: "v2-artwork-storage-reconciler" });
const olderThan = new Date(Date.now() - hours * 60 * 60 * 1000);
const reconciler = new ArtworkStorageReconciler(new PostgresArtworkStorageUploadLedger(pool), new SupabaseArtworkBinaryStorage());
try {
  if (!apply) {
    const rows = await reconciler.inspect({ olderThan, limit });
    console.log(JSON.stringify({ mode: "dry_run", graceHours: hours, candidateCount: rows.length, states: rows.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.state]: (counts[row.state] ?? 0) + 1 }), {}) }));
  } else {
    const summary = await reconciler.reconcile({ olderThan, limit, leaseMs: 5 * 60 * 1000 });
    console.log(JSON.stringify({ mode: "apply", graceHours: hours, ...summary }));
  }
} finally { await pool.end(); }
