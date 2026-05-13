import type { LineItemOptionSelectionsV2 } from "./optionTreeV2";
import { normalizeSelectionMap } from "./optionTreeV2Runtime";

export type ProductOptionRuleConditionOperator =
  | "equals"
  | "not_equals"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists";

export type ProductOptionRuleActionType =
  | "show"
  | "hide"
  | "disable"
  | "enable"
  | "require"
  | "optional"
  | "clear"
  | "set_default";

export type ProductOptionRuleCondition = {
  optionGroup: string;
  operator: ProductOptionRuleConditionOperator;
  value?: unknown;
};

export type ProductOptionRuleConditionGroup =
  | { all: ProductOptionRuleCondition[]; any?: never }
  | { any: ProductOptionRuleCondition[]; all?: never };

export type ProductOptionRuleAction = {
  action: ProductOptionRuleActionType;
  targetOptionGroup: string;
  value?: unknown;
};

export type ProductOptionRule = {
  id: string;
  label?: string;
  enabled?: boolean;
  when: ProductOptionRuleConditionGroup;
  then: ProductOptionRuleAction[];
  else?: ProductOptionRuleAction[];
};

export type ProductOptionRuleMessageCode =
  | "OPTION_RULE_CLEARED"
  | "OPTION_RULE_DEFAULTED"
  | "OPTION_RULE_REQUIRED_MISSING";

export type ProductOptionRuleMessage = {
  optionGroup: string;
  code: ProductOptionRuleMessageCode;
  message: string;
};

export type ProductOptionRuleAppliedAction = ProductOptionRuleAction & {
  ruleId: string;
  phase: "visibility" | "enablement" | "clearing" | "defaults" | "validation";
};

export type EvaluateProductOptionRulesInput = {
  rules?: ProductOptionRule[];
  selections?: LineItemOptionSelectionsV2 | Record<string, unknown>;
  optionGroups?: string[];
  visibleOptionGroups?: string[];
  disabledOptionGroups?: string[];
  requiredOptionGroups?: string[];
  maxPasses?: number;
};

export type ProductOptionRuleEvaluationResult = {
  effectiveSelections: Record<string, unknown>;
  visibleOptionGroups: string[];
  hiddenOptionGroups: string[];
  enabledOptionGroups: string[];
  disabledOptionGroups: string[];
  requiredOptionGroups: string[];
  optionalOptionGroups: string[];
  clearedOptionGroups: string[];
  defaultedOptionGroups: string[];
  messages: ProductOptionRuleMessage[];
  errors: ProductOptionRuleMessage[];
  appliedActions: ProductOptionRuleAppliedAction[];
  isValidForPricing: boolean;
};

type RuleState = {
  optionGroups: Set<string>;
  visible: Set<string>;
  disabled: Set<string>;
  required: Set<string>;
  selections: Record<string, unknown>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(isNonEmptyString))).sort((a, b) => a.localeCompare(b));
}

function isSelectionPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function valueEquals(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    if (Array.isArray(expected)) return expected.every((entry) => actual.includes(entry));
    return actual.includes(expected);
  }
  return actual === expected;
}

function valueIn(actual: unknown, expected: unknown): boolean {
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  if (Array.isArray(actual)) return actual.some((entry) => expectedValues.includes(entry));
  return expectedValues.includes(actual);
}

export function evaluateProductOptionRuleCondition(
  condition: ProductOptionRuleCondition,
  selections: Record<string, unknown>
): boolean {
  const value = selections[condition.optionGroup];

  switch (condition.operator) {
    case "equals":
      return isSelectionPresent(value) && valueEquals(value, condition.value);
    case "not_equals":
      return !isSelectionPresent(value) || !valueEquals(value, condition.value);
    case "in":
      return isSelectionPresent(value) && valueIn(value, condition.value);
    case "not_in":
      return !isSelectionPresent(value) || !valueIn(value, condition.value);
    case "exists":
      return isSelectionPresent(value);
    case "not_exists":
      return !isSelectionPresent(value);
    default: {
      const _exhaustive: never = condition.operator;
      return _exhaustive;
    }
  }
}

export function evaluateProductOptionRuleConditionGroup(
  group: ProductOptionRuleConditionGroup,
  selections: Record<string, unknown>
): boolean {
  if (Array.isArray(group.all)) {
    return group.all.every((condition) => evaluateProductOptionRuleCondition(condition, selections));
  }

  if (Array.isArray(group.any)) {
    return group.any.some((condition) => evaluateProductOptionRuleCondition(condition, selections));
  }

  return false;
}

