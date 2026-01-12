import type { OrderLineItem, ProductOptionItem } from "@shared/schema";

export type LineItemFlagTone = "neutral" | "warning" | "danger" | "success";
export type LineItemFlagOnClick = "expand_notes" | "expand_artwork" | null;

export type LineItemFlagVM = {
  key: string;
  label: string;
  tone: LineItemFlagTone;
  tooltip?: string;
  onClick?: LineItemFlagOnClick;
};

export type LineItemFlagSuppression = {
  reason: string;
  at: string; // ISO string
  byUserId?: string;
};

type ArtworkPolicy = "not_required" | "required";

function getSuppressedFlagsMap(lineItem: OrderLineItem): Record<string, LineItemFlagSuppression> {
  const specs = (lineItem as any)?.specsJson;
  const suppressed = specs?.flags?.suppressed;
  return suppressed && typeof suppressed === "object" ? (suppressed as Record<string, LineItemFlagSuppression>) : {};
}

function getSuppression(lineItem: OrderLineItem, flagKey: string): LineItemFlagSuppression | null {
  const map = getSuppressedFlagsMap(lineItem);
  const entry = map?.[flagKey];
  if (!entry || typeof entry !== "object") return null;
  const reason = typeof (entry as any).reason === "string" ? (entry as any).reason.trim() : "";
  const at = typeof (entry as any).at === "string" ? (entry as any).at.trim() : "";
  if (!reason || !at) return null;
  return entry as LineItemFlagSuppression;
}

export type LineItemOptionSummaryVM = {
  primary: string[];
  secondaryCount: number;
};

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanizeToken(raw: string): string {
  const cleaned = raw.trim().replace(/[_\-]+/g, " ");
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatSelectionValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "string") return humanizeToken(value);
  return null;
}

function getProductOptionsFromLineItem(lineItem: unknown): ProductOptionItem[] | null {
  const product = (lineItem as any)?.product;
  const options = (product as any)?.optionsJson;
  return Array.isArray(options) ? (options as ProductOptionItem[]) : null;
}

function getSelectedOptionsFromLineItem(lineItem: unknown): any[] | null {
  const embedded = (lineItem as any)?.selectedOptions;
  if (Array.isArray(embedded)) return embedded;
  const fromSpecs = (lineItem as any)?.specsJson?.selectedOptions;
  return Array.isArray(fromSpecs) ? fromSpecs : null;
}

function getOptionLabel(opt: ProductOptionItem | null): string | null {
  if (!opt) return null;
  const direct = safeString((opt as any).label) || safeString((opt as any).name);
  return direct || null;
}

function tryResolveValueLabel(opt: ProductOptionItem | null, rawValue: unknown): string | null {
  if (!opt) return null;
  const values = (opt as any).values;
  if (!Array.isArray(values)) return null;

  const rawString = typeof rawValue === "string" ? rawValue : null;
  const rawNumber = typeof rawValue === "number" ? rawValue : null;

  for (const v of values) {
    const vAny = v as any;
    const vValue = vAny?.value;
    if (rawString != null && typeof vValue === "string" && vValue === rawString) {
      const label = safeString(vAny?.label);
      return label || humanizeToken(rawString);
    }
    if (rawNumber != null && typeof vValue === "number" && vValue === rawNumber) {
      const label = safeString(vAny?.label);
      return label || String(rawNumber);
    }
  }

  return null;
}

export function buildLineItemOptionSummary(lineItem: OrderLineItem): LineItemOptionSummaryVM | null {
  const selected = getSelectedOptionsFromLineItem(lineItem);
  if (!selected || !selected.length) return null;

  const productOptions = getProductOptionsFromLineItem(lineItem);
  if (!productOptions) {
    // TODO: Order line item payload must include product.optionsJson (or equivalent option metadata)
    // so we can render a human-readable option summary.
    return null;
  }

  const parts: string[] = [];

  for (const s of selected) {
    const optionId = safeString(s?.optionId);
    if (!optionId) continue;

    const opt = productOptions.find((o) => (o as any)?.id === optionId) ?? null;
    const label = getOptionLabel(opt);
    if (!label) continue;

    const rawValue = (s as any)?.value;

    const resolvedValue =
      tryResolveValueLabel(opt, rawValue) ??
      formatSelectionValue(rawValue);

    if (!resolvedValue) continue;

    parts.push(`${label}: ${resolvedValue}`);
  }

  if (!parts.length) return null;

  const primary = parts.slice(0, 2);
  const secondaryCount = Math.max(0, parts.length - primary.length);

  return { primary, secondaryCount };
}

export function buildLineItemFlags(
  lineItem: OrderLineItem,
  ctx?: {
    notesText?: string;
    productArtworkPolicy?: ArtworkPolicy | null;
    artwork?: {
      lineItemAttachments?: { associationKnown: boolean; count: number };
      lineItemAssets?: { associationKnown: boolean; count: number };
    };
  }
): LineItemFlagVM[] {
  const flags: LineItemFlagVM[] = [];

  const notesText = (ctx?.notesText ?? (lineItem as any)?.specsJson?.lineItemNotes?.descLong ?? "").trim();
  if (notesText.length > 0) {
    flags.push({
      key: "notes",
      label: "NOTES",
      tone: "neutral",
      tooltip: notesText,
      onClick: "expand_notes",
    });
  }

  const artworkPolicy = ctx?.productArtworkPolicy ?? null;
  if (artworkPolicy === "required") {
    const suppressed = getSuppression(lineItem, "missing_artwork");

    // Only render missing_artwork when we can reliably determine line-item-scoped artwork presence.
    const attachments = ctx?.artwork?.lineItemAttachments;
    const assets = ctx?.artwork?.lineItemAssets;

    const attachmentsKnown = attachments?.associationKnown === true;
    const assetsKnown = assets?.associationKnown === true;

    if (!attachmentsKnown || !assetsKnown) {
      // TODO(missing_artwork): Derivation requires line-item-scoped artwork association data.
      // Missing payload fields/contract:
      // - Order line item assets: `/api/orders/:orderId/line-item-previews` (or equivalent) must return an entry per lineItemId with at least `thumbCount`.
      // - Order attachments: `/api/orders/:orderId/files` items must include `orderLineItemId` for per-line-item attachments.
      // Until both sources are available/loaded, keep missing_artwork OFF.
      return flags;
    }

    const attachmentCount = Number(attachments?.count) || 0;
    const assetCount = Number(assets?.count) || 0;
    const hasAnyArtwork = attachmentCount > 0 || assetCount > 0;

    if (!hasAnyArtwork && !suppressed) {
      flags.unshift({
        key: "missing_artwork",
        label: "Missing artwork",
        tone: "warning",
        tooltip: "No line-item artwork attached.",
        onClick: null,
      });
    }
  }

  return flags;
}
