import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderAssistantAuthorityDivergenceMarkdown } from "../server/services/assistant/authorityDivergenceReport";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-authority-divergence.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderAssistantAuthorityDivergenceMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
