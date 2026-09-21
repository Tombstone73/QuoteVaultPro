export const M78I_FIXTURE = Object.freeze({
  organizationId: "b6f969b2-dda3-4133-9d75-c417dabb8f3a",
  organizationName: "PrintersHero M7 QA",
  product: "M78I-FIXTURE-PRODUCT",
  customer: "M78I-FIXTURE-CUSTOMER",
  order: "M78I-FIXTURE-ORDER",
  artwork: "M78I-FIXTURE-ARTWORK.pdf",
});

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
