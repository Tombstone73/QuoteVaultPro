/** Safe presentation-only formatting for canonical enum-like values. */
export function formatAssistantDisplayValue(value: string | null | undefined): string {
  if (!value) return "Unavailable";
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
