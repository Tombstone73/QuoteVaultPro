import { DEFAULT_ORGANIZATION_ID } from "../tenantContext";
import { createPbv2BannerProductTreeJson } from "../../shared/pbv2/starterTree";
import { DEFAULT_VALIDATE_OPTS, validateTreeForPublish } from "../../shared/pbv2/validator";
import { validateTreeHasBasePrice } from "../../shared/pbv2/validator/validateBasePrice";

export type BannerSeedProduct = {
  id: string;
  organizationId: string;
  name: string;
  category?: string | null;
  productTypeId?: string | null;
  isActive?: boolean | null;
  pbv2ActiveTreeVersionId?: string | null;
  optionTreeJson?: unknown;
};

export type BannerSeedTreeVersion = {
  id: string;
  organizationId: string;
  productId: string;
  status: "DRAFT" | "ACTIVE" | "DEPRECATED" | "ARCHIVED";
  schemaVersion: number;
  treeJson: Record<string, unknown>;
  publishedAt?: Date | string | null;
};

export type BannerProductSeedRepository = {
  findBannerProductTypeId(organizationId: string): Promise<string | null>;
  findBannerProduct(organizationId: string): Promise<BannerSeedProduct | null>;
  createBannerProduct(input: BannerSeedProductInput): Promise<BannerSeedProduct>;
  updateBannerProduct(productId: string, input: BannerSeedProductInput): Promise<BannerSeedProduct>;
  findDraftTree(organizationId: string, productId: string): Promise<BannerSeedTreeVersion | null>;
  createDraftTree(input: BannerSeedTreeInput): Promise<BannerSeedTreeVersion>;
  updateDraftTree(treeId: string, input: BannerSeedTreeInput): Promise<BannerSeedTreeVersion>;
  deprecateActiveTrees(organizationId: string, productId: string, timestamp: Date): Promise<number>;
  publishTree(treeId: string, treeJson: Record<string, unknown>, timestamp: Date): Promise<BannerSeedTreeVersion>;
  linkActiveTree(productId: string, treeId: string, treeJson: Record<string, unknown>, timestamp: Date): Promise<void>;
};

export type BannerProductSeedOptions = {
  organizationId?: string | null;
  publish?: boolean;
  dryRun?: boolean;
  useDefaultDevOrg?: boolean;
  now?: Date;
};

export type BannerSeedProductInput = {
  organizationId: string;
  name: "Banner";
  description: string;
  productTypeId: string | null;
  category: string;
  pricingFormula: null;
  pricingMode: "area";
  pricingEngine: "pricingProfile";
  pricingProfileKey: "default";
  materialType: "roll";
  useNestingCalculator: false;
  isService: false;
  isActive: true;
  updatedAt: Date;
};

export type BannerSeedTreeInput = {
  organizationId: string;
  productId: string;
  status: "DRAFT";
  schemaVersion: 2;
  treeJson: Record<string, unknown>;
  updatedAt: Date;
};

export type BannerProductSeedResult = {
  organizationId: string;
  dryRun: boolean;
  publish: boolean;
  productId?: string;
  draftTreeId?: string;
  activeTreeId?: string;
  productAction: "would_create" | "would_update" | "created" | "updated";
  draftAction: "would_create" | "would_update" | "created" | "updated";
  publishAction: "not_requested" | "would_publish" | "published";
  deprecatedActiveTreeCount: number;
  catalogVisibility: {
    staffAdminCatalog: boolean;
    activeOnlyCatalog: boolean;
    reason: string;
  };
  messages: string[];
};

export function resolveBannerSeedOrganizationId(options: BannerProductSeedOptions): string {
  const explicit = String(options.organizationId ?? "").trim();
  if (explicit) return explicit;

  if (options.useDefaultDevOrg) return DEFAULT_ORGANIZATION_ID;

  throw new Error(
    "Missing organization id. Run with --organization-id <id>. Use --use-default-dev-org only for local/dev validation."
  );
}

export function buildBannerSeedProductInput(args: {
  organizationId: string;
  productTypeId: string | null;
  now: Date;
}): BannerSeedProductInput {
  return {
    organizationId: args.organizationId,
    name: "Banner",
    description: "Vinyl banner product configured with PBV2 conditional finishing options.",
    productTypeId: args.productTypeId,
    category: "Banners",
    pricingFormula: null,
    pricingMode: "area",
    pricingEngine: "pricingProfile",
    pricingProfileKey: "default",
    materialType: "roll",
    useNestingCalculator: false,
    isService: false,
    isActive: true,
    updatedAt: args.now,
  };
}

