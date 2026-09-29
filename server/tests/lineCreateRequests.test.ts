import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

jest.unstable_mockModule("../db", () => ({ db: {} }));
const { prepareLineCreateRequest, runLineCreateRequest, LINE_CREATE_RETENTION_MS } = await import("../services/lineCreateRequests");
const { orderLineItems, quoteLineItems } = await import("@shared/schema");
const dialect = new PgDialect();

// Transaction/lock model, not a real database. The integration suite exercises
// the same service on PostgreSQL when a dedicated test database is configured.
function databaseModel() {
  const rows: Record<string, any[]> = { order_line_items: [], quote_line_items: [], line_create_requests: [] };
  const locks = new Map<string, Promise<void>>();
  let failReceipt = false;
  const database = {
    transaction: async (operation: (tx: any) => Promise<any>) => {
      const staged: Record<string, any[]> = {};
      let unlock: (() => void) | undefined;
      const tx = {
        execute: async (statement: any) => {
          const query = dialect.sqlToQuery(statement);
          expect(query.sql).toContain("pg_advisory_xact_lock");
          const key = String(query.params[0]);
          const previous = locks.get(key) ?? Promise.resolve();
          const next = new Promise<void>((resolve) => { unlock = resolve; });
          locks.set(key, previous.then(() => next));
          await previous;
        },
        select: () => ({ from: (table: any) => ({ where: (condition: any) => ({ limit: async () => {
          const name = getTableName(table);
          const { params, sql } = dialect.sqlToQuery(condition);
          return [...rows[name], ...(staged[name] ?? [])].filter((row) => {
            return [...sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)].every((match) => {
              const field = match[1].replace(/_([a-z])/g, (_, c) => c.toUpperCase());
              return row[field] === params[Number(match[2]) - 1];
            });
          });
        } }) }) }),
        insert: (table: any) => ({ values: async (row: any) => {
          const name = getTableName(table);
          if (name === "line_create_requests" && failReceipt) { failReceipt = false; throw new Error("receipt write failed"); }
          (staged[name] ??= []).push({ ...row });
        } }),
      };
      try {
        const result = await operation(tx);
        Object.entries(staged).forEach(([name, pending]) => rows[name].push(...pending));
        return result;
      } finally { unlock?.(); }
    },
  };
  return { rows, database: database as any, failNextReceipt: () => { failReceipt = true; } };
}

const requestKey = () => `${Date.now()}:123e4567-e89b-42d3-a456-426614174000`;
const payload = { productId: "product", quantity: 2, width: 24, height: 36, totalPrice: "42.00", parentLineItemId: "parent" };

