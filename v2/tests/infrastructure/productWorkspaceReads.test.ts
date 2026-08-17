import { describe, expect, test } from "@jest/globals";
import { PostgresProductWorkspaceReads } from "../../infrastructure/products/postgresProductWorkspaceReads";

const tree = {
  schemaVersion: 2, rootNodeIds: ["size"], nodes: {
    size: { id: "size", kind: "question", label: "Size", input: { type: "select", selectionKey: "size", required: true, defaultValue: "small" }, choices: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }] },
  }, meta: {},
};
const row = {
  product_id: "product-a", product_name: "Rigid Sign", product_type_id: "type-a", measurement_mode: "dimensions_required" as const,
  tree_id: "tree-a", tree_schema_version: 2, tree_published_at: new Date("2026-08-17T00:00:00.000Z"), tree_json: tree,
  routing_mode: "route_required" as const, default_route_template_id: "route-a",
};

describe("M4 Product workspace PostgreSQL projection", () => {
  test("binds organization and active Product/PBV2 state for the bounded catalog", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresProductWorkspaceReads({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [row] as T[] }; } } as any);
    await expect(reader.list("org-a", "Rigid")).resolves.toMatchObject([{ productId: "product-a", displayName: "Rigid Sign", requiresDimensions: true, pricingConfiguration: { id: "tree-a" } }]);
    expect(calls[0]!.text).toContain("p.organization_id=$1 AND p.is_active=TRUE");
    expect(calls[0]!.text).toContain("t.id=p.pbv2_active_tree_version_id");
    expect(calls[0]!.text).toContain("t.status='ACTIVE'");
    expect(calls[0]!.values).toEqual(["org-a", "%Rigid%"]);
  });
  test("maps only real PBV2 option structure and returns no foreign/missing detail", async () => {
    const reader = new PostgresProductWorkspaceReads({ query: async <T>() => ({ rows: [row] as T[] }) } as any);
    await expect(reader.get("org-a", "product-a")).resolves.toMatchObject({ productId: "product-a", routePolicy: "route_required", activeConfiguration: { schemaVersion: 2, fields: [{ selectionKey: "size", label: "Size", choices: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }] }] } });
    const missing = new PostgresProductWorkspaceReads({ query: async <T>() => ({ rows: [] as T[] }) } as any);
    await expect(missing.get("org-b", "product-a")).resolves.toBeNull();
  });
});
