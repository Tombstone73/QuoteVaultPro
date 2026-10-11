import { describe, expect, test } from "@jest/globals";
import type { PoolClient } from "pg";
import { PostgresArtworkTransaction } from "../../infrastructure/artwork/postgresArtworkTransaction";
import { brandedId } from "../../src/modules/shared/commercialValues";
import type { ArtworkTransaction } from "../../src/modules/artwork/artworkApplication";

const conditionalInput = (id: string): Parameters<ArtworkTransaction["createOrGetAssignment"]>[0] => ({
  id: brandedId<"ArtworkAssignmentId">(id), organizationId: brandedId<"OrganizationId">("org"), artworkFileId: brandedId<"ArtworkFileId">(`file-${id}`),
  usage: { orderId: brandedId<"OrderId">("order"), orderLineId: brandedId<"OrderLineId">("line"), purpose: "production", side: "front", sourcePageIndex: 0, layerKey: "ink", layerOrder: 0 },
  expectedEmptyProductionSlot: { requirementKey: "front-ink" },
});

describe("Artwork assignment removal audit persistence", () => {
  test("two different files competing for an empty frozen slot serialize on the existing Order lock", async () => {
    const rows: Record<string, unknown>[] = [];
    const calls: string[] = [];
    let tail = Promise.resolve();
    const transaction = async (input: ReturnType<typeof conditionalInput>) => {
      let unlock = () => {};
      const client = { query: async (sql: string, values: readonly unknown[] = []) => {
        calls.push(sql);
        if (sql.includes("FROM v2_sales_documents")) {
          const previous = tail;
          tail = new Promise<void>(resolve => { unlock = resolve; });
          await previous;
          return { rows: [{ id: "order" }] };
        }
        if (sql.includes("FROM v2_sales_order_details")) return { rows: [{ document_id: "order" }] };
        if (sql.includes("FROM v2_sales_line_production_requirements")) {
          expect(sql).toContain("l.document_id=$2");
          expect(sql).toContain("r.side IS NOT DISTINCT FROM $5::text");
          expect(sql).toContain("r.source_page_index IS NOT DISTINCT FROM $6::integer");
          expect(sql).toContain("r.layer_key IS NOT DISTINCT FROM $7::text");
          expect(sql).toContain("r.layer_order IS NOT DISTINCT FROM $8::integer");
          const exact = JSON.stringify(values) === JSON.stringify(["org", "order", "line", "front-ink", "front", 0, "ink", 0]);
          return { rows: exact ? [{ requirement_key: "front-ink" }] : [] };
        }
        if (sql.includes("FROM v2_current_artwork_assignments")) {
          expect(sql).toContain("successor.supersedes_artwork_assignment_id=a.id");
          expect(values).toEqual(["org", "order", "line", "front", 0, "ink", 0]);
          return { rows };
        }
        if (sql.includes("INSERT INTO v2_artwork_assignments")) {
          const row = { id: values[0], organization_id: values[1], artwork_file_id: values[2], order_document_id: values[3], order_line_id: values[4], purpose: values[5], side: values[6], source_page_index: values[7], layer_key: values[8], layer_order: values[9], supersedes_artwork_assignment_id: null, created_at: new Date("2026-10-10T00:00:00Z") };
          rows.push(row); return { rows: [row] };
        }
        return { rows: [] };
      } } as unknown as PoolClient;
      try { return await new PostgresArtworkTransaction(client).createOrGetAssignment(input); }
      finally { unlock(); }
    };
    const results = await Promise.allSettled([transaction(conditionalInput("a")), transaction(conditionalInput("b"))]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(rows).toHaveLength(1);
    expect(calls.filter(sql => sql.includes("INSERT INTO v2_artwork_assignments"))).toHaveLength(1);
    expect(calls.some(sql => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    for (const change of [{ side: "back" as const }, { sourcePageIndex: 1 }, { layerKey: "white" }, { layerOrder: 1 }, { orderLineId: brandedId<"OrderLineId">("other") }]) {
      const input = conditionalInput("mismatch");
      await expect(transaction({ ...input, usage: { ...input.usage, ...change } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(transaction({ ...conditionalInput("missing"), expectedEmptyProductionSlot: { requirementKey: "missing" } })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const generic = { ...conditionalInput("generic"), expectedEmptyProductionSlot: undefined };
    await expect(transaction(generic)).resolves.toMatchObject({ id: "generic" });
    expect(rows).toHaveLength(2);
    expect(calls.every(sql => !/DELETE|UPDATE v2_artwork/u.test(sql))).toBe(true);
  });
  test("binds distinct event/resource parameters and the canonical request attribution", async () => {
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const tx = new PostgresArtworkTransaction({ query: async (sql: string, values: readonly unknown[]) => { calls.push({ sql, values }); return { rows: [] }; } } as unknown as PoolClient);
    const actor = { organizationId: "org", requestId: "operation-request", operation: "artwork.remove.v1", principalKind: "staff" as const, principalSubject: "staff", staffActorUserId: "staff", resourceId: "assignment-b" };
    await tx.attribute({ ...actor, resourceType: "artwork_assignment" });
    await tx.audit({ ...actor, eventType: "artwork_assignment_removed", changes: [{ kind: "artwork_assignment_removed", summary: "Retained file and history." }] });
    expect(calls[0]!.values).toEqual(["org", "operation-request", "artwork.remove.v1", "artwork_assignment", "assignment-b", "staff", "staff", "staff"]);
    expect(calls[1]!.values.slice(0, 9)).toEqual(["org", "operation-request", "artwork.remove.v1", "artwork_assignment_removed", "artwork_assignment", "assignment-b", "staff", "staff", "staff"]);
    // Reusing the event placeholder in a CASE produced incompatible PostgreSQL
    // varchar/text inference. Resource type has its own bind position.
    expect(calls[1]!.sql).toContain("VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)");
    expect(JSON.parse(String(calls[1]!.values[9]))).toEqual([{ kind: "artwork_assignment_removed", summary: "Retained file and history." }]);
    await tx.audit({ ...actor, operation: "artwork.adopt.v1", resourceId: "file", eventType: "artwork_file_adopted", changes: [] });
    expect(calls[2]!.values[4]).toBe("artwork_file");
  });
});
