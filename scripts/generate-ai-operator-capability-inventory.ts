import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCapabilityInventoryMarkdown } from "../server/services/assistant/capabilityInventory";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-capability-inventory.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCapabilityInventoryMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
