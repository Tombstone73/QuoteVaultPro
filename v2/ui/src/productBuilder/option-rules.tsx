import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";
import type {
  ProductOptionRule,
  ProductOptionRuleAction,
  ProductOptionRuleActionType,
  ProductOptionRuleCondition,
  ProductOptionRuleConditionOperator,
} from "../../../../shared/productOptionRules";
import type { ProductDraftOption } from "../api";
import { Cell, Chip, ReferenceButton, Toggle } from "./referencePrimitives";

type RuleOption = Readonly<{
  selectionKey: string;
  label: string;
  choices: readonly Readonly<{ choiceValue: string; label: string }>[];
}>;

const operators: readonly ProductOptionRuleConditionOperator[] = [
  "equals", "not_equals", "in", "not_in", "exists", "not_exists",
];
const actions: readonly ProductOptionRuleActionType[] = [
  "show", "hide", "enable", "disable", "require", "optional", "clear", "set_default",
];
const needsValue = (operator: ProductOptionRuleConditionOperator) => operator !== "exists" && operator !== "not_exists";
const defaultAction = (targetOptionGroup: string): ProductOptionRuleAction => ({ action: "show", targetOptionGroup });

export const optionRuleOptions = (
  options: readonly ProductDraftOption[],
): readonly RuleOption[] => options.map((option) => ({
  selectionKey: option.selectionKey ?? option.optionId,
  label: option.label || "Untitled option",
  choices: option.choices,
}));

export const createProductDraftOptionRule = (
  options: readonly ProductDraftOption[],
): ProductOptionRule => {
  const first = optionRuleOptions(options)[0];
  return {
    id: `rule_${crypto.randomUUID().replace(/-/gu, "")}`,
    enabled: true,
    when: { all: first ? [{ optionGroup: first.selectionKey, operator: "equals", value: first.choices[0]?.choiceValue ?? "" }] : [] },
    then: first ? [defaultAction(first.selectionKey)] : [],
    else: [],
  };
};

/**
 * ProductVersion-owned conditional Option rules.  The editor stores stable
 * selection keys and choice values; it never derives persistent references
 * from labels.  The server's Draft command remains the rule validator.
 */
export function OptionRulesSection({
  options,
  rules,
  disabled,
  onChange,
}: Readonly<{
  options: readonly ProductDraftOption[];
  rules: readonly ProductOptionRule[];
  disabled?: boolean;
  onChange: (rules: readonly ProductOptionRule[]) => void;
}>) {
  const references = useMemo(() => optionRuleOptions(options), [options]);
  return <div className="mt-4 rounded-md border border-border bg-surface-2/40 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-[0.75rem] font-bold uppercase tracking-wide">Conditional options</h3>
        <p className="mt-1 max-w-2xl text-[0.75rem] text-muted-foreground">
          Rules control which Options are available, required, cleared, or defaulted for a configuration. Matrix dimensions and Option pricing impacts remain separate.
        </p>
      </div>
      <ReferenceButton size="sm" className="gap-1.5" disabled={disabled || !references.length} onClick={() => onChange([...rules, createProductDraftOptionRule(options)])}>
        <Plus className="size-3.5" /> Add rule
      </ReferenceButton>
    </div>
    {!references.length && <p className="mt-3 text-[0.75rem] text-muted-foreground">Add an Option with a stable choice before authoring a conditional rule.</p>}
    {references.length > 0 && rules.length === 0 && <p className="mt-3 rounded border border-dashed border-border p-3 text-[0.75rem] text-muted-foreground">No conditional Option rules. Simple static required/default settings remain available above.</p>}
    <div className="mt-3 space-y-3">
      {rules.map((rule, index) => <RuleEditor key={rule.id} rule={rule} index={index} references={references} disabled={disabled} onChange={(next) => onChange(rules.map((entry, position) => position === index ? next : entry))} onRemove={() => onChange(rules.filter((_, position) => position !== index))} />)}
    </div>
  </div>;
}

