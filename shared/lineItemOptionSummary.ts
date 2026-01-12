import type { ProductOptionItem } from "./schema";

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanizeToken(raw: string): string {
  const cleaned = raw.trim().replace(/[_\-]+/g, " ");
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeSelectionValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const v = value.trim();
    if (!v) return null;
    if (v === "true") return true;
    if (v === "false") return false;
    return v;
  }
  return null;
}

function getProductOptionsFromLineItem(lineItem: unknown): ProductOptionItem[] | null {
  const product = isRecord(lineItem) ? (lineItem as any).product : null;
  const options = product ? (product as any).optionsJson : null;
  return Array.isArray(options) ? (options as ProductOptionItem[]) : null;
}

function getSelectedOptionsFromLineItem(lineItem: unknown): any[] | null {
  if (!isRecord(lineItem)) return null;
  const embedded = (lineItem as any).selectedOptions;
  const fromSpecs = (lineItem as any)?.specsJson?.selectedOptions;

  const embeddedArr = Array.isArray(embedded) ? embedded : null;
  const specsArr = Array.isArray(fromSpecs) ? fromSpecs : null;

  if (embeddedArr && specsArr) {
    // When both exist but differ, prefer specsJson (matches the editor save path).
    // This avoids stale dual-storage mismatches where one field didn't update.
    const embeddedStr = JSON.stringify(embeddedArr);
    const specsStr = JSON.stringify(specsArr);
    if (embeddedStr !== specsStr) {
      const debug = (() => {
        try {
          const fromGlobal = (globalThis as any)?.DEBUG_OPTIONS_SUMMARY;
          if (fromGlobal === true || fromGlobal === "1" || fromGlobal === "true") return true;
          if (typeof localStorage !== "undefined") {
            const ls = localStorage.getItem("DEBUG_OPTIONS_SUMMARY");
            if (ls === "1" || ls === "true") return true;
          }
          // Vite-friendly env flag (optional)
          const viteEnv = (import.meta as any)?.env;
          const vite = viteEnv?.VITE_DEBUG_OPTIONS_SUMMARY;
          return vite === "1" || vite === "true";
        } catch {
          return false;
        }
      })();

      if (debug) {
        const product = (lineItem as any)?.product;
        const options = Array.isArray(product?.optionsJson) ? product.optionsJson : [];
        const hasGrommets = options.some((o: any) => String(o?.label ?? o?.name ?? "").toLowerCase().includes("grommet"));
        if (hasGrommets) {
          // eslint-disable-next-line no-console
          console.warn("[DEBUG_OPTIONS_SUMMARY] selectedOptions mismatch; preferring specsJson.selectedOptions", {
            lineItemId: (lineItem as any)?.id,
            embedded: embeddedArr,
            specs: specsArr,
          });
        }
      }

      return specsArr;
    }

    return embeddedArr;
  }

  if (specsArr) return specsArr;
  if (embeddedArr) return embeddedArr;
  return null;
}

function getOptionLabel(opt: ProductOptionItem | null): string | null {
  if (!opt) return null;
  const direct = safeString((opt as any).label) || safeString((opt as any).name);
  return direct || null;
}

function resolveChoiceLabel(opt: ProductOptionItem | null, rawValue: unknown): string | null {
  if (!opt) return null;
  const choices = (opt as any).choices;
  if (!Array.isArray(choices)) return null;

  const normalized = normalizeSelectionValue(rawValue);
  if (normalized == null) return null;

  for (const c of choices) {
    const cAny = c as any;
    const value = cAny?.value;
    if (typeof normalized === "string" && typeof value === "string" && value === normalized) {
      const label = safeString(cAny?.label);
      return label || humanizeToken(normalized);
    }
    if (typeof normalized === "number" && typeof value === "number" && value === normalized) {
      const label = safeString(cAny?.label);
      return label || String(normalized);
    }
  }

  return null;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeSelectionValue(a);
  const nb = normalizeSelectionValue(b);
  if (na == null || nb == null) return false;
  return na === nb;
}

function truncateOneLine(text: string, maxLen: number): string {
  const t = text.trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  const cut = Math.max(0, maxLen - 1);
  return t.slice(0, cut).trimEnd() + "…";
}

/**
 * Returns a one-line, human-readable option summary for a line item.
 *
 * - Uses real selected options from the canonical selection structure (selectedOptions or specsJson.selectedOptions)
 * - Uses product.optionsJson metadata when present to resolve stable order + labels
 * - Skips empty/default values when determinable
 * - Returns null when it cannot produce a trustworthy summary (no placeholder text)
 */
export function formatLineItemOptionSummary(lineItem: unknown): string | null {
  const selected = getSelectedOptionsFromLineItem(lineItem);
  if (!selected || !selected.length) return null;

  const productOptions = getProductOptionsFromLineItem(lineItem);
  if (!productOptions || !productOptions.length) {
    // Without option metadata we cannot reliably produce a labeled summary.
    return null;
  }

  const selectionByOptionId = new Map<string, any>();
  for (const s of selected) {
    const optionId = safeString((s as any)?.optionId);
    if (!optionId) continue;
    selectionByOptionId.set(optionId, s);
  }

  const ordered = [...productOptions].sort((a, b) => {
    const sa = typeof (a as any)?.sortOrder === "number" ? (a as any).sortOrder : 0;
    const sb = typeof (b as any)?.sortOrder === "number" ? (b as any).sortOrder : 0;
    if (sa !== sb) return sa - sb;
    const la = safeString((a as any)?.label) || safeString((a as any)?.id);
    const lb = safeString((b as any)?.label) || safeString((b as any)?.id);
    return la.localeCompare(lb);
  });

  const parts: string[] = [];

  for (const opt of ordered) {
    const optionId = safeString((opt as any)?.id);
    if (!optionId) continue;

    const s = selectionByOptionId.get(optionId);
    if (!s) continue;

    const label = getOptionLabel(opt);
    if (!label) continue;

    const rawValue = (s as any)?.value;
    const normalized = normalizeSelectionValue(rawValue);
    if (normalized == null) continue;

    // Skip defaults when determinable.
    const defaultValue = (opt as any)?.defaultValue;
    if (defaultValue != null && valuesEqual(normalized, defaultValue)) continue;

    const optType = safeString((opt as any)?.type).toLowerCase();

    // For checkbox/toggle: include only when truthy.
    if (optType === "checkbox" || optType === "toggle") {
      if (normalized === true) {
        parts.push(label);
      }
      continue;
    }

    const resolvedValue = resolveChoiceLabel(opt, normalized) ??
      (typeof normalized === "string" ? humanizeToken(normalized) : String(normalized));
    if (!resolvedValue) continue;

    parts.push(`${label}: ${resolvedValue}`);
  }

  if (!parts.length) return null;

  const joined = parts.join(" • ");
  const truncated = truncateOneLine(joined, 96);
  return truncated || null;
}
