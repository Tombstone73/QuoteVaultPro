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
  updatedAt: string;
}>;

export type HomeBusinessTaxSettings = Readonly<{ homeBusiness?: SalesTaxJurisdiction }>;
export type SaveHomeBusinessTaxSettings = Readonly<{
  name: string;
  countryCode: string;
  regionCode: string;
  postalCode?: string;
  rateBasisPoints: number;
  active: boolean;
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
