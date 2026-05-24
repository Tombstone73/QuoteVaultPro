export const portalFileCategoryValues = [
  "invoice_pdf",
  "quote_pdf",
  "proof",
  "approved_artwork",
  "customer_upload",
  "production_reference",
  "shipping_document",
  "other_customer_document",
] as const;

export type PortalFileCategory = (typeof portalFileCategoryValues)[number];

const portalFileCategoryLabels: Record<PortalFileCategory, string> = {
  invoice_pdf: "Invoice",
  quote_pdf: "Quote",
  proof: "Proof",
  approved_artwork: "Approved Artwork",
  customer_upload: "Customer Upload",
  production_reference: "Production Reference",
  shipping_document: "Shipping Document",
  other_customer_document: "Customer Document",
};

export function isPortalFileCategory(value: unknown): value is PortalFileCategory {
  return typeof value === "string" && portalFileCategoryValues.includes(value as PortalFileCategory);
}

export function normalizePortalFileCategory(value: unknown, fallback: PortalFileCategory = "other_customer_document"): PortalFileCategory {
  return isPortalFileCategory(value) ? value : fallback;
}

export function getPortalFileCategoryLabel(value: unknown): string {
  return portalFileCategoryLabels[normalizePortalFileCategory(value)];
}
