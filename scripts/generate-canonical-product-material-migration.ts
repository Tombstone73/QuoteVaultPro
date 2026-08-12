import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCanonicalProductMaterialMigrationMarkdown } from "../server/services/products/canonicalProductMaterialOperations";

const output = path.resolve(process.cwd(), "docs", "architecture", "canonical-product-material-migration.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCanonicalProductMaterialMigrationMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
