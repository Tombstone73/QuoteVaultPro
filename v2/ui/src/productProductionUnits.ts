import type {
  ProductDraftOptionPricing,
  ProductProductionUnitRule,
  ProductProductionUnitSpecification,
} from "./api";

export type ProductionUnitAuthoringMode =
  | "unconfigured"
  | "front"
  | "front-back"
  | "conditional";

export type ConditionalProductionOption =
  ProductDraftOptionPricing["options"][number];

export const productionUnitAuthoringMode = (
  specification: ProductProductionUnitSpecification | null,
): ProductionUnitAuthoringMode => {
  if (!specification) return "unconfigured";
  const rules = specification.rules;
  if (
    rules.length === 1 &&
    rules[0]?.key === "front" &&
    rules[0].side === "front" &&
    !rules[0].when
  )
    return "front";
  if (
    rules.length === 2 &&
    rules.every((rule) => !rule.when) &&
    rules.some((rule) => rule.key === "front" && rule.side === "front") &&
    rules.some((rule) => rule.key === "back" && rule.side === "back")
  )
    return "front-back";
  return "conditional";
};

export const presetProductionUnitSpecification = (
  mode: Exclude<ProductionUnitAuthoringMode, "conditional">,
): ProductProductionUnitSpecification | null =>
  mode === "unconfigured"
    ? null
    : mode === "front"
      ? { schemaVersion: 1, rules: [{ key: "front", side: "front" }] }
      : {
          schemaVersion: 1,
          rules: [
            { key: "front", side: "front" },
            { key: "back", side: "back" },
          ],
        };

export const conditionOptions = (
  options: readonly ConditionalProductionOption[],
) => options.filter((option) => option.choices.length > 0);

export const conditionalProductionUnitSpecification = (
  front: "always" | string,
  back: "always" | string,
  options: readonly ConditionalProductionOption[],
): ProductProductionUnitSpecification => {
  const ruleFor = (key: "front" | "back", selected: "always" | string) => {
    const side = key;
    if (selected === "always") return { key, side } as const;
    const [selectionKey, choiceValue] = selected.split("\u0000");
    const option = conditionOptions(options).find(
      (candidate) => candidate.selectionKey === selectionKey,
    );
    if (!option || !option.choices.some((choice) => choice.choiceValue === choiceValue))
      throw new Error("Select a valid Product Option and choice.");
    return {
      key,
      side,
      when: { selectionKey, equals: choiceValue },
    } as const;
  };
  return { schemaVersion: 1, rules: [ruleFor("front", front), ruleFor("back", back)] };
};

export const conditionToken = (selectionKey: string, choiceValue: string) =>
  `${selectionKey}\u0000${choiceValue}`;

export const conditionLabel = (
  condition: { selectionKey: string; equals: string | number | boolean } | undefined,
  options: readonly ConditionalProductionOption[],
) => {
  if (!condition) return "Always";
  const option = options.find(
    (candidate) => candidate.selectionKey === condition.selectionKey,
  );
  const choice = option?.choices.find(
    (candidate) => candidate.choiceValue === condition.equals,
  );
  return option && choice
    ? `When ${option.label} = ${choice.label}`
    : `When ${condition.selectionKey} = ${String(condition.equals)}`;
};

/**
 * The production contract persists a zero-based source page, while the Builder
 * presents pages the way staff see them in a PDF (starting at one).  Keep that
 * translation at the boundary so ProductVersion truth never receives a UI
 * display value by accident.
 */
export const productionUnitDisplayPage = (
  rule: Pick<ProductProductionUnitRule, "sourcePageIndex">,
) => rule.sourcePageIndex === undefined ? "" : String(rule.sourcePageIndex + 1);

export const withProductionUnitSide = (
  rule: ProductProductionUnitRule,
  side: "" | "front" | "back",
): ProductProductionUnitRule => {
  const { side: _side, ...rest } = rule;
  return side ? { ...rest, side } : rest;
};

export const withProductionUnitDisplayPage = (
  rule: ProductProductionUnitRule,
  page: number | null,
): ProductProductionUnitRule => {
  const { sourcePageIndex: _sourcePageIndex, ...rest } = rule;
  if (page !== null && (!Number.isInteger(page) || page < 1))
    throw new Error("Production source pages must be positive integers.");
  return page === null ? rest : { ...rest, sourcePageIndex: page - 1 };
};

/** A layer is atomic in the canonical contract: a key and zero-based order are
 * always present together.  Clearing either Builder field therefore clears the
 * pair instead of persisting a structurally-invalid partial layer. */
export const withProductionUnitLayer = (
  rule: ProductProductionUnitRule,
  layerKey: string,
  displayOrder: number | null,
): ProductProductionUnitRule => {
  const { layerKey: _layerKey, layerOrder: _layerOrder, ...rest } = rule;
  const normalizedKey = layerKey.trim();
  if (displayOrder !== null && (!Number.isInteger(displayOrder) || displayOrder < 1))
    throw new Error("Production layer order must be a positive integer.");
  return normalizedKey && displayOrder !== null
    ? { ...rest, layerKey: normalizedKey, layerOrder: displayOrder - 1 }
    : rest;
};
