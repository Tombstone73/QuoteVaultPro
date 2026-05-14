export function centsToCurrencyInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return (value / 100).toFixed(2);
}

export function decimalCurrencyToInput(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value.toFixed(2);
}

export function currencyInputToCents(value: string): number | undefined {
  const normalized = value.trim().replace(/[$,]/g, "");
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

export function normalizeVariableDisplay(raw: string): string {
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return raw;
  return num.toFixed(2);
}

export function centsToCurrencyLabel(value: number | null | undefined): string {
  const cents = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const sign = cents >= 0 ? "+" : "-";
  return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}
