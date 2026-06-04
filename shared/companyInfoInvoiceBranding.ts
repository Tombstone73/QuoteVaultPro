import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

export const companyAddressSchema = z.object({
  line1: optionalText(255),
  line2: optionalText(255),
  city: optionalText(100),
  state: optionalText(100),
  postalCode: optionalText(40),
  country: optionalText(100),
});

export const remittanceAddressSchema = companyAddressSchema.extend({
  enabled: z.boolean().default(false),
});

export const companyInfoInvoiceBrandingSchema = z.object({
  companyDisplayName: optionalText(255),
  legalCompanyName: optionalText(255),
  phone: optionalText(50),
  email: optionalText(255),
  website: optionalText(255),
  taxId: optionalText(100),
  physicalAddress: companyAddressSchema.default({}),
  remittanceAddress: remittanceAddressSchema.default({ enabled: false }),
  invoiceLogoUrl: optionalText(20000),
  invoiceLogoAssetId: optionalText(255),
  invoicePaymentInstructions: optionalText(4000),
  invoiceFooterNote: optionalText(2000),
  checksPayableTo: optionalText(255),
});

export type CompanyAddress = z.infer<typeof companyAddressSchema>;
export type RemittanceAddress = z.infer<typeof remittanceAddressSchema>;
export type CompanyInfoInvoiceBranding = z.infer<typeof companyInfoInvoiceBrandingSchema>;

export type CompanySettingsDto = CompanyInfoInvoiceBranding & {
  id: string | null;
  companyName: string;
  address: string | null;
  logoUrl: string | null;
  taxRate?: string | null;
  defaultMargin?: string | null;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export function formatCompanyAddress(address: CompanyAddress | null | undefined): string {
  if (!address || typeof address !== "object") return "";
  const cityLine = [
    asString(address.city),
    [asString(address.state), asString(address.postalCode)].filter(Boolean).join(" ") || null,
  ].filter(Boolean).join(", ");

  return [
    asString(address.line1),
    asString(address.line2),
    cityLine || null,
    asString(address.country),
  ].filter(Boolean).join("\n");
}

export function normalizeCompanySettingsDto(raw: unknown): CompanySettingsDto {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const parsed = companyInfoInvoiceBrandingSchema.parse({
    companyDisplayName: record.companyDisplayName ?? record.companyName,
    legalCompanyName: record.legalCompanyName,
    phone: record.phone,
    email: record.email,
    website: record.website,
    taxId: record.taxId,
    physicalAddress: record.physicalAddress,
    remittanceAddress: record.remittanceAddress,
    invoiceLogoUrl: record.invoiceLogoUrl ?? record.logoUrl,
    invoiceLogoAssetId: record.invoiceLogoAssetId,
    invoicePaymentInstructions: record.invoicePaymentInstructions,
    invoiceFooterNote: record.invoiceFooterNote,
    checksPayableTo: record.checksPayableTo,
  });

  const companyName =
    parsed.companyDisplayName ||
    asString(record.companyName) ||
    parsed.legalCompanyName ||
    "";

  return {
    id: asString(record.id),
    companyName,
    companyDisplayName: parsed.companyDisplayName ?? null,
    legalCompanyName: parsed.legalCompanyName ?? null,
    phone: parsed.phone ?? null,
    email: parsed.email ?? null,
    website: parsed.website ?? null,
    taxId: parsed.taxId ?? null,
    physicalAddress: parsed.physicalAddress ?? {},
    remittanceAddress: parsed.remittanceAddress ?? { enabled: false },
    invoiceLogoUrl: parsed.invoiceLogoUrl ?? null,
    invoiceLogoAssetId: parsed.invoiceLogoAssetId ?? null,
    invoicePaymentInstructions: parsed.invoicePaymentInstructions ?? null,
    invoiceFooterNote: parsed.invoiceFooterNote ?? null,
    checksPayableTo: parsed.checksPayableTo ?? null,
    address: asString(record.address) ?? (formatCompanyAddress(parsed.physicalAddress) || null),
    logoUrl: parsed.invoiceLogoUrl ?? asString(record.logoUrl),
    taxRate: asString(record.taxRate),
    defaultMargin: asString(record.defaultMargin),
  };
}

export function toCompanySettingsDbPayload(input: CompanyInfoInvoiceBranding) {
  const companyName = input.companyDisplayName || input.legalCompanyName || "Company";
  const address = formatCompanyAddress(input.physicalAddress) || null;

  return {
    companyName,
    companyDisplayName: input.companyDisplayName ?? null,
    legalCompanyName: input.legalCompanyName ?? null,
    address,
    physicalAddress: input.physicalAddress ?? {},
    remittanceAddress: input.remittanceAddress ?? { enabled: false },
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    taxId: input.taxId ?? null,
    logoUrl: input.invoiceLogoUrl ?? null,
    invoiceLogoUrl: input.invoiceLogoUrl ?? null,
    invoiceLogoAssetId: input.invoiceLogoAssetId ?? null,
    invoicePaymentInstructions: input.invoicePaymentInstructions ?? null,
    invoiceFooterNote: input.invoiceFooterNote ?? null,
    checksPayableTo: input.checksPayableTo ?? null,
  };
}
