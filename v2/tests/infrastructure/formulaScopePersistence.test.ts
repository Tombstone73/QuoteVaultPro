import { describe, expect, test } from "@jest/globals";
import { PostgresFormulaDomainReads } from "../../infrastructure/pricing/postgresFormulaDomain";

const queryRecorder = () => {
  const calls: Array<{ text: string; values?: readonly unknown[] }> = [];
  return {
    calls,
    pool: {
      query: async <T>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values });
        return { rows: [] as T[] };
      },
    },
  };
};

describe("Formula scope persistence enforcement", () => {
  test("tenant Formula reads bind tenant identity, and a Product picker receives only library plus its own scope", async () => {
    const recorder = queryRecorder();
    const reads = new PostgresFormulaDomainReads(recorder.pool as any);
    await expect(reads.get("tenant-a", "formula-from-tenant-b")).resolves.toBeNull();
    expect(recorder.calls[0]).toMatchObject({ values: ["tenant-a", "formula-from-tenant-b"] });
    expect(recorder.calls[0]?.text).toContain("f.organization_id=$1 AND f.id=$2");

    await reads.list("tenant-a", { productId: "product-a", query: "area" });
    expect(recorder.calls[1]?.text).toContain("f.visibility='library' OR (f.visibility='product_scoped' AND f.scope_product_id=$2)");
    expect(recorder.calls[1]).toMatchObject({ values: ["tenant-a", "product-a", "%area%"] });
  });

  test("general Formula Library reads do not expose unlisted Product-scoped identities", async () => {
    const recorder = queryRecorder();
    const reads = new PostgresFormulaDomainReads(recorder.pool as any);
    await reads.list("tenant-a");
    expect(recorder.calls[0]?.text).toContain("AND f.visibility='library'");
    expect(recorder.calls[0]).toMatchObject({ values: ["tenant-a"] });
  });
});
