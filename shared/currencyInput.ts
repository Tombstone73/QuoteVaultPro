/**
 * Parses a non-negative dollar entry without allowing floating point to become
 * the monetary authority. The UI may retain a trailing decimal while typing;
 * committing it treats that as whole dollars.
 */
export function parseCurrencyDollarsToCents(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;

  const [wholePart, fractionPart = ""] = normalized.split(".");
  const whole = Number(wholePart);
  const fraction = Number((fractionPart + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null;

  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}