function collectRuleOptionGroups(rules: ProductOptionRule[] | undefined): string[] {
  const out = new Set<string>();

  const addAction = (action: ProductOptionRuleAction) => {
    if (isNonEmptyString(action.targetOptionGroup)) out.add(action.targetOptionGroup);
  };

  for (const rule of rules ?? []) {
    const conditions = Array.isArray(rule.when?.all) ? rule.when.all : Array.isArray(rule.when?.any) ? rule.when.any : [];
    for (const condition of conditions) {
      if (isNonEmptyString(condition.optionGroup)) out.add(condition.optionGroup);
    }
    for (const action of rule.then ?? []) addAction(action);
    for (const action of rule.else ?? []) addAction(action);
  }

  return Array.from(out);
}

function buildInitialState(input: EvaluateProductOptionRulesInput): RuleState {
  const selections = normalizeSelectionMap(input.selections);
  const optionGroups = new Set<string>([
    ...Object.keys(selections),
    ...(input.optionGroups ?? []),
    ...collectRuleOptionGroups(input.rules),
  ].filter(isNonEmptyString));

  const visible = input.visibleOptionGroups
    ? new Set(input.visibleOptionGroups.filter(isNonEmptyString))
    : new Set(optionGroups);
  const disabled = new Set((input.disabledOptionGroups ?? []).filter(isNonEmptyString));
  const required = new Set((input.requiredOptionGroups ?? []).filter(isNonEmptyString));

  for (const key of Array.from(visible)) optionGroups.add(key);
  for (const key of Array.from(disabled)) optionGroups.add(key);
  for (const key of Array.from(required)) optionGroups.add(key);

  return { optionGroups, visible, disabled, required, selections: { ...selections } };
}

function selectedActionsForPass(rules: ProductOptionRule[] | undefined, selections: Record<string, unknown>) {
  const actions: Array<{ ruleId: string; action: ProductOptionRuleAction }> = [];

  for (const rule of rules ?? []) {
    if (!rule || rule.enabled === false) continue;
    const branch = evaluateProductOptionRuleConditionGroup(rule.when, selections) ? rule.then : rule.else;
    for (const action of branch ?? []) {
      if (!action || !isNonEmptyString(action.targetOptionGroup)) continue;
      actions.push({ ruleId: rule.id, action });
    }
  }

  return actions;
}

function applyVisibilityActions(
  state: RuleState,
  actions: Array<{ ruleId: string; action: ProductOptionRuleAction }>,
  appliedActions: ProductOptionRuleAppliedAction[]
): void {
  for (const { ruleId, action } of actions) {
    if (action.action !== "show" && action.action !== "hide") continue;
    state.optionGroups.add(action.targetOptionGroup);
    const wasVisible = state.visible.has(action.targetOptionGroup);
    if (action.action === "show") state.visible.add(action.targetOptionGroup);
    if (action.action === "hide") state.visible.delete(action.targetOptionGroup);
    if (wasVisible !== state.visible.has(action.targetOptionGroup)) {
      appliedActions.push({ ...action, ruleId, phase: "visibility" });
    }
  }
}

function applyEnablementActions(
  state: RuleState,
  actions: Array<{ ruleId: string; action: ProductOptionRuleAction }>,
  appliedActions: ProductOptionRuleAppliedAction[]
): void {
  for (const { ruleId, action } of actions) {
    if (action.action !== "enable" && action.action !== "disable") continue;
    state.optionGroups.add(action.targetOptionGroup);
    const wasDisabled = state.disabled.has(action.targetOptionGroup);
    if (action.action === "enable") state.disabled.delete(action.targetOptionGroup);
    if (action.action === "disable") state.disabled.add(action.targetOptionGroup);
    if (wasDisabled !== state.disabled.has(action.targetOptionGroup)) {
      appliedActions.push({ ...action, ruleId, phase: "enablement" });
    }
  }
}

function clearSelection(
  state: RuleState,
  optionGroup: string,
  messages: ProductOptionRuleMessage[],
  cleared: Set<string>
): void {
  if (!Object.prototype.hasOwnProperty.call(state.selections, optionGroup)) return;
  delete state.selections[optionGroup];
  cleared.add(optionGroup);
  messages.push({
    optionGroup,
    code: "OPTION_RULE_CLEARED",
    message: `${optionGroup} was cleared because it is no longer valid for the current selections.`,
  });
}

function applyClearingActions(
  state: RuleState,
  actions: Array<{ ruleId: string; action: ProductOptionRuleAction }>,
  appliedActions: ProductOptionRuleAppliedAction[],
  messages: ProductOptionRuleMessage[],
  cleared: Set<string>
): void {
  for (const optionGroup of Object.keys(state.selections)) {
    if (!state.visible.has(optionGroup) || state.disabled.has(optionGroup)) {
      clearSelection(state, optionGroup, messages, cleared);
    }
  }

  for (const { ruleId, action } of actions) {
    if (action.action !== "clear") continue;
    const hadSelection = Object.prototype.hasOwnProperty.call(state.selections, action.targetOptionGroup);
    clearSelection(state, action.targetOptionGroup, messages, cleared);
    if (hadSelection) appliedActions.push({ ...action, ruleId, phase: "clearing" });
  }
}

