import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { assertV2CommercialPhysicalPostconditions, checkV2CommercialPhysicalPostconditions } from "../infrastructure/sales/commercialPhysicalPostconditions.js";
import { PostgresSalesDocumentNumberAllocator } from "../infrastructure/sales/postgresCommercialPrimitives.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const assert = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(message); };
const pgCode = (error: unknown): string | undefined => error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;

async function expectConstraint(client: PoolClient, action: () => Promise<unknown>, label: string): Promise<void> {
  await client.query("SAVEPOINT m16_expected_failure");
  try {
    await action();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT m16_expected_failure");
    assert(["23503", "23505", "23514"].includes(pgCode(error) ?? ""), `${label}: expected PostgreSQL integrity error, received ${pgCode(error) ?? String(error)}`);
    return;
  }
  await client.query("RELEASE SAVEPOINT m16_expected_failure");
  throw new Error(`${label}: expected integrity rejection.`);
}

async function expectDeferredConstraint(client: PoolClient, constraint: string, setup: () => Promise<unknown>, label: string): Promise<void> {
  await client.query("SAVEPOINT m16_expected_deferred_failure");
  try {
    await setup();
    await client.query(`SET CONSTRAINTS ${constraint} IMMEDIATE`);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT m16_expected_deferred_failure");
    assert(["23503", "23505", "23514"].includes(pgCode(error) ?? ""), `${label}: expected PostgreSQL integrity error, received ${pgCode(error) ?? String(error)}`);
    return;
  }
  await client.query("RELEASE SAVEPOINT m16_expected_deferred_failure");
  throw new Error(`${label}: expected deferred integrity rejection.`);
}

type Fixture = Readonly<{ organizationA: string; organizationB: string; customerA: string; customerAOther: string; customerB: string; contactA: string; contactUnrelated: string; productA: string; productB: string }>;
async function createFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture = { organizationA: `m16-org-a-${suffix}`, organizationB: `m16-org-b-${suffix}`, customerA: `m16-customer-a-${suffix}`, customerAOther: `m16-customer-a-other-${suffix}`, customerB: `m16-customer-b-${suffix}`, contactA: `m16-contact-a-${suffix}`, contactUnrelated: `m16-contact-unrelated-${suffix}`, productA: `m16-product-a-${suffix}`, productB: `m16-product-b-${suffix}` };
  await client.query("BEGIN");
  try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M16 Org A',$2),($3,'M16 Org B',$4)", [fixture.organizationA, `m16-a-${suffix}`, fixture.organizationB, `m16-b-${suffix}`]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'A','A',true,'active'),($3,$2,'A Other','A Other',true,'active'),($4,$5,'B','B',true,'active')", [fixture.customerA, fixture.organizationA, fixture.customerAOther, fixture.customerB, fixture.organizationB]);
    await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'Contact','A','active'),($3,$2,'Contact','Unrelated','active')", [fixture.contactA, fixture.organizationA, fixture.contactUnrelated]);
    await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')", [fixture.organizationA, fixture.customerA, fixture.contactA]);
    await client.query("INSERT INTO products(id,organization_id,name,description) VALUES($1,$2,'A','A'),($3,$4,'B','B')", [fixture.productA, fixture.organizationA, fixture.productB, fixture.organizationB]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  return fixture;
}

async function cleanupFixture(client: PoolClient, fixture: Fixture): Promise<void> {
  await client.query("DELETE FROM organizations WHERE id = ANY($1::text[])", [[fixture.organizationA, fixture.organizationB]]);
}

async function insertDocument(client: PoolClient, fixture: Fixture, id: string, kind: "quote" | "order", number: number, customerId = fixture.customerA): Promise<void> {
  await client.query(
    `INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency)
     VALUES($1,$2,$3,$4,$5,$6,'USD')`,
    [id, fixture.organizationA, kind, number, `${kind}-${number}`, customerId],
  );
  await client.query(kind === "quote"
    ? "INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)"
    : "INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)", [id, fixture.organizationA]);
}

