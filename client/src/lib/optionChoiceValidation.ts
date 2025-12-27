export type ChoiceLike = { value?: unknown };

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function choiceValueIsValid(choice: ChoiceLike | null | undefined): boolean {
  return isNonEmptyString(choice?.value);
}

export function optionHasInvalidChoices(option: { type?: unknown; choices?: unknown } | null | undefined): boolean {
  if (!option) return false;
  if (option.type !== "select") return false;
  const choices = Array.isArray(option.choices) ? (option.choices as ChoiceLike[]) : [];
  return choices.some((c) => !choiceValueIsValid(c));
}

export function getValidChoices<T extends ChoiceLike>(choices: T[] | null | undefined): T[] {
  return (Array.isArray(choices) ? choices : []).filter((c) => choiceValueIsValid(c));
}

export function optionsHaveInvalidChoices(options: unknown): boolean {
  if (!Array.isArray(options)) return false;
  return options.some((opt) => optionHasInvalidChoices(opt as any));
}
