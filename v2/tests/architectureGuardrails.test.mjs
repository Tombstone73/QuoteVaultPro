import test from "node:test";
import assert from "node:assert/strict";
import { evaluateImports, evaluateSql, applyBaseline, extractImports, extractSql, sqlWriteTargets, fingerprint, writerDomain, tableOwner, publicApis } from "../scripts/architecture-evaluators.mjs";
import { baseline } from "../scripts/architecture-baseline.mjs";
import { readArchitectureFiles } from "../scripts/architecture-scan.mjs";

const files = (file, source) => [{ file, source }];
const importFixture = (specifier, clause = "{ value }") => `import ${clause} from ${JSON.stringify(specifier)};`;
const sqlFixture = (sql) => `await client.query(${JSON.stringify(sql)}, []);`;
const moduleFile = "src/modules/sales/newFile.ts";
const adapterFile = "infrastructure/sales/newAdapter.ts";

const invalidImports = [
  ["module pg", moduleFile, importFixture("pg")],
  ["module pg subpath", moduleFile, importFixture("pg/lib/client")],
  ["module drizzle", moduleFile, importFixture("drizzle-orm/pg-core")],
  ["module neon", moduleFile, importFixture("@neondatabase/serverless")],
  ["module postgres", moduleFile, importFixture("postgres")],
  ["module kysely", moduleFile, importFixture("kysely")],
  ["module knex", moduleFile, importFixture("knex")],
  ["module Prisma client", moduleFile, importFixture("@prisma/client")],
  ["module builtin SQLite", moduleFile, importFixture("node:sqlite")],
  ["module infrastructure", moduleFile, importFixture("../../../infrastructure/billing/privateRepository.js")],
  ["module interfaces", moduleFile, importFixture("../../interfaces/http/orderRoutes.js")],
  ["module client", moduleFile, importFixture("../../../../client/src/private.js")],
  ["module frontend alias", moduleFile, importFixture("@/components/private")],
  ["module V2 UI", moduleFile, importFixture("../../../ui/src/private.tsx")],
  ["module react", moduleFile, importFixture("react")],
  ["module UI package", moduleFile, importFixture("@radix-ui/react-dialog")],
  ["module V1 DB", moduleFile, importFixture("../../../../server/db.js")],
  ["cross-module private", moduleFile, importFixture("../billing/privateMath.js")],
  ["cross-module extensionless private", moduleFile, importFixture("../billing/privateMath")],
  ["cross-module application implementation", moduleFile, importFixture("../billing/billingApplication.js", "{ BillingApplicationService }")],
  ["public pure API extra symbol", moduleFile, importFixture("../pricing/formulaDomain.js", "{ privateRule }")],
  ["contract wildcard re-export", moduleFile, "export * from '../billing/contracts.js';"],
  ["shared upward", "src/modules/shared/newVocabulary.ts", importFixture("../artwork/contracts.js", "type { ArtworkSide }")],
  ["new RecipeUnit debt", "src/modules/inventory/newLedger.ts", importFixture("../products/productRecipes.js", "type { RecipeUnit }")],
  ["infrastructure foreign repository", adapterFile, importFixture("../billing/privateRepository.js")],
  ["adapter foreign domain rule", adapterFile, importFixture("../../src/modules/billing/privateMath.js")],
  ["adapter foreign tax rule", "infrastructure/fulfillment/newShippingAdapter.ts", importFixture("../../src/modules/sales/taxComposition.js", "{ composeSalesTax }")],
  ["baseUrl dotted private import", moduleFile, importFixture("v2/./src/modules/billing/billingApplication.js", "{ BillingApplicationService }")],
  ["empty named private import side effects", moduleFile, "import {} from '../billing/privateMath.js';"],
  ["new V1 service", adapterFile, importFixture("../../../server/services/anotherService.js")],
  ["new V1 route", adapterFile, importFixture("../../../server/routes/orders.routes.js")],
  ["new V1 index", adapterFile, importFixture("../../../server/index.js")],
  ["new V1 worker", adapterFile, importFixture("../../../server/workers/worker.js")],
  ["new V1 lib", adapterFile, importFixture("../../../server/lib/stripe.js")],
  ["POC static", "tests/newTest.ts", importFixture("../../v2-poc/runtime.js")],
  ["POC dynamic literal", adapterFile, "await import('../../../v2-poc/runtime.js');"],
  ["V1 re-export", adapterFile, "export { value } from '../../../server/lib/private.js';"],
  ["V1 require", adapterFile, "const legacy = require('../../../server/lib/private.js');"],
  ["V1 import equals", adapterFile, "import legacy = require('../../../server/lib/private.js');"],
  ["unresolved runtime import", adapterFile, "await import(pathFromRequest);"],
  ["interface repositories", "src/interfaces/http/newRoute.ts", importFixture("../../repositories/private.js")],
  ["interface persistence", "src/interfaces/http/newRoute.ts", importFixture("../../../infrastructure/persistence/private.js")],
  ["interface pg", "src/interfaces/http/newRoute.ts", importFixture("pg")],
  ["authorization pg", "src/authorization/newPolicy.ts", importFixture("pg")],
  ["authorization interfaces", "src/authorization/newPolicy.ts", importFixture("../interfaces/http/private.js")],
  ["authorization infrastructure", "src/authorization/newPolicy.ts", importFixture("../../infrastructure/billing/private.js")],
  ["repository interface", "src/repositories/newRepo.ts", importFixture("../interfaces/http/private.js")],
  ["application frontend", "src/application/newOperation.ts", importFixture("../../../client/src/private.js")],
  ["domain persistence", "src/domain/newDomain.ts", importFixture("../../infrastructure/persistence/private.js")],
  ["Staff resolver quarantine", adapterFile, importFixture("../../src/authorization/staffAuthorityCompatibility.js")],
  ["Staff issuer quarantine", adapterFile, importFixture("../../src/authorization/temporaryStaffPrincipalIssuer.js")],
  ["Staff repository quarantine", adapterFile, importFixture("../compatibility/postgresStaffMembershipRead.js")],
];
for (const [name, file, source] of invalidImports) test(`rejects ${name}`, () => {
  const findings = evaluateImports(files(file, source));
  assert.ok(findings.length > 0, name);
  assert.ok(applyBaseline(findings, baseline).violations.length > 0, `${name} must not inherit baseline`);
});