async function runPhysicalIntegrityMatrix(client: PoolClient, fixture: Fixture): Promise<void> {
  const quote = `m16-quote-${randomUUID()}`; const order = `m16-order-${randomUUID()}`;
  const sent = `m16-sent-${randomUUID()}`; const converted = `m16-converted-${randomUUID()}`;
  await client.query("BEGIN");
  try {
    await insertDocument(client, fixture, quote, "quote", 7001);
    await insertDocument(client, fixture, order, "order", 7001);
    await expectConstraint(client, () => client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'quote',7005,'quote-7005',$3,'USD','{"commercialNotes":"duplicate"}'::jsonb)`, [`m16-duplicate-terms-${randomUUID()}`, fixture.organizationA, fixture.customerA]), "Duplicated terms JSON projection");
    await expectConstraint(client, () => client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'quote',7006,'quote-7006',$3,'USD','{"commercial_notes":"duplicate"}'::jsonb)`, [`m16-duplicate-terms-snake-${randomUUID()}`, fixture.organizationA, fixture.customerA]), "Snake-case duplicated terms JSON projection");
    await expectConstraint(client, () => client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,contact_id,currency) VALUES($1,$2,'quote',7003,'quote-7003',$3,$4,'USD')`, [`m16-unrelated-contact-${randomUUID()}`, fixture.organizationA, fixture.customerA, fixture.contactUnrelated]), "Unrelated same-tenant customer/contact reference");
    await expectDeferredConstraint(client, "v2_sales_document_subtype_validate", () => client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency) VALUES($1,$2,'quote',7004,'quote-7004',$3,'USD')`, [`m16-orphan-header-${randomUUID()}`, fixture.organizationA, fixture.customerA]), "Sales document missing typed lifecycle");
    await expectDeferredConstraint(client, "v2_sales_quote_detail_retained_validate", () => client.query("DELETE FROM v2_sales_quote_details WHERE organization_id=$1 AND document_id=$2", [fixture.organizationA, quote]), "Quote lifecycle deletion leaves header orphaned");
    await expectDeferredConstraint(client, "v2_sales_order_detail_retained_validate", () => client.query("DELETE FROM v2_sales_order_details WHERE organization_id=$1 AND document_id=$2", [fixture.organizationA, order]), "Order lifecycle deletion leaves header orphaned");
    await expectConstraint(client, () => client.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)", [order, fixture.organizationA]), "Quote subtype cannot target Order document");
    await expectConstraint(client, () => client.query(`INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency) VALUES($1,$2,'quote',7002,'quote-7002',$3,'USD')`, [`m16-foreign-customer-${randomUUID()}`, fixture.organizationA, fixture.customerB]), "Foreign customer reference");
    await client.query(
      `INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision)
       VALUES($1,$2,$3,0,$4,'Fixture line',2,'USD',1000,2000,900,1800,'price','fingerprint','{}','{}','{}')`,
      [`m16-line-${randomUUID()}`, fixture.organizationA, quote, fixture.productA],
    );
    await expectConstraint(client, () => client.query(
      `INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision)
       VALUES($1,$2,$3,0,$4,'Duplicate position',1,'USD',1,1,1,1,'price2','fingerprint2','{}','{}','{}')`,
      [`m16-line-duplicate-${randomUUID()}`, fixture.organizationA, quote, fixture.productA],
    ), "Duplicate Sales line position");
    await expectConstraint(client, () => client.query(
      `INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision)
       VALUES($1,$2,$3,1,$4,'Foreign Product',1,'USD',1,1,1,1,'price3','fingerprint3','{}','{}','{}')`,
      [`m16-line-foreign-${randomUUID()}`, fixture.organizationA, quote, fixture.productB],
    ), "Foreign product reference");
    const amounts = await client.query<{ calculated_line_cents: string; selling_line_cents: string }>("SELECT calculated_line_cents,selling_line_cents FROM v2_sales_document_lines WHERE organization_id=$1 AND document_id=$2", [fixture.organizationA, quote]);
    assert(amounts.rows[0]?.calculated_line_cents === "2000" && amounts.rows[0]?.selling_line_cents === "1800", "Calculated and selling amounts were not stored separately.");
    await client.query(
      `INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,schema_version,occurred_at,principal_kind,principal_subject,evidence_fingerprint,payload)
       VALUES($1,$2,$3,1,'quote_sent',1,now(),'staff','m16','checkpoint-1','{}')`, [sent, fixture.organizationA, quote],
    );
    await expectDeferredConstraint(client, "v2_sales_converted_checkpoint_relation_validate", () => client.query(
      `INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,schema_version,occurred_at,principal_kind,principal_subject,evidence_fingerprint,payload)
       VALUES($1,$2,$3,2,'quote_converted',1,now(),'staff','m16','orphan-checkpoint-2','{}')`, [`m16-orphan-converted-${randomUUID()}`, fixture.organizationA, quote],
    ), "Converted checkpoint without conversion relation");
    await client.query(
      `INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,schema_version,occurred_at,principal_kind,principal_subject,evidence_fingerprint,payload)
       VALUES($1,$2,$3,2,'quote_converted',1,now(),'staff','m16','checkpoint-2','{}')`, [converted, fixture.organizationA, quote],
    );
    await expectConstraint(client, () => client.query("UPDATE v2_sales_quote_checkpoints SET payload='{\"changed\":true}'::jsonb WHERE id=$1", [sent]), "Checkpoint update");
    await expectConstraint(client, () => client.query("DELETE FROM v2_sales_quote_checkpoints WHERE id=$1", [sent]), "Checkpoint delete");
    await client.query("INSERT INTO v2_sales_quote_conversions(id,organization_id,quote_document_id,source_checkpoint_id,order_document_id,conversion_checkpoint_id) VALUES($1,$2,$3,$4,$5,$6)", [`m16-conversion-${randomUUID()}`, fixture.organizationA, quote, sent, order, converted]);
    const conversion = await client.query("SELECT 1 FROM v2_sales_quote_conversions WHERE organization_id=$1 AND quote_document_id=$2", [fixture.organizationA, quote]);
    const quoteStillExists = await client.query("SELECT 1 FROM v2_sales_quote_details WHERE organization_id=$1 AND document_id=$2", [fixture.organizationA, quote]);
    assert(conversion.rowCount === 1 && quoteStillExists.rowCount === 1, "Conversion did not preserve Quote and its unique relation.");
    await expectConstraint(client, () => client.query("INSERT INTO v2_sales_quote_conversions(id,organization_id,quote_document_id,source_checkpoint_id,order_document_id,conversion_checkpoint_id) VALUES($1,$2,$3,$4,$5,$6)", [`m16-conversion-duplicate-${randomUUID()}`, fixture.organizationA, quote, sent, order, converted]), "Second Quote conversion");
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  console.log("[m1.6] tenant, subtype, line, checkpoint, and conversion integrity matrix passed.");
}

