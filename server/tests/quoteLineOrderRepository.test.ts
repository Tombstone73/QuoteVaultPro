import { describe, expect, test } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { quotes, quoteLineItems } from "@shared/schema";
import { persistQuoteLineOrder } from "../storage/quoteLineOrder.repo";
import { readFileSync } from "node:fs";

// Transaction/query contract fixture, NOT a substitute for real PostgreSQL.
function fixture() {
  let rows = [
    { id: "a", quoteId: "q", displayOrder: 0, parentLineItemId: null, linePrice: "220.44", quantity: 2 },
    { id: "a1", quoteId: "q", displayOrder: 1, parentLineItemId: "a", linePrice: "108.00", quantity: 2 },
    { id: "b", quoteId: "q", displayOrder: 2, parentLineItemId: null, linePrice: "30.00", quantity: 2 },
  ];
  let failureAt = -1;
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const writes: unknown[] = [];
  const dialect = new PgDialect();
  const quote = { id: "q", organizationId: "org", userId: "user", status: "draft", validUntil: null, convertedToOrderId: null };
  const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const snapshot = structuredClone(rows);
    let count = 0;
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: (where: any) => {
        const statement = dialect.sqlToQuery(where);
        statements.push(statement);
        if (table === quotes) return { for: async (lock: string) => {
          expect(lock).toBe("update");
          return statement.params.includes("org") && statement.params.includes("q") ? [quote] : [];
        } };
        return { orderBy: () => ({ for: async (lock: string) => {
          expect(lock).toBe("update");
          return [...rows].sort((a, b) => a.displayOrder - b.displayOrder);
        } }) };
      } }) }),
      update: (table: unknown) => ({ set: (patch: { displayOrder: number }) => ({ where: async (where: any) => {
        expect(table).toBe(quoteLineItems);
        writes.push(patch);
        if (count++ === failureAt) throw new Error("forced write failure");
        const statement = dialect.sqlToQuery(where);
        statements.push(statement);
        rows = rows.map((row) => statement.params.includes(row.id) ? { ...row, ...patch } : row);
      } }) }),
    };
    try { return await callback(tx); } catch (error) { rows = snapshot; throw error; }
  } };
  return { database: database as any, rows: () => [...rows].sort((a, b) => a.displayOrder - b.displayOrder), statements, writes, quote, failAt: (n: number) => { failureAt = n; } };
}
const input = { organizationId: "org", quoteId: "q", userId: "user", orderedIds: ["b", "a", "a1"], expectedIds: ["a", "a1", "b"] };

describe("atomic Quote sequence repository contract", () => {
  test("persists only displayOrder and a subsequent read returns the new order", async () => {
    const f = fixture(); const before = f.rows();
    await persistQuoteLineOrder(f.database, input);
    expect(f.rows().map((row) => row.id)).toEqual(input.orderedIds);
    for (const row of f.rows()) expect(row).toEqual({ ...before.find((old) => old.id === row.id), displayOrder: row.displayOrder });
    expect(f.writes).toEqual([{ displayOrder: 0 }, { displayOrder: 1 }, { displayOrder: 2 }]);
    expect(f.statements[0].sql).toContain('"organization_id"');
    expect(f.statements[0].sql).toContain('"user_id"');
    expect(f.statements.every((statement) => statement.params.includes("q"))).toBe(true);
    await expect(persistQuoteLineOrder(f.database, input)).rejects.toMatchObject({ statusCode: 409 });
  });
  test("a later stale reorder cannot overwrite the committed sequence", async () => {
    const f = fixture(); await persistQuoteLineOrder(f.database, input);
    await expect(persistQuoteLineOrder(f.database, { ...input, orderedIds: input.expectedIds })).rejects.toMatchObject({ statusCode: 409 });
    expect(f.rows().map((row) => row.id)).toEqual(input.orderedIds);
  });
  test("write failure escapes transaction; retry applies entire sequence", async () => {
    const f = fixture(); f.failAt(1);
    await expect(persistQuoteLineOrder(f.database, input)).rejects.toThrow("forced");
    expect(f.rows().map((row) => row.id)).toEqual(input.expectedIds);
    f.failAt(-1); await persistQuoteLineOrder(f.database, input);
    expect(f.rows().map((row) => row.id)).toEqual(input.orderedIds);
  });
  test("rejects wrong tenant, immutable quotes and empty reorder without writes", async () => {
    const f = fixture();
    await expect(persistQuoteLineOrder(f.database, { ...input, organizationId: "other" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(persistQuoteLineOrder(f.database, { ...input, orderedIds: [] })).rejects.toMatchObject({ statusCode: 400 });
    f.quote.convertedToOrderId = "order" as any;
    await expect(persistQuoteLineOrder(f.database, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.writes).toEqual([]);
  });
  test("ordinary autosave cannot write sequence; GET remains ordered and PDF consumes the projection", () => {
    const route = readFileSync("server/routes/quotes.routes.ts", "utf8");
    const patch = route.slice(route.indexOf('app.patch("/api/quotes/:id/line-items/:lineItemId",'), route.indexOf('app.delete("/api/quotes/:id/line-items/:lineItemId",'));
    expect(patch).not.toContain("updateData.displayOrder =");
    expect(route.indexOf('app.patch("/api/quotes/:id/line-items/order"')).toBeLessThan(route.indexOf('app.patch("/api/quotes/:id/line-items/:lineItemId",'));
    expect(readFileSync("server/storage/quotes.repo.ts", "utf8")).toContain(".orderBy(asc(quoteLineItems.displayOrder), asc(quoteLineItems.id))");
  });
});