test("named public contracts and practical pure APIs pass", () => {
  const source = [
    importFixture("../billing/contracts.js", "type { BillingDraftSyncPort }"),
    importFixture("../pricing/formulaDomain.js", "{ validateFormulaRevisionInputValues }") ,
    importFixture("../organization/businessProfile.js", "type { DocumentOrganizationIdentity }"),
    importFixture("../shared/commercialValues.js", "{ canonicalJson }") ,
  ].join("\n");
  assert.deepEqual(evaluateImports(files(moduleFile, source)), []);
  assert.deepEqual(evaluateImports(files("src/modules/inbound/newIntake.ts", importFixture("../sales/orderApplication.js", "type { CreateOrderInput, OrderOperationResult }"))), []);
  assert.ok(!publicApis["sales/orderApplication"].includes("OrderApplicationService"));
});

test("owner operation calls in one transaction pass", () => {
  const source = `${importFixture("../sales/postgresOrderAutomaticLifecycle.js", "{ reconcileOrderInTransaction }")}\n${importFixture("../billing/postgresReplacementInvoice.js", "{ createOrReadReplacementInvoice }")}\nawait reconcileOrderInTransaction(client, input); await createOrReadReplacementInvoice(client, input);`;
  assert.deepEqual(evaluateImports(files("infrastructure/fulfillment/newCoordinator.ts", source)), []);
  assert.deepEqual(evaluateSql(files("infrastructure/fulfillment/newCoordinator.ts", source)), []);
});

test("AST ignores fake imports in comments/strings and recognizes aliased imported symbols", () => {
  assert.deepEqual(evaluateImports(files(moduleFile, `// import { bad } from 'pg';\nconst example = "import { bad } from 'pg'";`)), []);
  const records = extractImports(moduleFile, "import { privateRule as safeLookingAlias } from '../pricing/formulaDomain.js';");
  assert.deepEqual(records[0].symbols, ["privateRule"]);
  assert.ok(evaluateImports(files(moduleFile, "import { privateRule as validateFormulaRevisionInputValues } from '../pricing/formulaDomain.js';")).length);
});

