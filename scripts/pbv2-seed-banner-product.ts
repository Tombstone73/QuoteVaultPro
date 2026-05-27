import "dotenv/config";
import { and, eq } from "drizzle-orm";

import { db, pool } from "../server/db";
import { createPbv2BannerProductTreeJson } from "../shared/pbv2/starterTree";
import { pbv2TreeVersions, products, productTypes } from "../shared/schema";

type CliArgs = {
  organizationId: string;
  publish: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--publish") {
      values.set("publish", true);
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        values.set(key, true);
        continue;
      }
      values.set(key, next);
      i++;
    }
  }

  const organizationId =
    String(values.get("organization-id") ?? values.get("org") ?? process.env.BANNER_PRODUCT_ORGANIZATION_ID ?? process.env.ORGANIZATION_ID ?? "")
      .trim();

  if (!organizationId) {
    throw new Error(
      "Missing organization id. Run with --organization-id <id> or set BANNER_PRODUCT_ORGANIZATION_ID."
    );
  }

  return {
    organizationId,
    publish: values.get("publish") === true || process.env.BANNER_PRODUCT_PUBLISH === "1",
  };
}

async function findBannerProductTypeId(organizationId: string): Promise<string | null> {
  const rows = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .where(eq(productTypes.organizationId, organizationId));

  const match = rows.find((row) => {
    const name = String(row.name ?? "").trim().toLowerCase();
    return name === "banner" || name === "banners";
  });

  return match?.id ?? null;
}

async function upsertBannerProduct(organizationId: string, productTypeId: string | null) {
  const [existing] = await db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.name, "Banner")))
    .limit(1);

  const values = {
    description: "Vinyl banner product configured with PBV2 conditional finishing options.",
    productTypeId,
    category: "Banners",
    pricingFormula: null,
    pricingMode: "area" as const,
    pricingEngine: "pricingProfile" as const,
    pricingProfileKey: "default",
    materialType: "roll" as const,
    useNestingCalculator: false,
    isService: false,
    isActive: true,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db
      .update(products)
      .set(values as any)
      .where(and(eq(products.organizationId, organizationId), eq(products.id, existing.id)))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(products)
    .values({
      organizationId,
      name: "Banner",
      ...values,
    } as any)
    .returning();

  return created;
}

async function upsertDraftTree(organizationId: string, productId: string, treeJson: Record<string, unknown>) {
  const [existingDraft] = await db
    .select()
    .from(pbv2TreeVersions)
    .where(
      and(
        eq(pbv2TreeVersions.organizationId, organizationId),
        eq(pbv2TreeVersions.productId, productId),
        eq(pbv2TreeVersions.status, "DRAFT")
      )
    )
    .limit(1);

  if (existingDraft) {
    const [updated] = await db
      .update(pbv2TreeVersions)
      .set({
        schemaVersion: 2,
        treeJson,
        updatedAt: new Date(),
      } as any)
      .where(eq(pbv2TreeVersions.id, existingDraft.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(pbv2TreeVersions)
    .values({
      organizationId,
      productId,
      status: "DRAFT",
      schemaVersion: 2,
      treeJson,
    } as any)
    .returning();

  return created;
}

async function publishDraft(organizationId: string, productId: string, draftId: string, treeJson: Record<string, unknown>) {
  const publishedAt = new Date();
  const activeTreeJson = {
    ...treeJson,
    status: "ACTIVE",
    meta: {
      ...((treeJson.meta && typeof treeJson.meta === "object" ? treeJson.meta : {}) as Record<string, unknown>),
      updatedAt: publishedAt.toISOString(),
    },
  };

  await db
    .update(pbv2TreeVersions)
    .set({ status: "DEPRECATED", updatedAt: publishedAt } as any)
    .where(
      and(
        eq(pbv2TreeVersions.organizationId, organizationId),
        eq(pbv2TreeVersions.productId, productId),
        eq(pbv2TreeVersions.status, "ACTIVE")
      )
    );

  const [active] = await db
    .update(pbv2TreeVersions)
    .set({
      status: "ACTIVE",
      treeJson: activeTreeJson,
      publishedAt,
      updatedAt: publishedAt,
    } as any)
    .where(eq(pbv2TreeVersions.id, draftId))
    .returning();

  await db
    .update(products)
    .set({
      pbv2ActiveTreeVersionId: active.id,
      optionTreeJson: activeTreeJson,
      updatedAt: publishedAt,
    } as any)
    .where(and(eq(products.organizationId, organizationId), eq(products.id, productId)));

  return active;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const treeJson = createPbv2BannerProductTreeJson();
  const productTypeId = await findBannerProductTypeId(args.organizationId);
  const product = await upsertBannerProduct(args.organizationId, productTypeId);
  const draft = await upsertDraftTree(args.organizationId, product.id, treeJson);

  if (args.publish) {
    const active = await publishDraft(args.organizationId, product.id, draft.id, treeJson);
    console.log(`Published Banner product ${product.id} with PBV2 tree ${active.id}.`);
  } else {
    console.log(`Saved Banner product ${product.id} with DRAFT PBV2 tree ${draft.id}.`);
    console.log("Review in Product Builder, then publish through the app or rerun with --publish.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
