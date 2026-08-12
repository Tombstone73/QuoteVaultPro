import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderOperatorIndexMarkdown } from "../server/services/assistant/operatorIndex";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-index.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderOperatorIndexMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