for (const verb of ["INSERT", "UPDATE", "DELETE"]) {
  const sql = verb === "INSERT" ? "INSERT INTO v2_billing_invoices(id) VALUES($1)" : verb === "UPDATE" ? "UPDATE v2_billing_invoices SET subtotal_cents=$1" : "DELETE FROM v2_billing_invoices WHERE id=$1";
  test(`foreign SQL ${verb} fails`, () => {
    const findings = evaluateSql(files(adapterFile, sqlFixture(sql)));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].verb, verb);
    assert.equal(findings[0].owner, "billing");
    assert.equal(findings[0].writer, "sales");
    assert.equal(applyBaseline(findings, baseline).violations.length, 1);
  });
  test(`own SQL ${verb} passes`, () => assert.deepEqual(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture(sql))), []));
  test(`legacy V1 SQL ${verb} fails even for owner`, () => {
    const legacy = sql.replaceAll("v2_billing_invoices", "invoices");
    assert.ok(applyBaseline(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture(legacy))), baseline).violations.length);
  });
}

test("reads, foreign FOR UPDATE/NO KEY UPDATE locks and SQL string data pass", () => {
  for (const sql of [
    "SELECT * FROM v2_billing_invoices", "SELECT * FROM v2_billing_invoices FOR UPDATE",
    "SELECT * FROM v2_billing_invoices FOR UPDATE OF i SKIP LOCKED", "SELECT * FROM v2_billing_invoices FOR NO KEY UPDATE",
    "SELECT 'DELETE FROM v2_billing_invoices' AS example", "SELECT '--' AS example /* UPDATE fake SET x=1 */",
  ]) assert.deepEqual(evaluateSql(files(adapterFile, sqlFixture(sql))), [], sql);
  assert.equal(evaluateSql(files(adapterFile, sqlFixture("SELECT * FROM v2_billing_invoices FOR UPDATE; DELETE FROM v2_billing_invoices"))).length, 1);
  assert.equal(evaluateSql(files(adapterFile, sqlFixture("SELECT '--' AS example; DELETE FROM v2_billing_invoices"))).length, 1);
});

