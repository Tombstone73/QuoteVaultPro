import { describe, expect, test } from "@jest/globals";
import { auditLogs, pbv2TreeVersions, products, productTypes } from "@shared/schema";
import {
  CanonicalProductEditorSaveError,
  saveActiveProductEditorConfiguration,
} from "../services/products/canonicalProductEditorSaveOperations";

const activeTree = {
  schemaVersion: 2,
  status: "ACTIVE",
  rootNodeIds: [],
  nodes: {},
  edges: [],
  meta: { pricingV2: { base: { perPieceCents: 6000 } } },
};

function fixture(failAt?: "version_insert") {
  let committed = {
    product: {
      id: "product", organizationId: "tenant-a", name: "Stickers",
      isActive: true, pbv2ActiveTreeVersionId: "active-1",
      primaryMaterialId: null, productTypeId: null,
      pricingEngine: "pricingProfile", pricingFormulaId: null,
      updatedAt: new Date("2026-10-01T00:00:00.000Z"),
      optionTreeJson: activeTree,
    },
    active: { id: "active-1", organizationId: "tenant-a", productId: "product", status: "ACTIVE", schemaVersion: 2, treeJson: activeTree, updatedAt: new Date("2026-10-01T00:00:00.000Z") },
    draft: { id: "draft-user-work", status: "DRAFT", treeJson: { ...activeTree, status: "DRAFT", note: "unpublished edits" } },
    versions: [] as any[],
    audit: [] as any[],
  };
  const database = {
    transaction: async (work: (tx: any) => Promise<any>) => {
      const pending = structuredClone(committed);
      const tx = {
        select: () => ({
          from: (table: unknown) => ({
            where: () => {
              const rows = table === products ? [pending.product] :
                table === pbv2TreeVersions ? [pending.active] :
                table === productTypes ? [] : [];
              return { limit: async () => rows, then: (resolve: (rows: any[]) => void) => resolve(rows) };
            },
          }),
        }),
        update: (table: unknown) => ({
          set: (patch: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                const target = table === products ? pending.product : pending.active;
                Object.assign(target, patch);
                return [target];
              },
            }),
          }),
        }),
        insert: (table: unknown) => ({
          values: (value: Record<string, unknown>) => ({
            returning: async () => {
              if (table === pbv2TreeVersions && failAt === "version_insert") throw new Error("simulated version insert failure");
              const row = { id: "active-2", ...value };
              if (table === pbv2TreeVersions) pending.versions.push(row);
              return [row];
            },
            then: (resolve: (value: unknown) => void) => {
              if (table === auditLogs) pending.audit.push(value);
              resolve(undefined);
            },
          }),
        }),
      };
      const result = await work(tx);
      committed = pending;
      return result;
    },
  };
  return { database: database as any, state: () => committed };
}

function request() {
  return {
    expectedProductUpdatedAt: "2026-10-01T00:00:00.000Z",
    expectedActiveTreeVersionId: "active-1",
    product: { name: "Stickers updated" },
    treeJson: activeTree,
    confirmWarnings: true,
  };
}

describe("normal live Product Save", () => {
  test("publishes a new ACTIVE version and preserves the existing unpublished DRAFT", async () => {
    const { database, state } = fixture();
    const result = await saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: request(), database,
    });
    expect(result.activeTreeVersionId).toBe("active-2");
    expect(state().active.status).toBe("DEPRECATED");
    expect(state().product.pbv2ActiveTreeVersionId).toBe("active-2");
    expect(state().draft.treeJson.note).toBe("unpublished edits");
    expect(state().versions).toHaveLength(1);
    expect(state().versions[0].treeJson).toEqual({ ...activeTree, status: "ACTIVE" });
    expect(state().active.treeJson).toEqual(activeTree);
    expect(state().audit).toHaveLength(1);
  });

  test("rolls metadata back when version publication fails; no DRAFT is created", async () => {
    const { database, state } = fixture("version_insert");
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: request(), database,
    })).rejects.toThrow("simulated version insert failure");
    expect(state().product.name).toBe("Stickers");
    expect(state().product.pbv2ActiveTreeVersionId).toBe("active-1");
    expect(state().versions).toHaveLength(0);
    expect(state().draft.id).toBe("draft-user-work");
  });

  test("rejects a stale ACTIVE pointer without mutation", async () => {
    const { database, state } = fixture();
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: { ...request(), expectedActiveTreeVersionId: "older" }, database,
    })).rejects.toMatchObject({ code: "PRODUCT_SAVE_STALE" } satisfies Partial<CanonicalProductEditorSaveError>);
    expect(state().product.name).toBe("Stickers");
    expect(state().versions).toHaveLength(0);
  });

  test("requires explicit confirmation of publish warnings without writing", async () => {
    const { database, state } = fixture();
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: { ...request(), confirmWarnings: false }, database,
    })).rejects.toMatchObject({ code: "PRODUCT_SAVE_WARNINGS_CONFIRM_REQUIRED" } satisfies Partial<CanonicalProductEditorSaveError>);
    expect(state().product.name).toBe("Stickers");
    expect(state().versions).toHaveLength(0);
  });

  test("rejects invalid base pricing before metadata changes", async () => {
    const { database, state } = fixture();
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: { ...request(), treeJson: { ...activeTree, meta: { pricingV2: { base: { perPieceCents: -10 } } } } },
      database,
    })).rejects.toThrow();
    expect(state().product.name).toBe("Stickers");
    expect(state().versions).toHaveLength(0);
  });

  test("rejects an invalid option tree before metadata changes", async () => {
    const { database, state } = fixture();
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: {
        ...request(),
        treeJson: { ...activeTree, nodes: {
          invalid: { id: "invalid", type: "INPUT", status: "ENABLED", label: "Invalid", input: { type: "select", selectionKey: "invalid", required: true }, choices: [] },
        } },
      },
      database,
    })).rejects.toThrow();
    expect(state().product.name).toBe("Stickers");
    expect(state().versions).toHaveLength(0);
  });

  test("an unchanged live Product does not create another version", async () => {
    const { database, state } = fixture();
    const result = await saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: { ...request(), product: { name: "Stickers" } }, database,
    });
    expect(result.unchanged).toBe(true);
    expect(result.activeTreeVersionId).toBe("active-1");
    expect(state().versions).toHaveLength(0);
    expect(state().draft.id).toBe("draft-user-work");
  });

  test("keeps Product images behind their separate authorized owner", async () => {
    const { database, state } = fixture();
    await expect(saveActiveProductEditorConfiguration({
      organizationId: "tenant-a", productId: "product", actorUserId: "staff",
      request: { ...request(), treeJson: { ...activeTree, meta: { ...activeTree.meta, productImages: ["unapproved.webp"] } } },
      database,
    })).rejects.toMatchObject({ code: "PRODUCT_SAVE_INVALID" } satisfies Partial<CanonicalProductEditorSaveError>);
    expect(state().versions).toHaveLength(0);
    expect(state().draft.id).toBe("draft-user-work");
  });
});
