export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type OrganizationId = Brand<string, "OrganizationId">;
export type CustomerId = Brand<string, "CustomerId">;
export type ContactId = Brand<string, "ContactId">;
export type ProductId = Brand<string, "ProductId">;
export type ProductTypeId = Brand<string, "ProductTypeId">;
export type PricingConfigurationId = Brand<string, "PricingConfigurationId">;
export type PricingResultId = Brand<string, "PricingResultId">;
export type QuoteId = Brand<string, "QuoteId">;
export type QuoteCheckpointId = Brand<string, "QuoteCheckpointId">;
export type OrderId = Brand<string, "OrderId">;
export type InvoiceId = Brand<string, "InvoiceId">;
export type InvoiceCheckpointId = Brand<string, "InvoiceCheckpointId">;
export type PaymentId = Brand<string, "PaymentId">;
export type RefundId = Brand<string, "RefundId">;
export type ProviderFinancialOperationId = Brand<string, "ProviderFinancialOperationId">;
export type BusinessRequestId = Brand<string, "BusinessRequestId">;
export type SalesLineId = Brand<string, "SalesLineId">;
/** An Order line is a distinct future work-owner reference; a Quote line cannot be routed. */
export type OrderLineId = Brand<string, "OrderLineId">;
export type RouteTemplateId = Brand<string, "RouteTemplateId">;
export type RouteTemplateStepId = Brand<string, "RouteTemplateStepId">;
export type RouteInstanceId = Brand<string, "RouteInstanceId">;
export type RouteInstanceStepId = Brand<string, "RouteInstanceStepId">;
/** Artwork owns file identity; these never imply a separate customer/production file universe. */
export type ArtworkFileId = Brand<string, "ArtworkFileId">;
export type ArtworkAssignmentId = Brand<string, "ArtworkAssignmentId">;
/** Quote artwork is a business association to the canonical Artwork file. */
export type QuoteArtworkAssignmentId = Brand<string, "QuoteArtworkAssignmentId">;
/** Accepted Quote artwork is immutable evidence, never a copied binary. */
export type QuoteAcceptedArtworkSnapshotId = Brand<string, "QuoteAcceptedArtworkSnapshotId">;
export type ProofWorkId = Brand<string, "ProofWorkId">;
export type ProofVersionId = Brand<string, "ProofVersionId">;
export type ProofResponseId = Brand<string, "ProofResponseId">;
/** Prepress owns independently executable preparation units, never Artwork files. */
export type PrepressUnitId = Brand<string, "PrepressUnitId">;
/** Production work is anchored to a frozen required production unit, not an Order status. */
export type ProductionWorkId = Brand<string, "ProductionWorkId">;
export type ProductionAttemptId = Brand<string, "ProductionAttemptId">;
/** Physical material usage is immutable Production history, not inventory movement. */
export type ProductionMaterialConsumptionId = Brand<string, "ProductionMaterialConsumptionId">;
export type OrderLineMaterialRequirementId = Brand<string, "OrderLineMaterialRequirementId">;
/** Fulfillment owns a completed customer-handoff identity, never a Sales status. */
export type FulfillmentHandoffId = Brand<string, "FulfillmentHandoffId">;
export type FulfillmentHandoffLineId = Brand<string, "FulfillmentHandoffLineId">;
export type CommercialCheckpointId = Brand<string, "CommercialCheckpointId">;

export type CurrencyCode = Brand<string, "CurrencyCode">;
export type Money = Readonly<{ currency: CurrencyCode; cents: number }>;
/** Basis points: 10,000 represents 100%; never use a floating percentage for money truth. */
export type PercentageBasisPoints = Brand<number, "PercentageBasisPoints">;
/** Decimal/rational text is for measurements and rate evidence, never monetary truth. */
export type DecimalText = Brand<string, "DecimalText">;

export const brandedId = <Name extends string>(value: string): Brand<string, Name> => {
  if (!value.trim()) throw new Error("Commercial IDs must not be blank.");
  return value as Brand<string, Name>;
};

export const currencyCode = (value: string): CurrencyCode => {
  if (!/^[A-Z]{3}$/u.test(value)) throw new Error("Currency must be an ISO-4217-style uppercase code.");
  return value as CurrencyCode;
};

export const money = (currency: CurrencyCode, cents: number): Money => {
  if (!Number.isSafeInteger(cents)) throw new Error("Money cents must be a safe integer minor-unit amount.");
  return Object.freeze({ currency, cents });
};

export const percentageBasisPoints = (value: number): PercentageBasisPoints => {
  if (!Number.isSafeInteger(value)) throw new Error("Percentage basis points must be an integer.");
  return value as PercentageBasisPoints;
};

export const decimalText = (value: string): DecimalText => {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) throw new Error("Decimal evidence must use canonical plain decimal text.");
  return value as DecimalText;
};

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | Readonly<{ readonly [key: string]: JsonValue }>;

const cloneJson = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Checkpoint JSON cannot contain non-finite numbers.");
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, cloneJson(nested)]));
  }
  throw new Error("Checkpoint data must be plain JSON-compatible values.");
};

const deepFreeze = <T>(value: T): Readonly<T> => {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

/** Canonical JSON text is the fingerprint input; persistence later supplies the chosen hash algorithm. */
export const canonicalJson = (value: unknown): string => JSON.stringify(cloneJson(value));
export const freezeCheckpoint = <T>(value: T): Readonly<T> => deepFreeze(cloneJson(value) as T);