function applyDefaultActions(
  state: RuleState,
  actions: Array<{ ruleId: string; action: ProductOptionRuleAction }>,
  appliedActions: ProductOptionRuleAppliedAction[],
  messages: ProductOptionRuleMessage[],
  defaulted: Set<string>
): void {
  for (const { ruleId, action } of actions) {
    if (action.action !== "set_default") continue;
    const optionGroup = action.targetOptionGroup;
    state.optionGroups.add(optionGroup);

    if (!state.visible.has(optionGroup) || state.disabled.has(optionGroup)) continue;
    if (isSelectionPresent(state.selections[optionGroup])) continue;
    if (!isSelectionPresent(action.value)) continue;

    state.selections[optionGroup] = action.value;
    defaulted.add(optionGroup);
    messages.push({
      optionGroup,
      code: "OPTION_RULE_DEFAULTED",
      message: `${optionGroup} was set to its default value for the current selections.`,
    });
    appliedActions.push({ ...action, ruleId, phase: "defaults" });
  }
}

function applyRequiredActions(
  state: RuleState,
  actions: Array<{ ruleId: string; action: ProductOptionRuleAction }>,
  appliedActions: ProductOptionRuleAppliedAction[]
): void {
  for (const { ruleId, action } of actions) {
    if (action.action !== "require" && action.action !== "optional") continue;
    state.optionGroups.add(action.targetOptionGroup);
    const wasRequired = state.required.has(action.targetOptionGroup);
    if (action.action === "require") state.required.add(action.targetOptionGroup);
    if (action.action === "optional") state.required.delete(action.targetOptionGroup);
    if (wasRequired !== state.required.has(action.targetOptionGroup)) {
      appliedActions.push({ ...action, ruleId, phase: "validation" });
    }
  }
}

function stateSignature(state: RuleState): string {
  return JSON.stringify({
    selections: Object.keys(state.selections).sort().map((key) => [key, state.selections[key]]),
    visible: uniqueSorted(state.visible),
    disabled: uniqueSorted(state.disabled),
    required: uniqueSorted(state.required),
  });
}

export function evaluateProductOptionRules(input: EvaluateProductOptionRulesInput): ProductOptionRuleEvaluationResult {
  const state = buildInitialState(input);
  const messages: ProductOptionRuleMessage[] = [];
  const appliedActions: ProductOptionRuleAppliedAction[] = [];
  const cleared = new Set<string>();
  const defaulted = new Set<string>();
  const maxPasses = Math.max(Number.isInteger(input.maxPasses) ? Number(input.maxPasses) : 8, 1);

  let previousSignature = "";
  for (let pass = 0; pass < maxPasses; pass++) {
    const actions = selectedActionsForPass(input.rules, state.selections);

    applyVisibilityActions(state, actions, appliedActions);
    applyEnablementActions(state, actions, appliedActions);
    applyClearingActions(state, actions, appliedActions, messages, cleared);
    applyDefaultActions(state, actions, appliedActions, messages, defaulted);
    applyRequiredActions(state, actions, appliedActions);

    const nextSignature = stateSignature(state);
    if (nextSignature === previousSignature) break;
    previousSignature = nextSignature;
  }

  const errors: ProductOptionRuleMessage[] = [];
  for (const optionGroup of uniqueSorted(state.required)) {
    if (!state.visible.has(optionGroup) || state.disabled.has(optionGroup)) continue;
    if (isSelectionPresent(state.selections[optionGroup])) continue;
    errors.push({
      optionGroup,
      code: "OPTION_RULE_REQUIRED_MISSING",
      message: `${optionGroup} is required for the current selections.`,
    });
  }

  const visibleOptionGroups = uniqueSorted(state.visible);
  const disabledOptionGroups = uniqueSorted(state.disabled);
  const requiredOptionGroups = uniqueSorted(state.required).filter((optionGroup) => state.visible.has(optionGroup) && !state.disabled.has(optionGroup));

  return {
    effectiveSelections: { ...state.selections },
    visibleOptionGroups,
    hiddenOptionGroups: uniqueSorted(Array.from(state.optionGroups).filter((optionGroup) => !state.visible.has(optionGroup))),
    enabledOptionGroups: uniqueSorted(Array.from(state.optionGroups).filter((optionGroup) => !state.disabled.has(optionGroup))),
    disabledOptionGroups,
    requiredOptionGroups,
    optionalOptionGroups: uniqueSorted(Array.from(state.optionGroups).filter((optionGroup) => !state.required.has(optionGroup))),
    clearedOptionGroups: uniqueSorted(cleared),
    defaultedOptionGroups: uniqueSorted(defaulted),
    messages,
    errors,
    appliedActions,
    isValidForPricing: errors.length === 0,
  };
}
