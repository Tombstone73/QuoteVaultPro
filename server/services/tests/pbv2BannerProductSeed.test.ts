import { describe, expect, test } from "@jest/globals";

import {
  resolveBannerSeedOrganizationId,
  seedBannerProduct,
  type BannerProductSeedRepository,
  type BannerSeedProduct,
  type BannerSeedProductInput,
  type BannerSeedTreeInput,
  type BannerSeedTreeVersion,
} from "../pbv2BannerProductSeed";

function makeRepo(seed?: {
  product?: BannerSeedProduct | null;
  draft?: BannerSeedTreeVersion | null;
  activeTrees?: BannerSeedTreeVersion[];
}): BannerProductSeedRepository & {
  products: BannerSeedProduct[];
  trees: BannerSeedTreeVersion[];
  calls: Record<string, number>;
} {
  const products: BannerSeedProduct[] = seed?.product ? [{ ...seed.product }] : [];
  const trees: BannerSeedTreeVersion[] = [
    ...(seed?.draft ? [{ ...seed.draft }] : []),
    ...(seed?.activeTrees ?? []).map((tree) => ({ ...tree })),
  ];
  const calls: Record<string, number> = {};
  const count = (key: string) => {
    calls[key] = (calls[key] ?? 0) + 1;
  };

  return {
    products,
    trees,
    calls,
    async findBannerProductTypeId() {
      count("findBannerProductTypeId");
      return "pt_banner";
    },
    async findBannerProduct(organizationId) {
      count("findBannerProduct");
      return products.find((product) => product.organizationId === organizationId && product.name === "Banner") ?? null;
    },
    async createBannerProduct(input: BannerSeedProductInput) {
      count("createBannerProduct");
      const created: BannerSeedProduct = {
        id: "product_banner",
        ...input,
        pbv2ActiveTreeVersionId: null,
        optionTreeJson: null,
      };
      products.push(created);
      return created;
    },
    async updateBannerProduct(productId: string, input: BannerSeedProductInput) {
      count("updateBannerProduct");
      const index = products.findIndex((product) => product.id === productId);
      const updated = { ...products[index], ...input, id: productId };
      products[index] = updated;
      return updated;
    },
    async findDraftTree(organizationId, productId) {
      count("findDraftTree");
      return trees.find((tree) => tree.organizationId === organizationId && tree.productId === productId && tree.status === "DRAFT") ?? null;
    },
    async createDraftTree(input: BannerSeedTreeInput) {
      count("createDraftTree");
      const created: BannerSeedTreeVersion = {
        id: "tree_draft",
        ...input,
      };
      trees.push(created);
      return created;
    },
    async updateDraftTree(treeId: string, input: BannerSeedTreeInput) {
      count("updateDraftTree");
      const index = trees.findIndex((tree) => tree.id === treeId);
      const updated: BannerSeedTreeVersion = { ...trees[index], ...input, id: treeId };
      trees[index] = updated;
      return updated;
    },
    async deprecateActiveTrees(organizationId, productId) {
      count("deprecateActiveTrees");
      let deprecated = 0;
      for (const tree of trees) {
        if (tree.organizationId === organizationId && tree.productId === productId && tree.status === "ACTIVE") {
          tree.status = "DEPRECATED";
          deprecated++;
        }
      }
      return deprecated;
    },
    async publishTree(treeId, treeJson, timestamp) {
      count("publishTree");
      const index = trees.findIndex((tree) => tree.id === treeId);
      const active: BannerSeedTreeVersion = {
        ...trees[index],
        id: treeId,
        status: "ACTIVE",
        treeJson,
        publishedAt: timestamp,
      };
      trees[index] = active;
      return active;
    },
    async linkActiveTree(productId, treeId, treeJson) {
      count("linkActiveTree");
      const product = products.find((entry) => entry.id === productId);
      if (product) {
        product.pbv2ActiveTreeVersionId = treeId;
        product.optionTreeJson = treeJson;
      }
    },
  };
}

const now = new Date("2026-05-27T12:00:00.000Z");

describe("PBV2 Banner product seed", () => {
  test("creates Banner product when missing", async () => {
    const repo = makeRepo();

    const result = await seedBannerProduct(repo, { organizationId: "org_1", now });

    expect(result.productAction).toBe("created");
    expect(result.draftAction).toBe("created");
    expect(result.publishAction).toBe("not_requested");
    expect(repo.products).toHaveLength(1);
    expect(repo.products[0]).toMatchObject({
      organizationId: "org_1",
      name: "Banner",
      category: "Banners",
      isActive: true,
      pbv2ActiveTreeVersionId: null,
    });
    expect(repo.trees[0]).toMatchObject({ status: "DRAFT", schemaVersion: 2 });
  });

  test("updates existing Banner product idempotently", async () => {
    const repo = makeRepo({
      product: {
        id: "existing_banner",
        organizationId: "org_1",
        name: "Banner",
        category: "Old",
        productTypeId: null,
        isActive: false,
      },
      draft: {
        id: "existing_draft",
        organizationId: "org_1",
        productId: "existing_banner",
        status: "DRAFT",
        schemaVersion: 2,
        treeJson: {},
      },
    });

    const first = await seedBannerProduct(repo, { organizationId: "org_1", now });
    const second = await seedBannerProduct(repo, { organizationId: "org_1", now });

    expect(first.productAction).toBe("updated");
    expect(first.draftAction).toBe("updated");
    expect(second.productAction).toBe("updated");
    expect(second.draftAction).toBe("updated");
    expect(repo.products).toHaveLength(1);
    expect(repo.trees.filter((tree) => tree.status === "DRAFT")).toHaveLength(1);
    expect(repo.products[0]).toMatchObject({ id: "existing_banner", category: "Banners", isActive: true });
  });

  test("does not publish unless publish is explicitly passed", async () => {
    const repo = makeRepo();

    const result = await seedBannerProduct(repo, { organizationId: "org_1", now });

    expect(result.publishAction).toBe("not_requested");
    expect(repo.calls.publishTree ?? 0).toBe(0);
    expect(repo.products[0].pbv2ActiveTreeVersionId).toBeNull();
    expect(repo.trees[0].status).toBe("DRAFT");
  });

  test("publishes only when publish is explicitly passed", async () => {
    const repo = makeRepo();

    const result = await seedBannerProduct(repo, { organizationId: "org_1", publish: true, now });

    expect(result.publishAction).toBe("published");
    expect(repo.calls.publishTree).toBe(1);
    expect(repo.products[0].pbv2ActiveTreeVersionId).toBe("tree_draft");
    expect(repo.trees[0].status).toBe("ACTIVE");
  });

  test("missing organization id fails clearly", () => {
    expect(() => resolveBannerSeedOrganizationId({})).toThrow(/Missing organization id/);
  });

  test("dry-run reports actions without mutating", async () => {
    const repo = makeRepo();

    const result = await seedBannerProduct(repo, { organizationId: "org_1", dryRun: true, now });

    expect(result.productAction).toBe("would_create");
    expect(result.draftAction).toBe("would_create");
    expect(repo.products).toHaveLength(0);
    expect(repo.trees).toHaveLength(0);
    expect(repo.calls.createBannerProduct ?? 0).toBe(0);
  });
});
