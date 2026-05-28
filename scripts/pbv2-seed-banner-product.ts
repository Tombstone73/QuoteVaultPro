import "dotenv/config";
import { and, eq } from "drizzle-orm";

import { db, pool } from "../server/db";
import {
  seedBannerProduct,
  type BannerProductSeedOptions,
  type BannerProductSeedRepository,
  type BannerSeedProductInput,
  type BannerSeedTreeInput,
} from "../server/services/pbv2BannerProductSeed";
import { pbv2TreeVersions, products, productTypes } from "../shared/schema";

function parseArgs(argv: string[]): BannerProductSeedOptions {
  const values = new Map<string, string | boolean>();
  const valueFlags = new Set(["organization-id", "org"]);
  const booleanFlags = new Set(["publish", "dry-run", "use-default-dev-org"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);

    if (booleanFlags.has(rawKey)) {
      values.set(rawKey, true);
      continue;
    }

    if (!valueFlags.has(rawKey)) {
      throw new Error(`Unknown option --${rawKey}`);
    }

    if (inlineValue !== undefined) {
      values.set(rawKey, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`--${rawKey} requires a value.`);
    }
    values.set(rawKey, next);
    i++;
  }

  return {
    organizationId: String(values.get("organization-id") ?? values.get("org") ?? "").trim(),
    publish: values.get("publish") === true,
    dryRun: values.get("dry-run") === true,
    useDefaultDevOrg: values.get("use-default-dev-org") === true,
  };
}

const repo: BannerProductSeedRepository = {
  async findBannerProductTypeId(organizationId) {
    const rows = await db
      .select({ id: productTypes.id, name: productTypes.name })
      .from(productTypes)
      .where(eq(productTypes.organizationId, organizationId));

    const match = rows.find((row) => {
      const name = String(row.name ?? "").trim().toLowerCase();
      return name === "banner" || name === "banners";
    });

    return match?.id ?? null;
  },

  async findBannerProduct(organizationId) {
    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.name, "Banner")))
      .limit(1);
    return existing ?? null;
  },

  async createBannerProduct(input: BannerSeedProductInput) {
    const [created] = await db
      .insert(products)
      .values(input as any)
      .returning();
    return created;
  },

  async updateBannerProduct(productId: string, input: BannerSeedProductInput) {
    const [updated] = await db
      .update(products)
      .set(input as any)
      .where(and(eq(products.organizationId, input.organizationId), eq(products.id, productId)))
      .returning();
    return updated;
  },

  async findDraftTree(organizationId, productId) {
    const [existingDraft] = await db
      .select()
      .from(pbv2TreeVersions)
      .where(
        and(
          eq(pbv2TreeVersions.organizationId, organizationId),
          eq(pbv2TreeVersions.productId, productId),
          eq(pbv2TreeVersions.status, "DRAFT"),
        ),
      )
      .limit(1);
    return existingDraft ?? null;
  },

  async createDraftTree(input: BannerSeedTreeInput) {
    const [created] = await db
      .insert(pbv2TreeVersions)
      .values(input as any)
      .returning();
    return created;
  },

  async updateDraftTree(treeId: string, input: BannerSeedTreeInput) {
    const [updated] = await db
      .update(pbv2TreeVersions)
      .set({
        schemaVersion: input.schemaVersion,
        treeJson: input.treeJson,
        updatedAt: input.updatedAt,
      } as any)
      .where(eq(pbv2TreeVersions.id, treeId))
      .returning();
    return updated;
  },

  async deprecateActiveTrees(organizationId, productId, timestamp) {
    const deprecated = await db
      .update(pbv2TreeVersions)
      .set({ status: "DEPRECATED", updatedAt: timestamp } as any)
      .where(
        and(
          eq(pbv2TreeVersions.organizationId, organizationId),
          eq(pbv2TreeVersions.productId, productId),
          eq(pbv2TreeVersions.status, "ACTIVE"),
        ),
      )
      .returning({ id: pbv2TreeVersions.id });
    return deprecated.length;
  },

  async publishTree(treeId, treeJson, timestamp) {
    const [active] = await db
      .update(pbv2TreeVersions)
      .set({
        status: "ACTIVE",
        treeJson,
        publishedAt: timestamp,
        updatedAt: timestamp,
      } as any)
      .where(eq(pbv2TreeVersions.id, treeId))
      .returning();
    return active;
  },

  async linkActiveTree(productId, treeId, treeJson, timestamp) {
    await db
      .update(products)
      .set({
        pbv2ActiveTreeVersionId: treeId,
        optionTreeJson: treeJson,
        updatedAt: timestamp,
      } as any)
      .where(eq(products.id, productId));
  },
};

async function main() {
  const result = await seedBannerProduct(repo, parseArgs(process.argv.slice(2)));

  for (const message of result.messages) {
    console.log(message);
  }

  console.log(
    JSON.stringify(
      {
        organizationId: result.organizationId,
        dryRun: result.dryRun,
        publish: result.publish,
        productAction: result.productAction,
        productId: result.productId,
        draftAction: result.draftAction,
        draftTreeId: result.draftTreeId,
        publishAction: result.publishAction,
        activeTreeId: result.activeTreeId,
        deprecatedActiveTreeCount: result.deprecatedActiveTreeCount,
        catalogVisibility: result.catalogVisibility,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