describe.each(["order", "quote", "quote_draft"] as const)("%s line-create receipts", (documentType) => {
  let model: ReturnType<typeof databaseModel>;
  let inserts: number;
  beforeEach(() => { model = databaseModel(); inserts = 0; });
  const scope = (changes = {}, body = payload) => prepareLineCreateRequest({ organizationId: "org", actorUserId: "actor", documentId: "doc", documentType, ...changes }, requestKey(), body);
  const create = async (tx: any) => {
    const row = { ...payload, id: `line-${++inserts}`, orderId: "doc", quoteId: documentType === "quote_draft" ? null : "doc", createdByUserId: "actor" };
    await tx.insert(documentType === "order" ? orderLineItems : quoteLineItems).values(row);
    return row;
  };
  const count = () => model.rows[documentType === "order" ? "order_line_items" : "quote_line_items"].length;

  test("normal add and sequential/uncertain retry return one canonical identity", async () => {
    const input = scope();
    const first = await runLineCreateRequest(input, create, model.database);
    // Simulate losing the first response after transaction commit.
    const retry = await runLineCreateRequest(input, create, model.database);
    expect(retry.line).toEqual(first.line);
    expect(retry.replayed).toBe(true);
    expect(count()).toBe(1);
    expect(model.rows.line_create_requests).toHaveLength(1);
    expect(first.line).toMatchObject(payload);
  });
  test("simultaneous same-key requests invoke creation once", async () => {
    const input = scope();
    const results = await Promise.all(Array.from({ length: 12 }, () => runLineCreateRequest(input, create, model.database)));
    expect(new Set(results.map((r) => r.line.id)).size).toBe(1);
    expect(count()).toBe(1);
    expect(inserts).toBe(1);
  });
  test("changed payload conflicts while identical content with another key is legitimate", async () => {
    const input = scope();
    await runLineCreateRequest(input, create, model.database);
    const changed = prepareLineCreateRequest(input, input.requestKey, { ...payload, quantity: 3 });
    await expect(runLineCreateRequest(changed, create, model.database)).rejects.toMatchObject({ code: "LINE_CREATE_IDEMPOTENCY_CONFLICT" });
    await runLineCreateRequest({ ...input, requestKey: input.requestKey.replace(/0$/, "1") }, create, model.database);
    expect(count()).toBe(2);
  });
  test("tenant, document, actor and document-type scopes do not collide", async () => {
    const input = scope();
    for (const change of [{}, { organizationId: "other" }, { documentId: "other" }, { actorUserId: "other" }, { documentType: documentType === "order" ? "quote" as const : "order" as const }]) {
      await runLineCreateRequest({ ...input, ...change }, create, model.database);
    }
    expect(model.rows.line_create_requests).toHaveLength(5);
  });
  test("receipt failure rolls back the line and permits a safe retry", async () => {
    const input = scope(); model.failNextReceipt();
    await expect(runLineCreateRequest(input, create, model.database)).rejects.toThrow("receipt write failed");
    expect(count()).toBe(0); expect(model.rows.line_create_requests).toHaveLength(0);
    await runLineCreateRequest(input, create, model.database);
    expect(count()).toBe(1);
  });
  test("failure after insertion rolls back both; deleted results are never recreated", async () => {
    const input = scope();
    await expect(runLineCreateRequest(input, async (tx) => { await create(tx); throw new Error("rollup failed"); }, model.database)).rejects.toThrow("rollup failed");
    expect(count()).toBe(0); expect(model.rows.line_create_requests).toHaveLength(0);
    await runLineCreateRequest(input, create, model.database);
    model.rows[documentType === "order" ? "order_line_items" : "quote_line_items"] = [];
    await expect(runLineCreateRequest(input, create, model.database)).rejects.toMatchObject({ code: "LINE_CREATE_RESULT_REMOVED" });
    expect(count()).toBe(0);
  });
  test("replay cannot return a line moved to another document", async () => {
    const input = scope();
    await runLineCreateRequest(input, create, model.database);
    const row = model.rows[documentType === "order" ? "order_line_items" : "quote_line_items"][0];
    row.orderId = "other-document";
    row.quoteId = "other-document";
    await expect(runLineCreateRequest(input, create, model.database)).rejects.toMatchObject({ code: "LINE_CREATE_RESULT_MOVED" });
    expect(inserts).toBe(1);
  });
});

test("canonical hashes ignore object key order; expired keys remain rejected after receipt cleanup", () => {
  const base = { organizationId: "o", actorUserId: "u", documentType: "order" as const, documentId: "d" };
  const key = requestKey();
  const first = prepareLineCreateRequest(base, key, { a: 1, b: 2 });
  expect(prepareLineCreateRequest(base, key, { b: 2, a: 1 }).requestHash).toBe(first.requestHash);
  expect(prepareLineCreateRequest(base, key, { a: 1, b: 2, specsJson: { idempotencyKey: "different" } }).requestHash).not.toBe(first.requestHash);
  expect(() => prepareLineCreateRequest(base, key, {}, Date.now() + LINE_CREATE_RETENTION_MS + 1)).toThrow("expired");
  expect(() => prepareLineCreateRequest(base, "", {})).toThrow("request key");
});
