import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderCanonicalProductPricingMigrationMarkdown } from "../server/services/products/canonicalProductPricingOperations";

const output = path.resolve(process.cwd(), "docs", "architecture", "canonical-product-pricing-migration.md");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, renderCanonicalProductPricingMigrationMarkdown(), "utf8");
console.info(`Wrote ${path.relative(process.cwd(), output)}`);
