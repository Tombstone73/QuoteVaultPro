import assert from "node:assert/strict";
import { PostgresProductVersionLifecycleReader } from "../../infrastructure/products/postgresProductVersionLifecycle.js";

const version = (id: string, status: "DRAFT" | "ACTIVE" | "DEPRECATED", updatedAt: string) => ({
  id,
  status,
  schema_version: 2,
  tree_json: {},
  created_at: new Date(updatedAt),
  updated_at: new Date(updatedAt),
  published_at: status === "ACTIVE" ? new Date(updatedAt) : null,
});

const recorded: unknown[][] = [];
const reader = new PostgresProductVersionLifecycleReader({
  query: async <T>(_sql: string, values?: readonly unknown[]) => {
    recorded.push([...(values ?? [])]);
    if (recorded.length === 1) return { rows: [{ pbv2_active_tree_version_id: "active-old" }] as T[] };
    if (recorded.length === 2) return { rows: [
      version("draft-current", "DRAFT", "2026-09-05T00:00:00.000Z"),
      version("newer-history", "DEPRECATED", "2026-09-04T00:00:00.000Z"),
    ] as T[] };
    return { rows: [version("active-old", "ACTIVE", "2026-08-01T00:00:00.000Z")] as T[] };
  },
} as never);

const lifecycle = await reader.read("org-a", "product-a");
assert.equal(lifecycle.active?.productVersionId, "active-old");
assert.equal(lifecycle.draft?.productVersionId, "draft-current");
assert.deepEqual(recorded[2], ["org-a", "product-a", "active-old"]);
console.log("Product lifecycle pointed-active fallback contract passed.");
