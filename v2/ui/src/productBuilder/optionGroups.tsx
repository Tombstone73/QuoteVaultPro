import { ChevronDown, ChevronRight, GripVertical, Layers, ListOrdered, Plus, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import type { ProductDraftOption } from "../api";
import { builderControlClass, Cell, Chip, ReferenceButton, Toggle } from "./referencePrimitives";
import { ChoiceEditor, InputTypePicker } from "./optionChoice";

export const createNewProductDraftOption = (): ProductDraftOption => ({
  optionId: `new:${crypto.randomUUID()}`,
  label: "New option",
  inputType: "select",
  required: false,
  defaultValue: null,
  choices: [{ choiceValue: "choice", label: "Choice" }],
  canRemove: true,
});

export const appendNewProductDraftOption = (options: readonly ProductDraftOption[]): readonly ProductDraftOption[] => [
  ...options,
  createNewProductDraftOption(),
];

/**
 * The select's DOM value is the canonical PBV2 choice value, never its label.
 * Keeping the edit in this small handler makes the staged-options mutation
 * explicit and independently testable.
 */
export const applyDefaultChoice = (
  option: ProductDraftOption,
  choiceValue: string,
  onChange: (next: ProductDraftOption) => void,
) => onChange({ ...option, defaultValue: choiceValue || null });

/**
 * Direct presentation port of Lovable's option-groups.tsx. V2 persists a
 * flat, ordered option collection, not independent groups. The left master
 * list and right editor are retained as the approved composition; synthetic
 * group metadata and mock-template actions are intentionally omitted.
 */
export function OptionGroupsSection({
  options,
  disabled,
  onChange,
  onJumpToRules,
}: Readonly<{
  options: readonly ProductDraftOption[];
  disabled?: boolean;
  onChange: (next: readonly ProductDraftOption[]) => void;
  onJumpToRules?: () => void;
}>) {
  const [selected, setSelected] = useState(options[0]?.optionId ?? "");
  const [drag, setDrag] = useState<string | null>(null);
  const option = useMemo(
    () => options.find((entry) => entry.optionId === selected) ?? options[0],
    [options, selected],
  );
  const optionIndex = options.findIndex((entry) => entry.optionId === option?.optionId);
  const groupPersistenceUnavailable = "V2 currently persists a flat, ordered option collection. Group metadata and templates have no canonical V2 contract.";

  useEffect(() => {
    if (option && option.optionId !== selected && !options.some((entry) => entry.optionId === selected)) {
      setSelected(option.optionId);
    }
  }, [option, options, selected]);

  const updateOption = (index: number, next: ProductDraftOption) => {
    onChange(options.map((entry, position) => (position === index ? next : entry)));
  };

  const addOption = () => {
    const next = appendNewProductDraftOption(options);
    const added = next.at(-1)!;
    onChange(next);
    setSelected(added.optionId);
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = options.findIndex((entry) => entry.optionId === fromId);
    const to = options.findIndex((entry) => entry.optionId === toId);
    if (from < 0 || to < 0) return;
    const next = [...options];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[264px_minmax(0,1fr)]">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3.5" />
          Option groups
          <span className="num ml-auto rounded border border-border px-1.5 text-[0.6875rem] text-foreground">
            {options.length}
          </span>
        </div>
        <ReferenceButton size="sm" className="w-full gap-1.5" disabled={disabled} onClick={addOption}>
          <Plus className="size-4" />
          Add option group
        </ReferenceButton>
        <ReferenceButton variant="outline" size="sm" className="w-full gap-1.5" disabled title={groupPersistenceUnavailable}>
          <ListOrdered className="size-4" />
          Import template
        </ReferenceButton>
        <p className="text-[0.6875rem] text-muted-foreground">{groupPersistenceUnavailable}</p>
        <ul className="space-y-1.5">
          {options.map((entry) => (
            <li
              key={entry.optionId}
              draggable={!disabled}
              onDragStart={() => setDrag(entry.optionId)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (drag) reorder(drag, entry.optionId);
                setDrag(null);
              }}
            >
              <button
                type="button"
                onClick={() => setSelected(entry.optionId)}
                className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                  entry.optionId === option?.optionId
                    ? "border-primary/60 bg-primary/10"
                    : "border-border hover:bg-accent/60"
                }`}
              >
                <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold">
                    {entry.label || "Untitled option"}
                  </span>
                  <span className="num block text-[0.6875rem] text-muted-foreground">
                    {entry.choices.length} choice{entry.choices.length === 1 ? "" : "s"}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {entry.required && <Chip tone="late">Required</Chip>}
                    <Chip>{entry.inputType}</Chip>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="text-[0.6875rem] text-muted-foreground">
          Drag options to reorder — order follows through to quoting and the storefront.
        </p>
      </div>
      {option ? (
        <OptionEditor
          key={option.optionId}
          option={option}
          disabled={disabled}
          onJumpToRules={onJumpToRules}
          onChange={(next) => updateOption(optionIndex, next)}
          onDelete={() => {
            onChange(options.filter((_, index) => index !== optionIndex));
            setSelected(options.find((_, index) => index !== optionIndex)?.optionId ?? "");
          }}
        />
      ) : (
        <div className="grid place-items-center rounded-md border border-dashed border-border p-10 text-[0.8125rem] text-muted-foreground">
          Add an option group to start configuring choices.
        </div>
      )}
    </div>
  );
}

function OptionEditor({
  option,
  disabled,
  onChange,
  onDelete,
  onJumpToRules,
}: Readonly<{
  option: ProductDraftOption;
  disabled?: boolean;
  onChange: (next: ProductDraftOption) => void;
  onDelete: () => void;
  onJumpToRules?: () => void;
}>) {
  const [open, setOpen] = useState(true);
  const isChoice = option.inputType === "select" || option.inputType === "multiselect";
  const hasChoices = isChoice && option.choices.length > 0;
  const defaultChoices = Array.isArray(option.defaultValue) ? option.defaultValue : [];

  const setDefaultChoice = (choiceValue: string) => {
    applyDefaultChoice(option, choiceValue, onChange);
  };

  const setDefaultChoices = (choiceValue: string, selected: boolean) => {
    const next = selected
      ? [...new Set([...defaultChoices, choiceValue])]
      : defaultChoices.filter((value) => value !== choiceValue);
    onChange({ ...option, defaultValue: next.length ? next : null });
  };

  return (
    <div className={`min-w-0 space-y-3 rounded-md border border-border p-3 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Cell label="Option label" className="min-w-[200px] flex-1">
          <input
            className="h-8 text-[0.8125rem]"
            value={option.label}
            disabled={disabled}
            onChange={(event) => onChange({ ...option, label: event.target.value })}
          />
        </Cell>
        <ReferenceButton
          variant="ghost"
          size="sm"
          className="mt-6 gap-1.5 text-muted-foreground hover:text-late"
          disabled={disabled || !option.canRemove}
          title={option.removalReason}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          Delete option
        </ReferenceButton>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle
          label="Required field"
          hint="A selection must be made before pricing resolves."
          checked={option.required}
          disabled={disabled}
          onChange={(required) => onChange({ ...option, required })}
        />
        <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
          <Cell label="Input type" hint="The canonical V2 option input contract.">
            <InputTypePicker
              value={option.inputType}
              disabled={disabled}
              onChange={(inputType) => onChange({ ...option, inputType})}
            />
          </Cell>
        </div>
      </div>
      {hasChoices && <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
        {option.inputType === "select" ? <Cell label="Default choice" hint="Used when a line does not select a value.">
          <select
            aria-label="Default choice"
            className={`${builderControlClass} h-8 w-full text-[0.8125rem]`}
            value={typeof option.defaultValue === "string" ? option.defaultValue : ""}
            disabled={disabled}
            onChange={(event) => setDefaultChoice(event.target.value)}
          >
            <option value="">No default</option>
            {option.choices.map((choice) => <option key={choice.choiceValue} value={choice.choiceValue}>{choice.label}</option>)}
          </select>
        </Cell> : <Cell label="Default choices" hint="Used when a line does not select values.">
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-1">
            {option.choices.map((choice) => <label key={choice.choiceValue} className="inline-flex items-center gap-1.5 text-[0.8125rem]">
              <input
                type="checkbox"
                checked={defaultChoices.includes(choice.choiceValue)}
                disabled={disabled}
                onChange={(event) => setDefaultChoices(choice.choiceValue, event.target.checked)}
              />
              {choice.label}
            </label>)}
          </div>
        </Cell>}
      </div>}
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-muted-foreground">Choices</div>
        <div className="flex items-center gap-2">
          {onJumpToRules && <button type="button" className="text-[0.75rem] text-muted-foreground hover:text-foreground" onClick={onJumpToRules}>View conditions</button>}
          <ReferenceButton
            variant="outline"
            size="compact"
            className="gap-1"
            disabled={disabled || !isChoice}
            title={isChoice ? undefined : "This input type does not use choices."}
            onClick={() => onChange({ ...option, choices: [...option.choices, { choiceValue: `choice_${option.choices.length + 1}`, label: "New choice" }] })}
          >
            <Plus className="size-3.5" />
            Add choice
          </ReferenceButton>
        </div>
      </div>
      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-muted-foreground hover:text-foreground" aria-label={open ? "Collapse choices" : "Expand choices"}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <span className="text-[0.8125rem] font-semibold">Configured choices</span>
          <span className="num text-[0.6875rem] text-muted-foreground">{option.choices.length} choice{option.choices.length === 1 ? "" : "s"}</span>
        </div>
        {open && <div className="space-y-2 border-t border-border p-3">
          {!isChoice && <p className="text-[0.75rem] italic text-muted-foreground">This input type does not use choices.</p>}
          {isChoice && option.choices.length === 0 && <p className="text-[0.75rem] italic text-muted-foreground">No choices yet — this option will be skipped at quote time.</p>}
          {isChoice && option.choices.map((choice, choiceIndex) => <ChoiceEditor
            key={`${choice.choiceValue}-${choiceIndex}`}
            choice={choice}
            disabled={disabled}
            onChange={(next) => onChange({ ...option, choices: option.choices.map((entry, index) => index === choiceIndex ? next : entry) })}
            onRemove={() => onChange({ ...option, choices: option.choices.filter((_, index) => index !== choiceIndex) })}
          />)}
        </div>}
      </div>
    </div>
  );
}