function RuleEditor({ rule, index, references, disabled, onChange, onRemove }: Readonly<{
  rule: ProductOptionRule;
  index: number;
  references: readonly RuleOption[];
  disabled?: boolean;
  onChange: (rule: ProductOptionRule) => void;
  onRemove: () => void;
}>) {
  const [open, setOpen] = useState(true);
  const mode: "all" | "any" = Array.isArray(rule.when.all) ? "all" : "any";
  const conditions: readonly ProductOptionRuleCondition[] = mode === "all" ? rule.when.all ?? [] : rule.when.any ?? [];
  const setConditions = (next: readonly ProductOptionRuleCondition[], nextMode = mode) => onChange({ ...rule, when: nextMode === "all" ? { all: [...next] } : { any: [...next] } });
  const addCondition = () => {
    const target = references[0]!;
    setConditions([...conditions, { optionGroup: target.selectionKey, operator: "equals", value: target.choices[0]?.choiceValue ?? "" }]);
  };
  return <div className="rounded-md border border-border bg-background">
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <button type="button" aria-label={open ? "Collapse conditional rule" : "Expand conditional rule"} onClick={() => setOpen((value) => !value)} className="text-muted-foreground hover:text-foreground">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
      <span className="text-[0.8125rem] font-semibold">Rule {index + 1}</span>
      <Chip tone={rule.enabled === false ? "neutral" : "accent"}>{rule.enabled === false ? "Disabled" : "Enabled"}</Chip>
      <span className="flex-1" />
      <Toggle label="Enabled" checked={rule.enabled !== false} disabled={disabled} onChange={(enabled) => onChange({ ...rule, enabled })} />
      <ReferenceButton variant="ghost" size="compactIcon" className="text-muted-foreground hover:text-late" disabled={disabled} onClick={onRemove} aria-label="Delete conditional rule"><Trash2 className="size-3.5" /></ReferenceButton>
    </div>
    {open && <div className="space-y-3 border-t border-border p-3">
      <Cell label="Rule label" hint="Optional authoring label; stable rule ID is retained separately.">
        <input className="h-8 text-[0.8125rem]" value={rule.label ?? ""} disabled={disabled} placeholder="e.g. Pole pockets reveal child fields" onChange={(event) => onChange({ ...rule, label: event.target.value || undefined })} />
      </Cell>
      <div className="rounded border border-border p-2.5">
        <div className="flex flex-wrap items-center gap-2"><span className="text-[0.75rem] font-bold uppercase tracking-wide">When</span><select aria-label="Condition mode" disabled={disabled} value={mode} onChange={(event) => setConditions(conditions, event.target.value as "all" | "any")}><option value="all">All conditions match</option><option value="any">Any condition matches</option></select><ReferenceButton variant="outline" size="compact" className="ml-auto" disabled={disabled} onClick={addCondition}><Plus className="size-3.5" />Condition</ReferenceButton></div>
        <div className="mt-2 space-y-2">{conditions.map((condition, conditionIndex) => <ConditionRow key={`${condition.optionGroup}:${conditionIndex}`} condition={condition} references={references} disabled={disabled} onChange={(next) => setConditions(conditions.map((entry, position) => position === conditionIndex ? next : entry))} onRemove={() => setConditions(conditions.filter((_, position) => position !== conditionIndex))} />)}</div>
      </div>
      <ActionBranch title="Then" actions={rule.then} references={references} disabled={disabled} onChange={(then) => onChange({ ...rule, then: [...then] })} />
      <ActionBranch title="Otherwise" actions={rule.else ?? []} references={references} disabled={disabled} onChange={(otherwise) => onChange({ ...rule, else: otherwise.length ? [...otherwise] : [] })} />
    </div>}
  </div>;
}

function ConditionRow({ condition, references, disabled, onChange, onRemove }: Readonly<{
  condition: ProductOptionRuleCondition;
  references: readonly RuleOption[];
  disabled?: boolean;
  onChange: (condition: ProductOptionRuleCondition) => void;
  onRemove: () => void;
}>) {
  const source = references.find((entry) => entry.selectionKey === condition.optionGroup) ?? references[0]!;
  const operator = condition.operator;
  const updateSource = (optionGroup: string) => {
    const next = references.find((entry) => entry.selectionKey === optionGroup)!;
    onChange({ optionGroup, operator, ...(needsValue(operator) ? { value: next.choices[0]?.choiceValue ?? "" } : {}) });
  };
  return <div className="grid gap-2 rounded border border-border bg-surface-2/70 p-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto]">
    <select aria-label="Rule condition option" disabled={disabled} value={condition.optionGroup} onChange={(event) => updateSource(event.target.value)}>{references.map((entry) => <option key={entry.selectionKey} value={entry.selectionKey}>{entry.label}</option>)}</select>
    <select aria-label="Rule operator" disabled={disabled} value={operator} onChange={(event) => onChange({ ...condition, operator: event.target.value as ProductOptionRuleConditionOperator, ...(needsValue(event.target.value as ProductOptionRuleConditionOperator) ? {} : { value: undefined }) })}>{operators.map((entry) => <option key={entry} value={entry}>{entry.replace(/_/gu, " ")}</option>)}</select>
    {needsValue(operator) ? <ChoiceValue value={condition.value} source={source} disabled={disabled} onChange={(value) => onChange({ ...condition, value })} /> : <span className="self-center text-[0.75rem] text-muted-foreground">No value required</span>}
    <ReferenceButton variant="ghost" size="compactIcon" disabled={disabled} onClick={onRemove} aria-label="Delete rule condition"><Trash2 className="size-3.5" /></ReferenceButton>
  </div>;
}

