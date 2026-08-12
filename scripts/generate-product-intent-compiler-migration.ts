import fs from "node:fs";
import path from "node:path";
import { renderProductIntentCompilerMigrationMarkdown } from "../server/services/productIntentCompiler/productIntentCanonicalProposal";

const output = path.resolve(process.cwd(), "docs/architecture/product-intent-compiler-migration.md");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, renderProductIntentCompilerMigrationMarkdown(), "utf8");
console.log(`Wrote ${output}`);
