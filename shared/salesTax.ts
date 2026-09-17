/**
 * Sales-tax rates are stored and exchanged as decimals (0.07), while people
 * enter and read percentages (7.00). Keeping the conversion here prevents UI
 * forms from accidentally persisting a percentage as a decimal rate.
 */
export const MAX_SALES_TAX_RATE = 0.3;

export function taxRateDecimalFromPercent(value: number): number {
  return value / 100;
}

export function taxRatePercentFromDecimal(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100 * 1_000_000) / 1_000_000 : 0;
}

export function formatTaxRatePercent(value: number | string | null | undefined): string {
  return taxRatePercentFromDecimal(value).toFixed(2);
}
