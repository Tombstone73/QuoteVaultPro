export const M78I_FIXTURE = Object.freeze({
  organizationId: "b6f969b2-dda3-4133-9d75-c417dabb8f3a",
  organizationName: "PrintersHero M7 QA",
  product: "M78I-FIXTURE-PRODUCT",
  customer: "M78I-FIXTURE-CUSTOMER",
  order: "M78I-FIXTURE-ORDER",
  artwork: "M78I-FIXTURE-ARTWORK.pdf",
});

/**
 * Fixture definitions are deliberately versioned.  A version only changes
 * when this canonical fixture definition changes; it is not a retry counter.
 */
export const M78I_FIXTURE_SCHEMA_VERSION = "v2";

export const M78I_FIXTURE_MUTATIONS = [
  "product.create",
  "product.general.update",
  "product.pricing.update",
  "product.routing.update",
  "product.publish",
  "customer.create",
  "order.create",
  "artwork.adopt",
] as const;

export type M78iFixtureMutation = (typeof M78I_FIXTURE_MUTATIONS)[number];

/** One stable key per semantic canonical mutation.  Callers must reconcile
 * state before retrying mutations whose canonical payload carries revisions. */
export const m78iFixtureBusinessRequestIdForVersion = (schemaVersion: string, mutation: M78iFixtureMutation): string =>
  `m78i-fixture:${schemaVersion}:${mutation}`;

export const m78iFixtureBusinessRequestId = (mutation: M78iFixtureMutation): string =>
  m78iFixtureBusinessRequestIdForVersion(M78I_FIXTURE_SCHEMA_VERSION, mutation);

export const M78I_FIXTURE_PRODUCT_GENERAL = Object.freeze({
  displayName: M78I_FIXTURE.product,
  category: "DEV QA fixture",
  description: "Synthetic M7.8I validation Product. No customer use.",
  storefrontVisible: false,
  measurementMode: "dimensions_required" as const,
  workflowIntent: "standard_production" as const,
  requiresProofApproval: true,
  requiresProductionJob: true,
  productionUnitSpecification: { schemaVersion: 1 as const, rules: [{ key: "front", side: "front" as const }] },
});

export const M78I_FIXTURE_PRODUCT_PRICING = Object.freeze({
  base: { perPieceCents: null, perSqftCents: 1000, minimumChargeCents: 1000 },
  tierBasis: null,
  tiers: [] as const,
});

export const fixtureProductGeneralMatches = (value: Readonly<{
  displayName: string;
  category: string | null;
  description: string | null;
  storefrontVisible: boolean;
  measurementMode: string;
  workflowIntent: string;
  requiresProofApproval: boolean;
  requiresProductionJob: boolean;
  productionUnitSpecification: unknown;
}>): boolean =>
  value.displayName === M78I_FIXTURE_PRODUCT_GENERAL.displayName &&
  value.category === M78I_FIXTURE_PRODUCT_GENERAL.category &&
  value.description === M78I_FIXTURE_PRODUCT_GENERAL.description &&
  value.storefrontVisible === M78I_FIXTURE_PRODUCT_GENERAL.storefrontVisible &&
  value.measurementMode === M78I_FIXTURE_PRODUCT_GENERAL.measurementMode &&
  value.workflowIntent === M78I_FIXTURE_PRODUCT_GENERAL.workflowIntent &&
  value.requiresProofApproval === M78I_FIXTURE_PRODUCT_GENERAL.requiresProofApproval &&
  value.requiresProductionJob === M78I_FIXTURE_PRODUCT_GENERAL.requiresProductionJob &&
  JSON.stringify(value.productionUnitSpecification) === JSON.stringify(M78I_FIXTURE_PRODUCT_GENERAL.productionUnitSpecification);

export const fixtureProductPricingMatches = (value: Readonly<{
  measurementMode: string;
  mode: string;
  editable: boolean;
  base: Readonly<{ perPieceCents: number | null; perSqftCents: number | null; minimumChargeCents: number | null }>;
  flatFeeCents: number | null;
  tierBasis: string | null;
  tiers: readonly unknown[];
}>): boolean =>
  value.measurementMode === "dimensions_required" &&
  value.mode === "simple_base" &&
  value.editable &&
  value.base.perPieceCents === M78I_FIXTURE_PRODUCT_PRICING.base.perPieceCents &&
  value.base.perSqftCents === M78I_FIXTURE_PRODUCT_PRICING.base.perSqftCents &&
  value.base.minimumChargeCents === M78I_FIXTURE_PRODUCT_PRICING.base.minimumChargeCents &&
  value.flatFeeCents === null && value.tierBasis === null && value.tiers.length === 0;

export const fixtureProductRoutingMatches = (value: Readonly<{ kind: string; routeTemplateId?: string }>, routeTemplateId: string): boolean =>
  value.kind === "route_required" && value.routeTemplateId === routeTemplateId;

export type FixtureManifest = Readonly<{
  organizationId: string;
  product?: Readonly<{ id: string; activeVersionId: string; productionUnit: string; requiresProductionJob: boolean }>;
  customer?: Readonly<{ id: string }>;
  order?: Readonly<{ id: string; orderNumber: string; lineId: string }>;
  invoice?: Readonly<{ id: string; invoiceNumber: string | null }>;
  artwork?: Readonly<{ id: string; assignmentId: string }>;
  production?: Readonly<{ routeId: string }>;
}>;

export type FixtureReadiness = Readonly<{
  product: "missing" | "valid" | "invalid" | "ambiguous";
  customer: "missing" | "valid" | "ambiguous";
  order: "missing" | "valid" | "historical" | "ambiguous";
  artwork: "missing" | "valid" | "ambiguous";
}>;

export type FixturePlan = Readonly<{
  product: "reuse" | "create" | "repair";
  customer: "reuse" | "create";
  order: "reuse" | "create_current";
  artwork: "reuse" | "adopt";
}>;

export const assertFixtureReadiness = (readiness: FixtureReadiness): void => {
  for (const [entity, value] of Object.entries(readiness)) {
    if (value === "ambiguous") throw new Error(`Ambiguous current M7.8I fixture ${entity}; refusing to choose a record.`);
  }
};

/** Pure reconciliation policy. The runtime supplies only canonical adapters. */
export const planFixtureReconciliation = (readiness: FixtureReadiness): FixturePlan => {
  assertFixtureReadiness(readiness);
  return {
    product: readiness.product === "valid" ? "reuse" : readiness.product === "invalid" ? "repair" : "create",
    customer: readiness.customer === "valid" ? "reuse" : "create",
    order: readiness.order === "valid" ? "reuse" : "create_current",
    artwork: readiness.artwork === "valid" ? "reuse" : "adopt",
  };
};

export const assertFixtureTenant = (organizationId: string, organizationName: string): void => {
  if (organizationId !== M78I_FIXTURE.organizationId || organizationName !== M78I_FIXTURE.organizationName)
    throw new Error("M7.8I fixture bootstrap is locked to PrintersHero M7 QA.");
};

export const manifestIsSecretFree = (manifest: FixtureManifest): boolean => {
  const text = JSON.stringify(manifest).toLowerCase();
  return !["password", "token", "cookie", "secret", "signedurl", "database_url"].some((term) => text.includes(term));
};
