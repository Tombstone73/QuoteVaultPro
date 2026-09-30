import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyBaseline } from "./architecture-evaluators.mjs";
import { baseline } from "./architecture-baseline.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function readArchitectureFiles(directory = root) {
  const files = [];
  async function visit(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const filename = path.join(folder, entry.name);
      if (entry.isDirectory() && !["node_modules", "dist", "build", ".git", ".vite"].includes(entry.name)) await visit(filename);
      else if (entry.isFile() && /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) files.push({ file: path.relative(root, filename).replaceAll("\\", "/"), source: await readFile(filename, "utf8") });
    }
  }
  await visit(directory);
  return files;
}
export async function runCheck(evaluate, kind) {
  const findings = evaluate(await readArchitectureFiles());
  if (process.argv.includes("--inventory")) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }
  const result = applyBaseline(findings, baseline.filter((entry) => entry.kind === kind));
  if (result.violations.length || result.retired.length) {
    console.error(JSON.stringify({ violations: result.violations, retiredBaseline: result.retired }, null, 2));
    if (result.retired.length) console.error("Retired or changed baseline instances must be removed/shrunk after review, never retained as permission for reintroduction.");
    process.exitCode = 1;
  } else {
    console.log(`V2 ${kind} boundaries passed; ${result.matched.reduce((sum, entry) => sum + entry.observed, 0)} exact baseline instances (${result.matched.length} fingerprints). Known debt is not permission.`);
    const ids = {};
    for (const entry of result.matched) ids[entry.id] = (ids[entry.id] ?? 0) + entry.observed;
    console.log(`Observed baseline IDs: ${Object.entries(ids).sort().map(([id, count]) => `${id}=${count}`).join(", ")}`);
  }
}
