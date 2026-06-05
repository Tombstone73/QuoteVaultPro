export type NormalizedPbv2ExportChoice = {
  label?: string;
  name?: string;
  key?: string;
  value?: string;
  default?: unknown;
  pricing?: unknown;
  routing?: unknown;
};

export type NormalizedPbv2ExportOption = {
  id?: string;
  label?: string;
  name?: string;
  key?: string;
  type: string;
  default?: unknown;
  choices: NormalizedPbv2ExportChoice[];
  pricing?: unknown;
  routing?: unknown;
  path: string;
  sourceShape: string;
};

export type Pbv2ExportOptionNormalizationDiagnostics = {
  rootKeys: string[];
  totalTraversedNodes: number;
  detectedOptionLikeNodes: number;
  optionGroupCount: number;
  choiceCount: number;
  skippedReasons: Record<string, number>;
};

export type Pbv2ExportOptionNormalizationResult = {
  options: NormalizedPbv2ExportOption[];
  diagnostics: Pbv2ExportOptionNormalizationDiagnostics;
};

const OPTION_TYPE_TOKENS = new Set([
  "INPUT",
  "OPTION",
  "QUESTION",
  "CHOICE",
  "SELECT",
  "SELECT_FIELD",
  "SELECTOR",
  "DROPDOWN",
  "RADIO",
  "RADIO_GROUP",
  "CHECKBOX",
  "CHECKBOX_GROUP",
  "BOOLEAN",
  "MULTISELECT",
  "MULTI_SELECT",
  "NUMBER",
  "NUMBER_INPUT",
  "TEXT",
  "TEXT_INPUT",
  "TEXTAREA",
  "FILE",
  "DIMENSION",
  "TOGGLE",
  "SWITCH",
]);

const GROUP_TYPE_TOKENS = new Set([
  "GROUP",
  "OPTION_GROUP",
  "OPTIONGROUP",
  "SECTION",
  "FIELDSET",
  "CATEGORY",
  "TAB",
]);

const COMPUTED_TYPE_TOKENS = new Set(["COMPUTE", "COMPUTED", "CALC", "CALCULATED", "FORMULA"]);

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeToken(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\s-]+/g, "_").toUpperCase() : "";
}

function normalizeComponentToken(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/[\s-]+/g, "_").toUpperCase() : "";
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstPresent(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function addSkip(skippedReasons: Record<string, number>, reason: string): void {
  skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
}

function getChildCollections(node: Record<string, any>): Array<{ key: string; value: unknown }> {
  return [
    { key: "children", value: node.children },
    { key: "groups", value: node.groups },
    { key: "questions", value: node.questions },
    { key: "fields", value: node.fields },
    { key: "inputs", value: node.inputs },
  ].filter((entry) => entry.value !== undefined);
}

function hasStructuralChildren(node: Record<string, any>): boolean {
  return getChildCollections(node).some((entry) => Array.isArray(entry.value) ? entry.value.length > 0 : isRecord(entry.value));
}

function isGroupLike(node: Record<string, any>): boolean {
  const tokens = [
    normalizeToken(node.kind),
    normalizeToken(node.type),
    normalizeComponentToken(node.component),
  ];

  if (tokens.some((token) => GROUP_TYPE_TOKENS.has(token))) return true;
  if (tokens.some((token) => OPTION_TYPE_TOKENS.has(token)) || isRecord(node.input)) return false;
  return hasStructuralChildren(node);
}

function isComputedLike(node: Record<string, any>): boolean {
  const tokens = [
    normalizeToken(node.kind),
    normalizeToken(node.type),
    normalizeComponentToken(node.component),
  ];
  return tokens.some((token) => COMPUTED_TYPE_TOKENS.has(token)) || isRecord(node.compute);
}

function optionTypeFromNode(node: Record<string, any>): string {
  const input = isRecord(node.input) ? node.input : {};
  const rawType = firstString(
    input.type,
    input.valueType,
    node.component,
    node.type,
    node.kind,
  );
  const normalized = String(rawType || "option").trim();
  const upper = normalized.toUpperCase();

  if (upper === "ENUM") return "select";
  if (upper === "BOOLEAN" || upper === "CHECKBOX") return "checkbox";
  return normalized.toLowerCase();
}

function getPricingMetadata(node: Record<string, any>): unknown {
  const pricing = firstPresent(
    node.pricing,
    node.pricingImpact,
    node.priceImpact,
    node.priceDelta,
    node.priceDeltaCents,
    node.pricingOverride,
  );
  return pricing;
}

function getRoutingMetadata(node: Record<string, any>): unknown {
  const routing: Record<string, unknown> = {};
  for (const key of ["visibility", "visibilityRules", "rules", "edges", "effects", "routing", "workflowTags", "materialOverride", "inventoryConsumption", "status"]) {
    if (node[key] !== undefined) routing[key] = node[key];
  }
  return Object.keys(routing).length > 0 ? routing : undefined;
}

function choiceFromValue(value: unknown): NormalizedPbv2ExportChoice | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    const stringValue = String(value);
    return { value: stringValue, label: stringValue };
  }

  const choice: NormalizedPbv2ExportChoice = {
    label: firstString(value.label, value.title, value.name, value.text),
    name: firstString(value.name),
    key: firstString(value.key, value.id, value.code),
    value: firstString(value.value, value.key, value.id, value.code, value.name, value.label),
    default: firstPresent(value.default, value.defaultValue, value.isDefault),
    pricing: getPricingMetadata(value),
    routing: getRoutingMetadata(value),
  };

  return Object.fromEntries(Object.entries(choice).filter(([, entryValue]) => entryValue !== undefined)) as NormalizedPbv2ExportChoice;
}

function valuesFromMaybeCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.values(value);
  return [];
}

function choicesFromNode(node: Record<string, any>, includeOptionsAsChoices: boolean): NormalizedPbv2ExportChoice[] {
  const input = isRecord(node.input) ? node.input : {};
  const constraints = isRecord(input.constraints) ? input.constraints : {};
  const enumConstraints = isRecord(constraints.enum) ? constraints.enum : {};
  const selectConstraints = isRecord(constraints.select) ? constraints.select : {};
  const rawChoiceCollections = [
    node.choices,
    node.values,
    input.choices,
    input.options,
    enumConstraints.options,
    selectConstraints.options,
  ];

  const choices: NormalizedPbv2ExportChoice[] = [];
  const seen = new Set<string>();

  for (const collection of rawChoiceCollections) {
    for (const rawChoice of valuesFromMaybeCollection(collection)) {
      const choice = choiceFromValue(rawChoice);
      if (!choice) continue;
      const signature = JSON.stringify([choice.value, choice.key, choice.label, choice.name]);
      if (seen.has(signature)) continue;
      seen.add(signature);
      choices.push(choice);
    }
  }

  for (const rawChoice of valuesFromMaybeCollection(node.options)) {
    if (!includeOptionsAsChoices && !isSelectableChoiceRecord(rawChoice)) continue;
    const choice = choiceFromValue(rawChoice);
    if (!choice) continue;
    const signature = JSON.stringify([choice.value, choice.key, choice.label, choice.name]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    choices.push(choice);
  }

  return choices;
}

function isSelectableChoiceRecord(value: unknown): boolean {
  if (!isRecord(value)) return value !== null && value !== undefined;
  if (isRecord(value.input)) return false;
  if (isGroupLike(value) && !firstString(value.value, value.key, value.code)) return false;
  return Boolean(firstString(value.value, value.key, value.code, value.id, value.name, value.label, value.title, value.text));
}

function nodeOptionsAreStructural(node: Record<string, any>): boolean {
  const options = valuesFromMaybeCollection(node.options);
  if (options.length === 0) return false;
  if (isGroupLike(node) && !isRecord(node.input)) return true;
  return options.some((option) => isRecord(option) && (
    isRecord(option.input) ||
    isGroupLike(option) ||
    isComputedLike(option) ||
    OPTION_TYPE_TOKENS.has(normalizeToken(option.type)) ||
    OPTION_TYPE_TOKENS.has(normalizeToken(option.kind)) ||
    OPTION_TYPE_TOKENS.has(normalizeComponentToken(option.component))
  ));
}

function isOptionLike(node: Record<string, any>): boolean {
  if (isComputedLike(node) || isGroupLike(node)) return false;
  const tokens = [
    normalizeToken(node.kind),
    normalizeToken(node.type),
    normalizeComponentToken(node.component),
  ];
  if (tokens.some((token) => OPTION_TYPE_TOKENS.has(token))) return true;
  if (isRecord(node.input)) return true;
  if (node.selectionKey || node.key) {
    return Boolean(node.choices || node.values || node.options || isRecord(node.pricing) || node.pricingImpact);
  }
  return false;
}

function normalizeOption(node: Record<string, any>, path: string): NormalizedPbv2ExportOption | null {
  const input = isRecord(node.input) ? node.input : {};
  const id = firstString(node.id, input.id);
  const label = firstString(node.label, node.title, node.prompt, node.question, input.label);
  const name = firstString(node.name, input.name);
  const key = firstString(input.selectionKey, node.selectionKey, node.key, input.key, id, name, label);

  if (!key && !label && !name && !id) return null;

  const includeOptionsAsChoices = !nodeOptionsAreStructural(node);
  const option: NormalizedPbv2ExportOption = {
    id,
    label,
    name,
    key,
    type: optionTypeFromNode(node),
    default: firstPresent(input.defaultValue, input.default, node.defaultValue, node.default),
    choices: choicesFromNode(node, includeOptionsAsChoices),
    pricing: getPricingMetadata(node),
    routing: getRoutingMetadata(node),
    path,
    sourceShape: [
      node.kind ? `kind:${String(node.kind)}` : null,
      node.type ? `type:${String(node.type)}` : null,
      node.component ? `component:${String(node.component)}` : null,
      isRecord(node.input) ? "input" : null,
    ].filter(Boolean).join("|") || "inferred",
  };

  return Object.fromEntries(Object.entries(option).filter(([, value]) => value !== undefined)) as NormalizedPbv2ExportOption;
}

function structuralEntriesFromTree(tree: Record<string, any>): Array<{ path: string; value: unknown }> {
  const entries: Array<{ path: string; value: unknown }> = [];

  if (isRecord(tree.root)) entries.push({ path: "root", value: tree.root });
  if (tree.children !== undefined) entries.push({ path: "children", value: tree.children });
  if (tree.groups !== undefined) entries.push({ path: "groups", value: tree.groups });
  if (tree.questions !== undefined) entries.push({ path: "questions", value: tree.questions });
  if (tree.options !== undefined) entries.push({ path: "options", value: tree.options });

  if (tree.nodes !== undefined) {
    if (Array.isArray(tree.nodes)) {
      tree.nodes.forEach((node, index) => entries.push({ path: `nodes[${index}]`, value: node }));
    } else if (isRecord(tree.nodes)) {
      for (const key of Object.keys(tree.nodes).sort()) {
        entries.push({ path: `nodes.${key}`, value: tree.nodes[key] });
      }
    }
  }

  if (entries.length === 0 && (isOptionLike(tree) || isGroupLike(tree) || hasStructuralChildren(tree))) {
    entries.push({ path: "$", value: tree });
  }

  return entries;
}

export function normalizePbv2ExportOptions(treeJson: unknown): Pbv2ExportOptionNormalizationResult {
  const parsed = parseMaybeJson(treeJson);
  const skippedReasons: Record<string, number> = {};
  const diagnostics: Pbv2ExportOptionNormalizationDiagnostics = {
    rootKeys: isRecord(parsed)
      ? Object.keys(isRecord(parsed.root) ? parsed.root : parsed).sort()
      : [],
    totalTraversedNodes: 0,
    detectedOptionLikeNodes: 0,
    optionGroupCount: 0,
    choiceCount: 0,
    skippedReasons,
  };

  if (!isRecord(parsed)) {
    return { options: [], diagnostics };
  }

  const options: NormalizedPbv2ExportOption[] = [];
  const visited = new WeakSet<object>();
  const seenOptions = new Set<string>();

  function walk(value: unknown, path: string): void {
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, `${path}[${index}]`));
      return;
    }

    if (!isRecord(value)) return;
    if (visited.has(value)) return;
    visited.add(value);
    diagnostics.totalTraversedNodes += 1;

    const node = value;
    const groupLike = isGroupLike(node);
    const computedLike = isComputedLike(node);
    const optionLike = isOptionLike(node);

    if (groupLike) {
      diagnostics.optionGroupCount += 1;
      addSkip(skippedReasons, "group_node");
    } else if (computedLike) {
      addSkip(skippedReasons, "computed_node");
    } else if (optionLike) {
      diagnostics.detectedOptionLikeNodes += 1;
      const normalized = normalizeOption(node, path);
      if (!normalized) {
        addSkip(skippedReasons, "option_missing_identity");
      } else {
        const signature = JSON.stringify([normalized.key, normalized.id, normalized.label, normalized.path]);
        if (!seenOptions.has(signature)) {
          seenOptions.add(signature);
          diagnostics.choiceCount += normalized.choices.length;
          options.push(normalized);
        } else {
          addSkip(skippedReasons, "duplicate_option");
        }
      }
    } else {
      addSkip(skippedReasons, "not_option_like");
    }

    for (const entry of getChildCollections(node)) {
      walk(entry.value, `${path}.${entry.key}`);
    }

    if (node.options !== undefined && nodeOptionsAreStructural(node)) {
      walk(node.options, `${path}.options`);
    }
  }

  for (const entry of structuralEntriesFromTree(parsed)) {
    walk(entry.value, entry.path);
  }

  return { options, diagnostics };
}
