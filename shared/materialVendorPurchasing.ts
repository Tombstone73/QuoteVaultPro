export type MaterialVendorUrlNormalizationResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function normalizeMaterialVendorProductUrl(value: unknown): MaterialVendorUrlNormalizationResult {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") {
    return { ok: false, message: "Ordering URL must be text." };
  }

  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };

  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, message: "Enter a valid ordering URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, message: "Ordering URL must start with http:// or https://." };
  }

  if (!parsed.hostname) {
    return { ok: false, message: "Ordering URL must include a host name." };
  }

  return { ok: true, value: parsed.toString() };
}

export function dollarsToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const amount = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function centsToDollars(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const cents = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(cents)) return undefined;
  return cents / 100;
}
