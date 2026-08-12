import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCanonicalProductOperationMigrationMarkdown } from "../server/services/products/canonicalProductConfigurationOperations";

const output = path.resolve(process.cwd(), "docs", "architecture", "canonical-product-operation-migration.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCanonicalProductOperationMigrationMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
