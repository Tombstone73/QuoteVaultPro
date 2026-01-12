import type { OrderLineItem, ProductOptionItem } from "@shared/schema";
import {
  deriveLineItemFlags,
  type LineItemFlagOnClick,
  type LineItemFlagSuppression,
  type LineItemFlagTone,
  type LineItemFlagVM,
} from "@shared/lineItemFlags";
import { formatLineItemOptionSummary } from "@shared/lineItemOptionSummary";

export type { LineItemFlagTone, LineItemFlagOnClick, LineItemFlagVM, LineItemFlagSuppression };

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
  const text = formatLineItemOptionSummary(lineItem);
  if (!text) return null;

  // Keep legacy VM shape for existing UI. We no longer split into many parts
  // here because the shared formatter already truncates to one line.
  return { primary: [text], secondaryCount: 0 };
}

export function buildLineItemFlags(
  lineItem: OrderLineItem,
  ctx?: {
    notesText?: string;
    productArtworkPolicy?: "not_required" | "required" | null;
    artwork?: {
      lineItemAttachments?: { associationKnown: boolean; count: number; items?: unknown[] };
      lineItemAssets?: { associationKnown: boolean; count: number; items?: unknown[] };
    };
  }
): LineItemFlagVM[] {
  return deriveLineItemFlags(lineItem, ctx);
}
