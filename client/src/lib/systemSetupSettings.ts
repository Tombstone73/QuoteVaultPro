export function normalizeSystemSetupSequenceValue(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    throw new Error("Please enter a positive whole number.");
  }
  const numericValue = Number(text);
  if (!Number.isSafeInteger(numericValue) || numericValue < 1) {
    throw new Error("Please enter a valid positive number.");
  }
  return text;
}
