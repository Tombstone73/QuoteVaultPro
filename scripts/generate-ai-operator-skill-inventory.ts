import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderOperatorSkillInventoryMarkdown } from "../server/services/assistant/operatorSkillLoader";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-runtime-skill-inventory.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderOperatorSkillInventoryMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