function ActionBranch({ title, actions: branch, references, disabled, onChange }: Readonly<{
  title: string;
  actions: readonly ProductOptionRuleAction[];
  references: readonly RuleOption[];
  disabled?: boolean;
  onChange: (actions: readonly ProductOptionRuleAction[]) => void;
}>) {
  const append = () => onChange([...branch, defaultAction(references[0]!.selectionKey)]);
  return <div className="rounded border border-border p-2.5"><div className="flex items-center gap-2"><span className="text-[0.75rem] font-bold uppercase tracking-wide">{title}</span><ReferenceButton variant="outline" size="compact" className="ml-auto" disabled={disabled} onClick={append}><Plus className="size-3.5" />Action</ReferenceButton></div>{branch.length === 0 && <p className="mt-2 text-[0.75rem] text-muted-foreground">No actions.</p>}<div className="mt-2 space-y-2">{branch.map((action, index) => <ActionRow key={`${action.targetOptionGroup}:${index}`} action={action} references={references} disabled={disabled} onChange={(next) => onChange(branch.map((entry, position) => position === index ? next : entry))} onRemove={() => onChange(branch.filter((_, position) => position !== index))} />)}</div></div>;
}

function ActionRow({ action, references, disabled, onChange, onRemove }: Readonly<{
  action: ProductOptionRuleAction;
  references: readonly RuleOption[];
  disabled?: boolean;
  onChange: (action: ProductOptionRuleAction) => void;
  onRemove: () => void;
}>) {
  const target = references.find((entry) => entry.selectionKey === action.targetOptionGroup) ?? references[0]!;
  return <div className="grid gap-2 rounded border border-border bg-surface-2/70 p-2 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_auto]">
    <select aria-label="Rule action" disabled={disabled} value={action.action} onChange={(event) => onChange({ ...action, action: event.target.value as ProductOptionRuleActionType, ...(event.target.value === "set_default" ? { value: target.choices[0]?.choiceValue ?? "" } : { value: undefined }) })}>{actions.map((entry) => <option key={entry} value={entry}>{entry.replace(/_/gu, " ")}</option>)}</select>
    <select aria-label="Rule action target" disabled={disabled} value={action.targetOptionGroup} onChange={(event) => { const next = references.find((entry) => entry.selectionKey === event.target.value)!; onChange({ ...action, targetOptionGroup: next.selectionKey, ...(action.action === "set_default" ? { value: next.choices[0]?.choiceValue ?? "" } : {}) }); }}>{references.map((entry) => <option key={entry.selectionKey} value={entry.selectionKey}>{entry.label}</option>)}</select>
    {action.action === "set_default" ? <ChoiceValue value={action.value} source={target} disabled={disabled} onChange={(value) => onChange({ ...action, value })} /> : <span className="self-center text-[0.75rem] text-muted-foreground">{action.action === "clear" ? "Clears the current selection" : "Applies when this branch matches"}</span>}
    <ReferenceButton variant="ghost" size="compactIcon" disabled={disabled} onClick={onRemove} aria-label="Delete rule action"><Trash2 className="size-3.5" /></ReferenceButton>
  </div>;
}

function ChoiceValue({ value, source, disabled, onChange }: Readonly<{ value: unknown; source: RuleOption; disabled?: boolean; onChange: (value: string) => void }>) {
  return source.choices.length ? <select aria-label="Rule value" disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Select choice</option>{source.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}</select> : <input aria-label="Rule value" className="h-8 text-[0.8125rem]" disabled={disabled} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}
