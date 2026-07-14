export type DocumentNumberType = "quote" | "order" | "invoice" | "purchase_order";

export type ProductionDocumentNumberDisplayMode = "full" | "number_only";

export const DEFAULT_DOCUMENT_NUMBER_PREFIXES: Record<DocumentNumberType, string> = {
  quote: "QT-",
  order: "ORD-",
  invoice: "INV-",
  purchase_order: "PO-",
};

export const DOCUMENT_NUMBER_PREFIX_VARIABLES: Record<DocumentNumberType, string> = {
  quote: "quote_number_prefix",
  order: "order_number_prefix",
  invoice: "invoice_number_prefix",
  purchase_order: "purchase_order_number_prefix",
};

const PREFIX_PATTERN = /^[A-Za-z0-9_-]*$/;
export const DOCUMENT_NUMBER_PREFIX_MAX_LENGTH = 16;

export function sanitizeDocumentNumberPrefix(value: unknown): string {
  const prefix = String(value ?? "").trim();
  if (prefix.length > DOCUMENT_NUMBER_PREFIX_MAX_LENGTH) {
    throw new Error(`Prefix must be ${DOCUMENT_NUMBER_PREFIX_MAX_LENGTH} characters or fewer.`);
  }
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error("Prefix may only contain letters, numbers, dashes, and underscores.");
  }
  return prefix;
}

export function formatDocumentNumber(prefix: string | null | undefined, numberCore: number): string {
  return `${prefix ?? ""}${numberCore}`;
}

export function normalizeDocumentNumberSearch(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function numericCoreFromSearch(value: unknown): number | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function documentNumberMatchesSearch(args: {
  query: unknown;
  displayNumber?: unknown;
  numberCore?: unknown;
  legacyNumber?: unknown;
}): boolean {
  const normalizedQuery = normalizeDocumentNumberSearch(args.query);
  if (!normalizedQuery) return true;

  const normalizedDisplay = normalizeDocumentNumberSearch(args.displayNumber);
  if (normalizedDisplay.includes(normalizedQuery)) return true;

  const normalizedLegacy = normalizeDocumentNumberSearch(args.legacyNumber);
  if (normalizedLegacy.includes(normalizedQuery)) return true;

  const queryCore = numericCoreFromSearch(args.query);
  const numberCore = Number(args.numberCore);
  if (queryCore != null && Number.isFinite(numberCore) && numberCore === queryCore) return true;

  return false;
}

export function resolveDocumentDisplayNumber(args: {
  displayNumber?: string | number | null;
  numberCore?: string | number | null;
  legacyNumber?: string | number | null;
  prefix?: string | null;
}): string {
  const display = String(args.displayNumber ?? "").trim();
  if (display) return display;

  const core = Number(args.numberCore);
  if (Number.isFinite(core) && core > 0) {
    return formatDocumentNumber(args.prefix ?? "", Math.floor(core));
  }

  const legacy = String(args.legacyNumber ?? "").trim();
  return legacy;
}

export function formatProductionDocumentNumber(args: {
  displayNumber?: string | number | null;
  numberCore?: string | number | null;
  legacyNumber?: string | number | null;
  mode?: ProductionDocumentNumberDisplayMode | string | null;
}): string {
  if (args.mode === "number_only") {
    const core = Number(args.numberCore);
    if (Number.isFinite(core) && core > 0) return String(Math.floor(core));
    const legacy = String(args.legacyNumber ?? "").trim();
    const digits = legacy.replace(/\D/g, "");
    return digits || legacy;
  }
  return resolveDocumentDisplayNumber(args);
}
