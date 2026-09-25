import { describe, expect, test } from "@jest/globals";
import type { PoolClient } from "pg";
import { PostgresArtworkTransaction } from "../../infrastructure/artwork/postgresArtworkTransaction";

describe("Artwork assignment removal audit persistence", () => {
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
