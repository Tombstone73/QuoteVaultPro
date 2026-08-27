import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const source = (relative: string) =>
  readFile(path.join(process.cwd(), relative), "utf8");

const [quoteApplication, quoteTransaction, migration] = await Promise.all([
  source("v2/src/modules/sales/quoteApplication.ts"),
  source("v2/infrastructure/sales/postgresQuoteTransaction.ts"),
  source("server/db/migrations_v2/0187_v2_sales_commercial_persistence.sql"),
]);

assert.match(
  migration,
  /UNIQUE \(organization_id, document_id, position\)/,
  "Sales lines must retain their tenant/document ordering uniqueness guard.",
);
assert.match(
  quoteApplication,
  /next\.splice\(index \+ 1, 0, Object\.freeze\(\{ \.\.\.source, lineId: brandedId<"SalesLineId">\(randomUUID\(\)\) \}\)\)/,
  "A duplicate must preserve its immutable source snapshot while minting a new line identity.",
);
assert.match(
  quoteApplication,
  /Quote line order must include every line exactly once/,
  "Reorder commands must remain an exact permutation of the Quote's lines.",
);

const quoteUpdate = quoteTransaction.slice(
  quoteTransaction.indexOf("async update("),
  quoteTransaction.indexOf("async transition("),
);
const vacate = quoteUpdate.indexOf(
  "UPDATE v2_sales_document_lines SET position=position+100000,updated_at=now() WHERE organization_id=$1 AND document_id=$2",
);
const writeLines = quoteUpdate.indexOf("await this.writeLines(");
assert.ok(vacate >= 0, "Quote updates must vacate retained line positions.");
assert.ok(
  vacate < writeLines,
  "Quote positions must be vacated before stable-ID upserts write duplicate or reordered lines.",
);
assert.match(
  quoteTransaction,
  /await client\.query\("BEGIN"\)/,
  "Quote persistence must remain transactional.",
);
assert.match(
  quoteTransaction,
  /await client\.query\("ROLLBACK"\)/,
  "A failed duplicate must roll back its header and line changes atomically.",
);
assert.doesNotMatch(
  quoteTransaction,
  /\.values\(\s*\[\s*\]\s*\)/,
  "Quote persistence must not attempt an empty values insert.",
);

console.log("Quote duplicate and reorder persistence contracts passed.");
