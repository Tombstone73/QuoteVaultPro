import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCanonicalCapabilityRegistryMarkdown } from "../server/services/assistant/canonicalCapabilityRegistry";

const output = path.resolve(process.cwd(), "docs", "architecture", "ai-operator-canonical-capability-registry.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCanonicalCapabilityRegistryMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
