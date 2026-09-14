import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = "PrintersHero-Traveler-Print-Agent-win-x64.zip";
const source = path.join(root, "server", "assets", "print-agent", filename);
const destinationDirectory = path.join(root, "dist", "print-agent");
const destination = path.join(destinationDirectory, filename);

try {
  await stat(source);
} catch {
  throw new Error(`Required Traveler Print Agent package is missing: ${source}`);
}

await mkdir(destinationDirectory, { recursive: true });
await copyFile(source, destination);
