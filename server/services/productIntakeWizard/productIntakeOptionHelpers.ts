export type NormalizedChoiceLabel = {
  label: string;
  isDefault: boolean;
};

const DEFAULT_ANNOTATION = /\s*(?:\((?:default(?:\s+option|\s+choice)?)\)|\[(?:default(?:\s+option|\s+choice)?)\]|\bdefault\s+option\b)\s*$/i;

export function stripDefaultChoiceAnnotation(value: unknown): NormalizedChoiceLabel {
  const original = String(value ?? "").trim();
  if (!original) return { label: "", isDefault: false };
  const isDefault = DEFAULT_ANNOTATION.test(original);
  const label = original.replace(DEFAULT_ANNOTATION, "").trim();
  return { label: label || original, isDefault };
}

export function normalizeChoiceLabels(values: unknown[]): { labels: string[]; defaultChoice: string | null } {
  const labels: string[] = [];
  let defaultChoice: string | null = null;
  for (const value of values) {
    const parsed = stripDefaultChoiceAnnotation(value);
    if (!parsed.label || labels.some((label) => label.toLowerCase() === parsed.label.toLowerCase())) continue;
    labels.push(parsed.label);
    if (parsed.isDefault) defaultChoice = parsed.label;
  }
  return { labels, defaultChoice };
}

export function choicePricingExample(choiceLabels: string[]): string {
  const labels = choiceLabels.filter(Boolean);
  if (labels.length === 2 && labels.some((label) => /^no$/i.test(label)) && labels.some((label) => /^yes$/i.test(label))) {
    const no = labels.find((label) => /^no$/i.test(label))!;
    const yes = labels.find((label) => /^yes$/i.test(label))!;
    return `${no}=0, ${yes}=0.25`;
  }
  return labels.slice(0, 4).map((label) => `${label}=0`).join(", ") || "choice=0.00";
}

export function normalizeChoicePricingAnswer(value: unknown, choiceLabels: string[]): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.includes("=")) return text;

  const labels = choiceLabels.filter(Boolean);
  const no = labels.find((label) => /^no$/i.test(label));
  const yes = labels.find((label) => /^yes$/i.test(label));
  const amountMatch = text.match(/(?:^|\s)(\d*\.\d+|\d+)(?=\s*(?:per|each|\/|$))/i);
  const isPerUnit = /\b(?:per\s+(?:grommet|piece|unit|item)|each|\/\s*(?:grommet|piece|unit|item))\b/i.test(text);
  if (no && yes && amountMatch && isPerUnit) {
    const amount = Number(amountMatch[1]);
    if (Number.isFinite(amount) && amount >= 0) return `${no}=0, ${yes}=${amount}`;
  }
  return text;
}