async function runNumberingAndRollbackMatrix(pool: Pool, client: PoolClient, fixture: Fixture): Promise<void> {
  const allocator = new PostgresSalesDocumentNumberAllocator();
  const allocate = async (organizationId: string) => { const worker = await pool.connect(); try { await worker.query("BEGIN"); const number = await allocator.allocate(worker, organizationId, "quote"); await worker.query("COMMIT"); return number; } catch (error) { await worker.query("ROLLBACK"); throw error; } finally { worker.release(); } };
  const [left, right] = await Promise.all([allocate(fixture.organizationA), allocate(fixture.organizationA)]);
  assert([left.core, right.core].map(String).sort().join(",") === "1000,1001", "Concurrent same-org numbering did not serialize safely.");
  const other = await allocate(fixture.organizationB);
  assert(other.core === 1000n, "Organization-scoped counter unexpectedly collided across tenants.");
  await client.query("BEGIN");
  try {
    const rollbackNumber = await allocator.allocate(client, fixture.organizationA, "order");
    await insertDocument(client, fixture, `m16-rollback-${randomUUID()}`, "order", Number(rollbackNumber.core));
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  const rollbackRows = await client.query("SELECT 1 FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='order'", [fixture.organizationA]);
  const rollbackCounter = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM v2_sales_document_number_counters WHERE organization_id=$1 AND document_kind='order'", [fixture.organizationA]);
  assert(rollbackRows.rowCount === 0 && rollbackCounter.rows[0]?.count === "0", "Rollback leaked Sales document or counter state.");
  console.log("[m1.6] concurrent org-scoped numbering and rollback matrix passed.");
}

async function main(): Promise<void> {
  const url = requireV2M0CloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 3 });
  let client: PoolClient | undefined;
  let fixture: Fixture | undefined;
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    client = await pool.connect();
    assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client));
    assertV2CommercialPhysicalPostconditions(await checkV2CommercialPhysicalPostconditions(client));
    fixture = await createFixture(client);
    await runPhysicalIntegrityMatrix(client, fixture);
    await runNumberingAndRollbackMatrix(pool, client, fixture);
    assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client));
    assertV2CommercialPhysicalPostconditions(await checkV2CommercialPhysicalPostconditions(client));
    console.log("[m1.6] commercial persistence physical rehearsal passed.");
  } finally {
    if (client && fixture) await cleanupFixture(client, fixture);
    client?.release();
    await pool.end();
  }
}
main().catch((error: unknown) => { console.error(`[m1.6] validation failed: ${error instanceof Error ? error.message : "unknown failure"}`); process.exitCode = 1; });