test("CTE mutations, schema/quoted/ONLY targets and conflict clauses are classified", () => {
  assert.deepEqual(sqlWriteTargets('WITH removed AS (DELETE FROM public."v2_billing_invoices" RETURNING *) SELECT * FROM removed'), [{ verb: "DELETE", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("UPDATE ONLY public.v2_billing_invoices SET revision=1"), [{ verb: "UPDATE", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("INSERT INTO v2_billing_invoices(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id"), [{ verb: "INSERT", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("-- DELETE FROM fake\nSELECT * FROM v2_billing_invoices FOR UPDATE"), []);
  assert.deepEqual(sqlWriteTargets('WITH added AS (INSERT INTO public."v2_billing_invoices"(id) VALUES(1) RETURNING *) SELECT * FROM added'), [{ verb: "INSERT", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("WITH changed AS (UPDATE v2_billing_invoices\nSET revision=1 RETURNING *) SELECT * FROM changed"), [{ verb: "UPDATE", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("SELECT '\\' AS example; DELETE FROM v2_billing_invoices"), [{ verb: "DELETE", table: "v2_billing_invoices" }]);
  assert.deepEqual(sqlWriteTargets("/* outer /* inner */ ' DELETE FROM fake */ DELETE FROM v2_billing_invoices"), [{ verb: "DELETE", table: "v2_billing_invoices" }]);
});

test("snapshot rows and shared durable platform writes pass without competing owner", () => {
  assert.deepEqual(evaluateSql(files(adapterFile, sqlFixture("INSERT INTO v2_order_line_material_requirements(id) SELECT id FROM v2_product_recipes"))), []);
  assert.deepEqual(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture("INSERT INTO v2_billing_invoice_checkpoints(id) SELECT id FROM v2_sales_documents"))), []);
  for (const table of ["v2_operation_requests", "v2_outbox_messages", "v2_principal_attributions"]) {
    assert.deepEqual(evaluateSql(files(adapterFile, sqlFixture(`INSERT INTO ${table}(id) VALUES($1)`))), []);
  }
});

test("BDR-5 audit history has no blanket platform mutation permission", () => {
  assert.equal(tableOwner("v2_audit_events"), "deferred");
  for (const sql of ["INSERT INTO v2_audit_events(id) VALUES(1)", "UPDATE v2_audit_events SET changes='[]'", "DELETE FROM v2_audit_events", "TRUNCATE v2_audit_events"]) {
    assert.ok(applyBaseline(evaluateSql(files(adapterFile, sqlFixture(sql))), baseline).violations.length, sql);
  }
});

test("table ownership is not directory hosting or table-name permission", () => {
  assert.equal(tableOwner("v2_fulfillment_shipments"), "shipping");
  assert.equal(writerDomain("infrastructure/fulfillment/postgresShipmentContainerTransaction.ts"), "shipping");
  assert.deepEqual(evaluateSql(files("infrastructure/fulfillment/postgresShipmentContainerTransaction.ts", sqlFixture("INSERT INTO v2_fulfillment_shipments(id) VALUES($1)"))), []);
  assert.ok(evaluateSql(files("infrastructure/fulfillment/newAdapter.ts", sqlFixture("INSERT INTO v2_fulfillment_shipments(id) VALUES($1)"))).length);
  assert.equal(tableOwner("v2_permission_sets"), "authentication");
  assert.equal(writerDomain("infrastructure/organization/postgresTeamAccess.ts"), "settings");
  assert.ok(applyBaseline(evaluateSql(files("infrastructure/organization/postgresTeamAccess.ts", sqlFixture("DELETE FROM v2_permission_sets WHERE id=$1"))), baseline).violations.length);
  assert.equal(tableOwner("v2_billing_new_unreviewed_table"), "unknown");
  assert.equal(tableOwner("v2_sales_tax_jurisdictions"), "settings");
  assert.equal(writerDomain("infrastructure/sales/postgresSalesTaxSettings.ts"), "settings");
  assert.ok(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture("DELETE FROM other_schema.v2_billing_invoices"))).length);
  assert.ok(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture('DELETE FROM "V2_BILLING_INVOICES"'))).length);
  assert.ok(evaluateSql(files("infrastructure/billing/newAdapter.ts", sqlFixture('DELETE FROM "v2_""billing_invoices"'))).length);
});

test("deferred tables are exact existing evidence, not permissions", () => {
  for (const table of ["pbv2_tree_versions", "customer_portal_access", "v2_product_version_formula_revision_bindings", "v2_proof_delivery_jobs"]) {
    assert.equal(tableOwner(table), "deferred");
    assert.ok(applyBaseline(evaluateSql(files("infrastructure/products/newAdapter.ts", sqlFixture(`INSERT INTO ${table}(id) VALUES($1)`))), baseline).violations.length);
  }
});

test("new Inventory dual-counter writes fail despite Inventory ownership", () => {
  const findings = evaluateSql(files("infrastructure/inventory/newLedger.ts", sqlFixture("UPDATE materials SET stock_quantity=stock_quantity+$1")));
  assert.equal(findings[0].id, "BD-6");
  assert.equal(applyBaseline(findings, baseline).violations.length, 1);
});

test("mutable query configuration references cannot hide a foreign target", () => {
  const source = "const config = {text: 'DELETE FROM v2_sales_documents'}; config.text = sqlFromRequest; await client.query(config);";
  assert.ok(evaluateSql(files(adapterFile, source)).length > 0);
});

test("AST handles constants, concatenation, conditional SQL, object query config and custom SQL wrappers", () => {
  const source = "const prefix = 'DELETE FROM '; const target = 'v2_billing_invoices'; const sql = prefix + target; await client.query(sql);";
  assert.equal(evaluateSql(files(adapterFile, source))[0].table, "v2_billing_invoices");
  assert.equal(evaluateSql(files(adapterFile, "await client.query(flag ? 'DELETE FROM v2_billing_invoices' : 'SELECT * FROM v2_sales_documents');")).length, 1);
  assert.equal(evaluateSql(files(adapterFile, "await client.query({text: 'DELETE FROM v2_billing_invoices', values: []});")).length, 1);
  assert.equal(evaluateSql(files(adapterFile, "await customWrapper('DELETE FROM v2_billing_invoices');")).length, 1);
  assert.equal(evaluateSql(files(moduleFile, "const raw = 'INSERT INTO v2_sales_documents(id) VALUES(1)'; db.execute(raw);"))[0].id, "SQL-DOMAIN");
  assert.equal(evaluateSql(files(moduleFile, "await client.query('SELECT * FROM v2_sales_documents');"))[0].id, "SQL-DOMAIN");
});

for (const source of [
  "await client.query(sqlFromRequest);", "await client.query(`UPDATE ${tableFromRequest} SET value=$1`);",
  "await client.query('DELETE FROM ' + tableFromRequest);", "await client.execute(makeSql());",
  "await client.query(`SELECT * FROM ${tableFromRequest}`);", "await client.query(`SELECT 1 ${suffixFromRequest}`);",
  "await client.query('CALL mutate_foreign_owner()');", "await client.query('DO $$ BEGIN DELETE FROM invoices; END $$');",
  "await client.query('TRUNCATE v2_sales_documents, v2_billing_invoices');",
]) test(`unresolved SQL fails closed: ${source}`, () => {
  assert.ok(applyBaseline(evaluateSql(files(adapterFile, source)), baseline).violations.length);
});

test("baseline requires exact file, hash, symbols, target and occurrence budget", () => {
  const source = importFixture("../pricing/formulaDomain.js", "{ privateRule as alias }");
  const finding = evaluateImports(files(moduleFile, source))[0];
  const entry = { ...finding, ruleId: finding.id, count: 1 };
  assert.equal(applyBaseline([finding], [entry]).violations.length, 0);
  assert.equal(applyBaseline([finding, finding], [entry]).violations.length, 1);
  assert.equal(applyBaseline([finding], []).violations.length, 1);
  for (const patch of [{ file: "src/modules/sales/other.ts" }, { hash: fingerprint("changed") }, { symbols: ["another"] }, { specifier: "../pricing/other.js" }]) assert.equal(applyBaseline([{ ...finding, ...patch }], [entry]).violations.length, 1);
  const sqlFinding = evaluateSql(files(adapterFile, sqlFixture("DELETE FROM v2_billing_invoices")))[0];
  const sqlEntry = { ...sqlFinding, count: 1 };
  assert.equal(applyBaseline([sqlFinding, sqlFinding], [sqlEntry]).violations.length, 1);
  assert.equal(applyBaseline([{ ...sqlFinding, table: "v2_billing_payments" }], [sqlEntry]).violations.length, 1);
  assert.equal(applyBaseline([{ ...sqlFinding, verb: "INSERT" }], [sqlEntry]).violations.length, 1);
});

test("namespace V1 bridges track used symbols, computed access and escaping", () => {
  const file = "infrastructure/accounting/quickBooksIntegrationReadiness.ts";
  const clean = "import * as qb from '../../../server/quickbooksService.js'; qb.getAuthorizationUrlForOrganization(org);";
  assert.deepEqual(extractImports(file, clean)[0].symbols, ["getAuthorizationUrlForOrganization"]);
  const injected = `${clean} qb.importQBInvoicesByIds(org, ids);`;
  assert.ok(applyBaseline(evaluateImports(files(file, injected)), baseline).violations.some((x) => x.id === "BD-5"));
  const bracket = `${clean} qb['importQBInvoicesByIds'](org, ids);`;
  assert.ok(applyBaseline(evaluateImports(files(file, bracket)), baseline).violations.length);
  const escape = `${clean} const alias = qb; alias.importQBInvoicesByIds(org, ids);`;
  assert.ok(extractImports(file, escape)[0].symbols.includes("<namespace-escape>"));
});

test("BD-5 is call-site aware even when imported symbol is unchanged or aliased", () => {
  const file = "infrastructure/accounting/quickBooksBillingQueue.ts";
  const source = "import { importQBInvoicesByIds as innocent } from '../../../server/quickbooksService.js'; await innocent(org, ids);";
  const findings = evaluateImports(files(file, source));
  assert.equal(findings.filter((x) => x.specifier.startsWith("#call:")).length, 1);
  const local = findings.map((x) => ({ ...x, ruleId: x.id, count: 1 }));
  assert.equal(applyBaseline(findings, local).violations.length, 0);
  assert.equal(applyBaseline(evaluateImports(files(file, `${source} await innocent(org, ids);`)), local).violations.length, 1);
  assert.ok(applyBaseline(evaluateImports(files(file, `${source} const hidden = innocent; hidden(org, ids);`)), local).violations.length);
});

test("scope shadowing and mutable query bindings never hide unresolved SQL", () => {
  const source = "const sql = 'SELECT 1'; async function write(sql: string) { await client.query(sql); }";
  assert.ok(evaluateSql(files(adapterFile, source)).some((finding) => finding.table === "<unresolved>"));
  assert.ok(evaluateSql(files(adapterFile, "let sql = 'SELECT 1'; sql = request.sql; await client.query(sql);")).length);
  assert.equal(evaluateSql(files(adapterFile, "const sql = 'SELECT 1'; { const sql = 'DELETE FROM v2_billing_invoices'; await client.query(sql); }")).length, 1);
});

test("conditional SQL target fragments evaluate every branch rather than joining targets", () => {
  for (const source of [
    "await client.query('DELETE FROM ' + (flag ? 'v2_sales_documents' : 'v2_billing_invoices'));",
    "await client.query(`UPDATE ${flag ? 'v2_sales_documents' : 'v2_billing_invoices'} SET revision=1`);",
    "const table = flag ? 'v2_sales_documents' : 'v2_billing_invoices'; await client.query('DELETE FROM '+table);",
  ]) assert.ok(evaluateSql(files(adapterFile, source)).some((finding) => finding.table === "v2_billing_invoices"), source);
});

test("unresolved SQL baseline also pins builder outside the query function", () => {
  const source = "function buildSql(){return unknownSql;} function run(){return client.query(buildSql());}";
  const findings = evaluateSql(files(adapterFile, source));
  const local = findings.map((finding) => ({ ...finding, count: 1 }));
  assert.equal(applyBaseline(findings, local).violations.length, 0);
  for (const replacement of ["return 'DELETE ' + 'FROM v2_billing_invoices';", "return otherOpaqueBuilder();"]) {
    const mutated = source.replace("return unknownSql;", replacement);
    assert.ok(applyBaseline(evaluateSql(files(adapterFile, mutated)), local).violations.length);
  }
});

test("original Staff test/rehearsal/issuer exceptions remain narrow", () => {
  assert.deepEqual(evaluateImports(files("tests/staffGuard.test.ts", importFixture("../src/authorization/staffAuthorityCompatibility.js"))), []);
  assert.deepEqual(evaluateImports(files("src/authorization/temporaryStaffPrincipalIssuer.ts", importFixture("./staffAuthorityCompatibility.js"))), []);
  assert.deepEqual(evaluateImports(files("scripts/runM14StaffAuthorityCompatibilityRehearsal.ts", importFixture("../src/authorization/temporaryStaffPrincipalIssuer.js"))), []);
  assert.ok(evaluateImports(files("scripts/newRehearsal.ts", importFixture("../src/authorization/temporaryStaffPrincipalIssuer.js"))).length);
});

test("harness safety API is not a general V1 bridge exemption", () => {
  assert.deepEqual(evaluateImports(files("scripts/guarded-test-entry.ts", importFixture("../../server/tests/helpers/safeTestDatabase.js", "{ requireSafeTestDatabaseUrl }"))), []);
  assert.ok(evaluateImports(files("scripts/guarded-test-entry.ts", importFixture("../../server/tests/helpers/safeTestDatabase.js", "{ requireSafeTestDatabaseUrl, unsafeHelper }"))).length);
  assert.ok(evaluateImports(files(adapterFile, importFixture("../../../server/tests/helpers/safeTestDatabase.js", "{ requireSafeTestDatabaseUrl }"))).length);
});

test("real tree passes exactly while every known BD ID remains visible", async () => {
  const tree = await readArchitectureFiles();
  const imports = applyBaseline(evaluateImports(tree), baseline);
  const sql = applyBaseline(evaluateSql(tree), baseline);
  assert.deepEqual(imports.violations, []);
  assert.deepEqual(sql.violations, []);
  const ids = new Set([...imports.matched, ...sql.matched].map((entry) => entry.id));
  for (let n = 1; n <= 7; n++) assert.ok(ids.has(`BD-${n}`), `BD-${n} must remain visible`);
  for (const entry of baseline) {
    assert.match(entry.hash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(entry.count) && entry.count > 0);
    assert.ok(entry.file && entry.reason && entry.reference.includes("V2_MODULE_OWNERSHIP_BOUNDARIES.md"));
    assert.ok(!entry.file.includes("*"));
  }
  assert.equal(imports.matched.length + sql.matched.length, baseline.length, "no stale permissions may remain after parser/baseline retirement");
  for (const entry of [...imports.matched, ...sql.matched]) assert.equal(entry.observed, entry.count, `exact observed count ${entry.file}:${entry.hash}`);
  const keys = baseline.map((entry) => JSON.stringify([entry.kind, entry.file, entry.hash, entry.table, entry.verb, entry.specifier, entry.symbols]));
  assert.equal(new Set(keys).size, keys.length, "duplicate baseline fingerprints must never multiply permission budgets");
});

test("real-tree duplicate debt and bridge calls fail, and retirement shrinks observed budget", async () => {
  const tree = await readArchitectureFiles();
  for (const id of ["BD-1", "BD-2", "BD-3", "BD-4", "BD-6"]) {
    const entry = baseline.find((item) => item.id === id && item.kind === "sql");
    const file = tree.find((item) => item.file === entry.file);
    const sql = extractSql(file.file, file.source).find((item) => item.hash === entry.hash && item.table === entry.table);
    const mutated = tree.map((item) => item === file ? { ...item, source: item.source + "\n" + sqlFixture(sql.statement) } : item);
    assert.ok(applyBaseline(evaluateSql(mutated), baseline).violations.length, `duplicate ${id}`);
  }
  const entry = baseline.find((item) => item.id === "BD-5" && item.specifier.startsWith("#call:"));
  const file = tree.find((item) => item.file === entry.file);
  const mutated = tree.map((item) => item === file ? { ...item, source: item.source + "\nimportQBInvoicesByIds(org, ids);" } : item);
  assert.ok(applyBaseline(evaluateImports(mutated), baseline).violations.some((x) => x.specifier.startsWith("#call:")));
  const original = applyBaseline(evaluateImports(tree), baseline);
  const retired = tree.filter((item) => item.file !== "src/modules/inventory/inventoryLedger.ts");
  assert.ok(applyBaseline(evaluateImports(retired), baseline).matched.length < original.matched.length);
  assert.ok(applyBaseline(evaluateImports(retired), baseline).retired.some((item) => item.id === "BD-7"));
  const removedBaseline = baseline.filter((item) => item.id !== "BD-7");
  assert.equal(applyBaseline(evaluateImports(tree), removedBaseline).violations.filter((item) => item.id === "BD-7").length, 2);
});

test("deterministic evaluator output is independent of input order", () => {
  const fixture = [files(moduleFile, importFixture("pg"))[0], files("src/modules/billing/newFile.ts", importFixture("pg"))[0]];
  assert.deepEqual(evaluateImports(fixture), evaluateImports([...fixture].reverse()));
  const source = "import {\n  privateRule\n} from '../pricing/formulaDomain.js';\n";
  assert.deepEqual(evaluateImports(files(moduleFile, source)), evaluateImports(files(moduleFile, source.replaceAll("\n", "\r\n"))));
  const dynamic = "function builder() { return sqlFromRequest; }\nawait client.query(builder());\n";
  assert.deepEqual(evaluateSql(files(adapterFile, dynamic)), evaluateSql(files(adapterFile, dynamic.replaceAll("\n", "\r\n"))));
});
