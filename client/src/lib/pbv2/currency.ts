export function centsToCurrencyInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return (value / 100).toFixed(2);
}

export function centsToCurrencyRateInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const fixed = (value / 100).toFixed(6);
  const [whole, fraction = ""] = fixed.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}

export function decimalCurrencyToInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const fixed = value.toFixed(6);
  const [whole, fraction = ""] = fixed.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}

export function currencyInputToCents(value: string): number | undefined {
  const normalized = value.trim().replace(/[$,]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

export function currencyRateInputToCents(value: string): number | undefined {
  const normalized = value.trim().replace(/[$,]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed * 100;
}

export function normalizeVariableDisplay(raw: string): string {
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return raw;
  const fixed = num.toFixed(6);
  const [whole, fraction = ""] = fixed.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole}.${trimmed.padEnd(2, "0")}`;
}

export function centsToCurrencyLabel(value: number | null | undefined): string {
  const cents = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}
