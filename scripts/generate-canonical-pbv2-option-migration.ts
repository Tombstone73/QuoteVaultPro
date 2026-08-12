import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCanonicalPbv2OptionMigrationMarkdown } from "../server/services/products/canonicalPbv2OptionConfigurationOperations";

const output = path.resolve(process.cwd(), "docs", "architecture", "canonical-pbv2-option-migration.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCanonicalPbv2OptionMigrationMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
