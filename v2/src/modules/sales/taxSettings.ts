import { V2ApplicationError } from "../../errors/applicationError.js";

export type SalesTaxJurisdiction = Readonly<{
  jurisdictionId: string;
  name: string;
  countryCode: string;
  regionCode: string;
  postalCode?: string;
  rateBasisPoints: number;
  active: boolean;
  homeBusiness: boolean;
  /** Destination rules may apply to Shipping, Local Delivery, or both. */
  destinationMethods?: readonly DestinationTaxMethod[];
  updatedAt: string;
}>;

export type DestinationTaxMethod = "shipping" | "local_delivery";
export type TaxReadinessStatus = "ready" | "not_configured" | "needs_attention" | "conflict";
export type TaxModeReadiness = Readonly<{ status: TaxReadinessStatus; jurisdictionName?: string; rateBasisPoints?: number; reason?: string }>;
export type SalesTaxSettings = Readonly<{
  homeBusiness?: SalesTaxJurisdiction;
  destinationJurisdictions: readonly SalesTaxJurisdiction[];
  readiness: Readonly<{ status: "ready" | "needs_attention"; pickup: TaxModeReadiness; shipping: TaxModeReadiness; localDelivery: TaxModeReadiness }>;
  revision: string;
}>;
/** Compatibility name retained for the existing Pickup-only caller. */
export type HomeBusinessTaxSettings = SalesTaxSettings;

/** Secret-free operational stages for the Home / Business tax settings command. */
export type SalesTaxSettingsSaveTrace = (
  stage:
    | "repository_transaction_started"
    | "durable_request_started"
    | "durable_request_replayed"
    | "jurisdiction_upserted"
    | "audit_written"
    | "durable_request_completed"
    | "transaction_committed"
    | "repository_failed"
    | "transaction_rolled_back",
  context?: Readonly<{ resourceId?: string; errorCode?: string }>,
) => void;
export type SaveHomeBusinessTaxSettings = Readonly<{
  name: string;
  countryCode: string;
  regionCode: string;
  postalCode?: string;
  rateBasisPoints: number;
  active: boolean;
}>;
export type SaveDestinationTaxJurisdiction = Readonly<{
  expectedRevision: string;
  name: string;
  countryCode: string;
  regionCode: string;
  postalCode?: string;
  rateBasisPoints: number;
  active: boolean;
  destinationMethods: readonly DestinationTaxMethod[];
}>;

const text = (value: unknown, field: string, maximum: number): string => {
  if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return normalized;
};

/** The database stores whole basis points; this parser deliberately rejects
 * values that would need a hidden rounding decision. */
export const percentageToBasisPoints = (value: unknown): number => {
  if (typeof value !== "string" && typeof value !== "number")
    throw new V2ApplicationError("VALIDATION_ERROR", "Tax rate must be a percentage.");
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(raw))
    throw new V2ApplicationError("VALIDATION_ERROR", "Tax rate must be a non-negative percentage with at most two decimal places.");
  const [whole, fraction = ""] = raw.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000)
    throw new V2ApplicationError("VALIDATION_ERROR", "Tax rate must be between 0% and 100%.");
  return basisPoints;
};

export const basisPointsToPercentage = (basisPoints: number): string => {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) return "";
  return (basisPoints / 100).toFixed(2).replace(/\.00$/u, "").replace(/(\.\d)0$/u, "$1");
};

export const homeBusinessTaxSettingsInput = (value: unknown): SaveHomeBusinessTaxSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", "Home / Business tax settings are required.");
  const body = value as Record<string, unknown>;
  const postalCode = body.postalCode === undefined || body.postalCode === null || body.postalCode === ""
    ? undefined : text(body.postalCode, "Postal code", 32);
  if (typeof body.active !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Active status is required.");
  return {
    name: text(body.name, "Jurisdiction name", 160),
    countryCode: text(body.countryCode, "Country", 8).toUpperCase(),
    regionCode: text(body.regionCode, "Region", 32).toUpperCase(),
    ...(postalCode ? { postalCode } : {}),
    rateBasisPoints: percentageToBasisPoints(body.ratePercent),
    active: body.active,
  };
};

const destinationMethods = (value: unknown): readonly DestinationTaxMethod[] => {
  if (!Array.isArray(value) || value.length === 0) throw new V2ApplicationError("VALIDATION_ERROR", "At least one destination fulfillment method is required.");
  const unique = [...new Set(value)];
  if (!unique.every((method) => method === "shipping" || method === "local_delivery")) throw new V2ApplicationError("VALIDATION_ERROR", "Destination fulfillment methods are invalid.");
  return unique as DestinationTaxMethod[];
};

export const destinationTaxJurisdictionInput = (value: unknown): SaveDestinationTaxJurisdiction => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Destination tax jurisdiction is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.expectedRevision !== "string" || !body.expectedRevision.trim() || body.expectedRevision.length > 160) throw new V2ApplicationError("VALIDATION_ERROR", "expectedRevision is required.");
  const postalCode = body.postalCode === undefined || body.postalCode === null || body.postalCode === "" ? undefined : text(body.postalCode, "Postal code", 32);
  if (typeof body.active !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Active status is required.");
  return {
    expectedRevision: body.expectedRevision.trim(),
    name: text(body.name, "Jurisdiction name", 160),
    countryCode: text(body.countryCode, "Country", 8).toUpperCase(),
    regionCode: text(body.regionCode, "Region", 32).toUpperCase(),
    ...(postalCode ? { postalCode: postalCode.toUpperCase() } : {}),
    rateBasisPoints: percentageToBasisPoints(body.ratePercent),
    active: body.active,
    destinationMethods: destinationMethods(body.destinationMethods),
  };
};
