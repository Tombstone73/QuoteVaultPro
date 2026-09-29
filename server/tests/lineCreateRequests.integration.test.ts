import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { getTableColumns, getTableName, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { orderLineItems, quoteLineItems, lineCreateRequests } from "@shared/schema";
import { safeTestDatabaseUrl } from "./helpers/safeTestDatabase";

// Never use DATABASE_URL as a test target. setup.ts validates/migrates an
// explicitly configured dedicated TEST_DATABASE_URL before this suite runs.
const url = safeTestDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL });
const integration = url ? describe : describe.skip;

integration("PostgreSQL line-create atomicity and concurrent replay", () => {
  const namespace = `line_create_test_${randomUUID().replace(/-/g, "")}`;
  let admin: Pool;
  let pool: Pool;
  let database: any;
  let service: typeof import("../services/lineCreateRequests");
  beforeAll(async () => {
    admin = new Pool({ connectionString: url! });
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    pool = new Pool({ connectionString: url!, options: `-c search_path=${namespace}`, max: 16 });
    database = drizzle(pool);
    await pool.query("CREATE TABLE organizations (id varchar PRIMARY KEY)");
    await pool.query("INSERT INTO organizations VALUES ('tenant-a'), ('tenant-b')");
    await pool.query(readFileSync("server/db/migrations_v2/0216_line_create_requests.sql", "utf8"));
    // Isolated canonical-line fixtures expose the production column shape; no
    // application or historical rows are written. Pricing itself is tested separately.
    for (const table of [orderLineItems, quoteLineItems]) {
      const columns = Object.values(getTableColumns(table)).map((column) => {
        const native = column.getSQLType();
        const type = /^(varchar|text|jsonb|boolean|integer|numeric|decimal|timestamp|double|real|bigint|date)/.test(native) ? native : "text";
        return `"${column.name}" ${type}${column.name === "id" ? " PRIMARY KEY" : ""}`;
      });
      await pool.query(`CREATE TABLE "${getTableName(table)}" (${columns.join(",")})`);
    }
    service = await import("../services/lineCreateRequests");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await admin.end(); }
  });

  test.each(["order", "quote", "quote_draft"] as const)("%s: real concurrent transactions, rollback, conflict and retention", async (documentType) => {
    const table = documentType === "order" ? orderLineItems : quoteLineItems;
    const input = service.prepareLineCreateRequest({ organizationId: "tenant-a", actorUserId: "actor", documentType, documentId: randomUUID() }, `${Date.now()}:${randomUUID()}`, { quantity: 2 });
    let creates = 0;
    const create = async (tx: any) => {
      creates++;
      const [line] = await tx.insert(table).values({ id: randomUUID(), quantity: 2, ...(documentType === "order" ? { orderId: input.documentId } : { quoteId: documentType === "quote" ? input.documentId : null, createdByUserId: input.actorUserId }) }).returning();
      return line;
    };
    const responses = await Promise.all(Array.from({ length: 12 }, () => service.runLineCreateRequest(input, create, database)));
    expect(creates).toBe(1);
    expect(new Set(responses.map((r) => r.line.id)).size).toBe(1);
    expect((await service.runLineCreateRequest(input, create, database)).line.id).toBe(responses[0].line.id);
    await expect(service.runLineCreateRequest({ ...input, requestHash: "different" }, create, database)).rejects.toMatchObject({ code: "LINE_CREATE_IDEMPOTENCY_CONFLICT" });
    const distinct = { ...input, requestKey: `${Date.now()}:${randomUUID()}` };
    expect((await service.runLineCreateRequest(distinct, create, database)).line.id).not.toBe(responses[0].line.id);
    const tenant = await service.runLineCreateRequest({ ...input, organizationId: "tenant-b" }, create, database);
    expect(tenant.line.id).not.toBe(responses[0].line.id);

    const rollback = { ...input, requestKey: `${Date.now()}:${randomUUID()}` };
    let rolledBackId: string | undefined;
    await expect(service.runLineCreateRequest(rollback, async (tx) => { const row = await create(tx); rolledBackId = row.id; throw new Error("rollup failed"); }, database)).rejects.toThrow("rollup failed");
    expect(await database.select().from(table).where(eq(table.id, rolledBackId!))).toHaveLength(0);
    expect(await database.select().from(lineCreateRequests).where(eq(lineCreateRequests.requestKey, rollback.requestKey))).toHaveLength(0);
    // A receipt failure after line insertion also rolls the line back.
    await expect(service.runLineCreateRequest({ ...rollback, organizationId: "missing-tenant" }, create, database)).rejects.toThrow();
    await database.update(lineCreateRequests).set({ expiresAt: new Date(0) }).where(eq(lineCreateRequests.requestKey, input.requestKey));
    await service.cleanupLineCreateRequests(database);
    expect(await database.select().from(table).where(eq(table.id, responses[0].line.id))).toHaveLength(1);
  });
});
