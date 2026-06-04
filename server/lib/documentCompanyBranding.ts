import {
  isInvoiceLogoAcceptedMimeType,
  isInvoiceLogoDataUrl,
  type CompanyAddress,
} from "@shared/companyInfoInvoiceBranding";

export type CompanyDocumentBrandingInput = {
  organizationId?: string | null;
  companyName?: string | null;
  companyDisplayName?: string | null;
  legalCompanyName?: string | null;
  address?: string | null;
  physicalAddress?: CompanyAddress | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  taxId?: string | null;
  logoUrl?: string | null;
  invoiceLogoUrl?: string | null;
  invoiceLogoAssetId?: string | null;
} | null;

export type CompanyDocumentBranding = {
  companyDisplayName: string;
  legalCompanyName: string;
  showLegalCompanyName: boolean;
  physicalAddress: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  invoiceLogoUrl: string;
  invoiceLogoAssetId: string;
  logoDataUrl: string | null;
};

export const cleanDocumentText = (value: unknown): string => String(value ?? "").trim();

export const joinNonEmptyDocumentValues = (values: Array<string | null | undefined>, sep = "\n") =>
  values
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => !!v)
    .join(sep)
    .trim();

export function buildDocumentAddressBlock(params: {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  legacy?: string | null;
  includeCountry?: boolean;
}): string {
  const includeCountry = params.includeCountry === true;
  const hasStructured = !!(
    cleanDocumentText(params.line1) ||
    cleanDocumentText(params.line2) ||
    cleanDocumentText(params.city) ||
    cleanDocumentText(params.state) ||
    cleanDocumentText(params.postalCode) ||
    (includeCountry && cleanDocumentText(params.country))
  );

  if (hasStructured) {
    const cityStateZip = joinNonEmptyDocumentValues(
      [
        joinNonEmptyDocumentValues([
          params.city,
          [cleanDocumentText(params.state), cleanDocumentText(params.postalCode)].filter(Boolean).join(" ") || null,
        ], ", "),
      ],
      "",
    );

    return joinNonEmptyDocumentValues([
      params.line1,
      params.line2,
      cityStateZip || null,
      includeCountry ? params.country : null,
    ]);
  }

  return joinNonEmptyDocumentValues([params.legacy]);
}

async function readBufferFromStorageHandle(handle: { kind: "signed_url" | "local_path"; value: string }): Promise<Buffer> {
  if (handle.kind === "local_path") {
    const { readFile } = await import("fs/promises");
    return readFile(handle.value);
  }

  const response = await fetch(handle.value);
  if (!response.ok) {
    throw new Error(`Logo storage read failed with ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function resolveCompanyLogoDataUrl(companySettings: CompanyDocumentBrandingInput): Promise<string | null> {
  const settings = companySettings || {};
  const organizationId = cleanDocumentText(settings.organizationId);
  const assetId = cleanDocumentText(settings.invoiceLogoAssetId);

  if (organizationId && assetId) {
    try {
      const [
        { assetRepository },
        { canonicalFileReadResolver },
        { storageProviderConfigRepository },
        { storageRegistry },
      ] = await Promise.all([
        import("../services/assets/AssetRepository"),
        import("../services/storage/CanonicalFileReadResolver"),
        import("../storage/storageProviderConfig.repo"),
        import("../services/storage/StorageRegistry"),
      ]);

      const asset = await assetRepository.getAssetById(organizationId, assetId);
      if (asset?.fileRecordId) {
        const assetMimeType = cleanDocumentText(asset.mimeType).toLowerCase();
        if (isInvoiceLogoAcceptedMimeType(assetMimeType)) {
          const resolved = await canonicalFileReadResolver.resolveOriginal(String(asset.fileRecordId));
          if (resolved.status === "available" && resolved.providerConfigId && (resolved.objectKey || resolved.localPathRef)) {
            const providerConfig = await storageProviderConfigRepository.getById(String(resolved.providerConfigId));
            if (providerConfig) {
              const handle = await storageRegistry.getAdapter(providerConfig.providerType).getDownloadHandle({
                providerConfig,
                objectKey: resolved.objectKey ?? null,
                localPathRef: resolved.localPathRef ?? null,
              });
              const buffer = await readBufferFromStorageHandle(handle);
              if (buffer.length) return `data:${assetMimeType};base64,${buffer.toString("base64")}`;
            }
          }
        }
      }
    } catch {
      return null;
    }
  }

  const legacyLogo = cleanDocumentText(settings.invoiceLogoUrl) || cleanDocumentText(settings.logoUrl);
  return isInvoiceLogoDataUrl(legacyLogo) ? legacyLogo : null;
}

export function buildDocumentCompanyBranding(companySettings: CompanyDocumentBrandingInput): CompanyDocumentBranding {
  const settings = companySettings || {};
  const companyDisplayName =
    cleanDocumentText(settings.companyDisplayName) ||
    cleanDocumentText(settings.companyName) ||
    cleanDocumentText(settings.legalCompanyName);
  const legalCompanyName = cleanDocumentText(settings.legalCompanyName);
  const physicalAddress = buildDocumentAddressBlock({
    line1: settings.physicalAddress?.line1,
    line2: settings.physicalAddress?.line2,
    city: settings.physicalAddress?.city,
    state: settings.physicalAddress?.state,
    postalCode: settings.physicalAddress?.postalCode,
    country: settings.physicalAddress?.country,
    legacy: settings.address,
  });

  return {
    companyDisplayName,
    legalCompanyName,
    showLegalCompanyName: !!legalCompanyName && legalCompanyName !== companyDisplayName,
    physicalAddress,
    phone: cleanDocumentText(settings.phone),
    email: cleanDocumentText(settings.email),
    website: cleanDocumentText(settings.website),
    taxId: cleanDocumentText(settings.taxId),
    invoiceLogoUrl: cleanDocumentText(settings.invoiceLogoUrl) || cleanDocumentText(settings.logoUrl),
    invoiceLogoAssetId: cleanDocumentText(settings.invoiceLogoAssetId),
    logoDataUrl: null,
  };
}

export async function resolveCompanyDocumentBranding(companySettings: CompanyDocumentBrandingInput): Promise<CompanyDocumentBranding> {
  return {
    ...buildDocumentCompanyBranding(companySettings),
    logoDataUrl: await resolveCompanyLogoDataUrl(companySettings),
  };
}
