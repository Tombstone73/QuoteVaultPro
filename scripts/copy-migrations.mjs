/**
 * Copy server/db/migrations_v2 → dist/db/migrations after esbuild bundle.
 * Run as: node scripts/copy-migrations.mjs
 * Called automatically by `npm run build`.
 */
import { cpSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { rmSync } from "fs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "server", "db", "migrations_v2");
const dest = path.join(root, "dist", "db", "migrations");

mkdirSync(path.dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("[Build] Copied server/db/migrations_v2 → dist/db/migrations");
