import { z } from "zod";

export const INVOICE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const INVOICE_LOGO_JSON_BODY_LIMIT_BYTES = Math.ceil(INVOICE_LOGO_MAX_BYTES * 4 / 3) + 4096;
export const INVOICE_LOGO_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg"] as const;
export const INVOICE_LOGO_ACCEPT_ATTRIBUTE = INVOICE_LOGO_ACCEPTED_MIME_TYPES.join(",");
export const INVOICE_LOGO_ACCEPTED_FORMATS_LABEL = "PNG or JPG";
export const INVOICE_LOGO_MAX_SIZE_LABEL = "2 MB";
export const INVOICE_LOGO_HELPER_TEXT =
  `${INVOICE_LOGO_ACCEPTED_FORMATS_LABEL}, max ${INVOICE_LOGO_MAX_SIZE_LABEL}. Large logos should be resized before upload.`;
export const INVOICE_LOGO_TOO_LARGE_MESSAGE =
  `Logo file is too large. Please upload a ${INVOICE_LOGO_ACCEPTED_FORMATS_LABEL} under ${INVOICE_LOGO_MAX_SIZE_LABEL}.`;
export const INVOICE_LOGO_UNSUPPORTED_TYPE_MESSAGE = "Logo must be a PNG or JPG file.";
export const INVOICE_LOGO_DATA_URL_MESSAGE =
  "Invoice logo must be a saved logo reference, not an embedded image. Please upload the logo again.";

export function isInvoiceLogoAcceptedMimeType(value: unknown): value is typeof INVOICE_LOGO_ACCEPTED_MIME_TYPES[number] {
  return typeof value === "string" && (INVOICE_LOGO_ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}

export function isInvoiceLogoDataUrl(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("data:");
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

const optionalLogoReference = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string()
    .trim()
    .max(20000)
    .refine((value) => !isInvoiceLogoDataUrl(value), INVOICE_LOGO_DATA_URL_MESSAGE)
    .nullable()
    .optional(),
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
  invoiceLogoUrl: optionalLogoReference,
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
  invoiceLogoPreviewUrl?: string | null;
  invoiceLogoDisplayUrl?: string | null;
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
    invoiceLogoUrl: isInvoiceLogoDataUrl(record.invoiceLogoUrl ?? record.logoUrl)
      ? null
      : record.invoiceLogoUrl ?? record.logoUrl,
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
    invoiceLogoPreviewUrl: isInvoiceLogoDataUrl(record.invoiceLogoPreviewUrl) ? null : asString(record.invoiceLogoPreviewUrl),
    invoiceLogoDisplayUrl: isInvoiceLogoDataUrl(record.invoiceLogoDisplayUrl) ? null : asString(record.invoiceLogoDisplayUrl),
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
