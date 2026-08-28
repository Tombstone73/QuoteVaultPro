import { V2ApplicationError } from "../../errors/applicationError.js";

export type OrganizationAddress = Readonly<{
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
}>;

export type BusinessProfile = Readonly<{
  displayName: string;
  legalName?: string;
  phone?: string;
  email?: string;
  website?: string;
  businessAddress: OrganizationAddress;
  pickupAddressSource: "business_address";
  timeZone?: string;
  currency?: string;
}>;

export type DocumentsBranding = Readonly<{
  logo: Readonly<{ status: "configured" | "not_configured" }>;
  footerNote?: string;
  paymentInstructions?: string;
  checksPayableTo?: string;
  remittanceAddress?: OrganizationAddress;
}>;

/**
 * Safe, rendered organization facts captured at a document-evidence boundary.
 * It deliberately excludes storage identifiers and every secret-bearing field.
 */
export type DocumentOrganizationIdentity = Readonly<{
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  footerNote?: string;
  paymentInstructions?: string;
  checksPayableTo?: string;
  remittanceAddress?: string;
}>;

export type BusinessProfileReadiness = Readonly<{
  status: "ready" | "needs_attention";
  missing: readonly ("business_name" | "business_address")[];
}>;

export type OrganizationSettings = Readonly<{
  businessProfile: BusinessProfile;
  documentsBranding: DocumentsBranding;
  readiness: BusinessProfileReadiness;
  revision: string;
}>;

export type SaveBusinessProfile = Readonly<{
  expectedRevision: string;
  displayName: string;
  legalName?: string;
  phone?: string;
  email?: string;
  website?: string;
  businessAddress: OrganizationAddress;
  timeZone?: string;
  currency?: string;
}>;

export type SaveDocumentsBranding = Readonly<{
  expectedRevision: string;
  footerNote?: string;
  paymentInstructions?: string;
  checksPayableTo?: string;
  remittanceAddress?: OrganizationAddress;
}>;

/** Secret-free persistence stages shared by the HTTP observability boundary. */
export type OrganizationSettingsSaveTrace = (
  stage: "repository_transaction_started" | "durable_request_started" | "durable_request_replayed" | "settings_locked" | "settings_updated" | "audit_written" | "durable_request_completed" | "transaction_committed" | "repository_failed" | "transaction_rolled_back",
  context?: Readonly<{ errorCode?: string }>,
) => void;

const optionalText = (value: unknown, field: string, maximum: number): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  return normalized;
};

const requiredText = (value: unknown, field: string, maximum: number): string => {
  const normalized = optionalText(value, field, maximum);
  if (!normalized) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is required.`);
  return normalized;
};

const optionalEmail = (value: unknown): string | undefined => {
  const email = optionalText(value, "Business email", 255);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new V2ApplicationError("VALIDATION_ERROR", "Business email is invalid.");
  return email;
};

const optionalWebsite = (value: unknown): string | undefined => {
  const website = optionalText(value, "Website", 255);
  if (!website) return undefined;
  try {
    const parsed = new URL(website);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("unsupported scheme");
  } catch {
    throw new V2ApplicationError("VALIDATION_ERROR", "Website must be a valid http or https URL.");
  }
  return website;
};

const optionalTimeZone = (value: unknown): string | undefined => {
  const timeZone = optionalText(value, "Time zone", 80);
  if (!timeZone) return undefined;
  try { Intl.DateTimeFormat("en-US", { timeZone }); } catch { throw new V2ApplicationError("VALIDATION_ERROR", "Time zone is not supported."); }
  return timeZone;
};

const optionalCurrency = (value: unknown): string | undefined => {
  const currency = optionalText(value, "Currency", 8)?.toUpperCase();
  if (!currency) return undefined;
  try { new Intl.NumberFormat("en-US", { style: "currency", currency }).format(0); } catch { throw new V2ApplicationError("VALIDATION_ERROR", "Currency is not supported."); }
  return currency;
};

export const organizationAddressInput = (value: unknown, field = "Business address"): OrganizationAddress => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is invalid.`);
  const source = value as Record<string, unknown>;
  const country = optionalText(source.country, `${field} country`, 2)?.toUpperCase();
  if (country && !/^[A-Z]{2}$/u.test(country)) throw new V2ApplicationError("VALIDATION_ERROR", `${field} country must be a two-letter code.`);
  const region = optionalText(source.region, `${field} region`, 32)?.toUpperCase();
  return {
    ...(optionalText(source.line1, `${field} line 1`, 255) ? { line1: optionalText(source.line1, `${field} line 1`, 255)! } : {}),
    ...(optionalText(source.line2, `${field} line 2`, 255) ? { line2: optionalText(source.line2, `${field} line 2`, 255)! } : {}),
    ...(optionalText(source.city, `${field} city`, 100) ? { city: optionalText(source.city, `${field} city`, 100)! } : {}),
    ...(region ? { region } : {}),
    ...(optionalText(source.postalCode, `${field} postal code`, 40) ? { postalCode: optionalText(source.postalCode, `${field} postal code`, 40)! } : {}),
    ...(country ? { country } : {}),
  };
};

const object = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", message);
  return value as Record<string, unknown>;
};

export const businessProfileInput = (value: unknown): SaveBusinessProfile => {
  const body = object(value, "Business Profile is required.");
  return {
    expectedRevision: requiredText(body.expectedRevision, "expectedRevision", 160),
    displayName: requiredText(body.displayName, "Business display name", 255),
    ...(optionalText(body.legalName, "Legal business name", 255) ? { legalName: optionalText(body.legalName, "Legal business name", 255)! } : {}),
    ...(optionalText(body.phone, "Phone", 50) ? { phone: optionalText(body.phone, "Phone", 50)! } : {}),
    ...(optionalEmail(body.email) ? { email: optionalEmail(body.email)! } : {}),
    ...(optionalWebsite(body.website) ? { website: optionalWebsite(body.website)! } : {}),
    businessAddress: organizationAddressInput(body.businessAddress),
    ...(optionalTimeZone(body.timeZone) ? { timeZone: optionalTimeZone(body.timeZone)! } : {}),
    ...(optionalCurrency(body.currency) ? { currency: optionalCurrency(body.currency)! } : {}),
  };
};

export const documentsBrandingInput = (value: unknown): SaveDocumentsBranding => {
  const body = object(value, "Documents & Branding settings are required.");
  return {
    expectedRevision: requiredText(body.expectedRevision, "expectedRevision", 160),
    ...(optionalText(body.footerNote, "Document footer", 2000) ? { footerNote: optionalText(body.footerNote, "Document footer", 2000)! } : {}),
    ...(optionalText(body.paymentInstructions, "Payment instructions", 4000) ? { paymentInstructions: optionalText(body.paymentInstructions, "Payment instructions", 4000)! } : {}),
    ...(optionalText(body.checksPayableTo, "Checks payable to", 255) ? { checksPayableTo: optionalText(body.checksPayableTo, "Checks payable to", 255)! } : {}),
    ...(body.remittanceAddress !== undefined ? { remittanceAddress: organizationAddressInput(body.remittanceAddress, "Remittance address") } : {}),
  };
};

export const businessProfileReadiness = (profile: BusinessProfile): BusinessProfileReadiness => {
  const missing: ("business_name" | "business_address")[] = [];
  if (!profile.displayName.trim()) missing.push("business_name");
  if (!profile.businessAddress.line1 || !profile.businessAddress.country) missing.push("business_address");
  return missing.length ? { status: "needs_attention", missing } : { status: "ready", missing };
};
