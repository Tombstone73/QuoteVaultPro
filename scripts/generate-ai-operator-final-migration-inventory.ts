import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderFinalMigrationInventoryMarkdown } from "../server/services/assistant/finalMigrationInventory";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-final-migration-inventory.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderFinalMigrationInventoryMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