function activeTreeJson(treeJson: Record<string, unknown>, timestamp: Date): Record<string, unknown> {
  return {
    ...treeJson,
    status: "ACTIVE",
    meta: {
      ...((treeJson.meta && typeof treeJson.meta === "object" ? treeJson.meta : {}) as Record<string, unknown>),
      updatedAt: timestamp.toISOString(),
    },
  };
}

export async function seedBannerProduct(
  repo: BannerProductSeedRepository,
  options: BannerProductSeedOptions,
): Promise<BannerProductSeedResult> {
  const organizationId = resolveBannerSeedOrganizationId(options);
  const now = options.now ?? new Date();
  const publish = options.publish === true;
  const dryRun = options.dryRun === true;
  const treeJson = createPbv2BannerProductTreeJson();
  if (publish) {
    const basePriceValidation = validateTreeHasBasePrice(treeJson);
    if (basePriceValidation.errors.length > 0) {
      throw new Error(`Banner seed publish blocked by base pricing validation: ${basePriceValidation.errors[0]?.message ?? "missing base price"}`);
    }

    const publishValidation = validateTreeForPublish(treeJson, DEFAULT_VALIDATE_OPTS);
    if (publishValidation.errors.length > 0) {
      throw new Error(`Banner seed publish blocked by PBV2 validation: ${publishValidation.errors[0]?.message ?? "invalid tree"}`);
    }
  }

  const productTypeId = await repo.findBannerProductTypeId(organizationId);
  const existingProduct = await repo.findBannerProduct(organizationId);
  const productInput = buildBannerSeedProductInput({ organizationId, productTypeId, now });
  const messages: string[] = [];

  const productAction = existingProduct
    ? dryRun
      ? "would_update"
      : "updated"
    : dryRun
      ? "would_create"
      : "created";

  messages.push(
    existingProduct
      ? `${dryRun ? "Would update" : "Updated"} existing Banner product ${existingProduct.id}.`
      : `${dryRun ? "Would create" : "Created"} Banner product in organization ${organizationId}.`,
  );

  let product = existingProduct;
  if (!dryRun) {
    product = existingProduct
      ? await repo.updateBannerProduct(existingProduct.id, productInput)
      : await repo.createBannerProduct(productInput);
  }

  const productId = product?.id;
  const existingDraft = productId ? await repo.findDraftTree(organizationId, productId) : null;
  const draftAction = existingDraft
    ? dryRun
      ? "would_update"
      : "updated"
    : dryRun
      ? "would_create"
      : "created";

  let draft = existingDraft;
  if (!dryRun && productId) {
    const draftInput: BannerSeedTreeInput = {
      organizationId,
      productId,
      status: "DRAFT",
      schemaVersion: 2,
      treeJson,
      updatedAt: now,
    };
    draft = existingDraft
      ? await repo.updateDraftTree(existingDraft.id, draftInput)
      : await repo.createDraftTree(draftInput);
  }

  messages.push(`${dryRun ? "Would save" : "Saved"} ${draftAction.includes("update") ? "updated" : "new"} DRAFT PBV2 Banner tree.`);

  let activeTreeId: string | undefined;
  let deprecatedActiveTreeCount = 0;
  let publishAction: BannerProductSeedResult["publishAction"] = "not_requested";
  if (publish) {
    publishAction = dryRun ? "would_publish" : "published";
    if (!dryRun && productId && draft) {
      const nextActiveTreeJson = activeTreeJson(treeJson, now);
      deprecatedActiveTreeCount = await repo.deprecateActiveTrees(organizationId, productId, now);
      const active = await repo.publishTree(draft.id, nextActiveTreeJson, now);
      await repo.linkActiveTree(productId, active.id, nextActiveTreeJson, now);
      activeTreeId = active.id;
    }
    messages.push(`${dryRun ? "Would publish" : "Published"} Banner PBV2 tree because --publish was provided.`);
  } else {
    messages.push("Left Banner PBV2 tree in DRAFT mode. Publish was not requested.");
  }

  return {
    organizationId,
    dryRun,
    publish,
    productId,
    draftTreeId: draft?.id,
    activeTreeId,
    productAction,
    draftAction,
    publishAction,
    deprecatedActiveTreeCount,
    catalogVisibility: {
      staffAdminCatalog: true,
      activeOnlyCatalog: true,
      reason: "The seed sets products.isActive=true; PBV2 draft/published state is not used by /api/products catalog filtering.",
    },
    messages,
  };
}
