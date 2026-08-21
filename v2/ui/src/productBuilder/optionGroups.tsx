import { ChevronDown, ChevronRight, GripVertical, Layers, Plus, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import type { ProductDraftOption } from "../api";
import { Cell, Chip, Toggle } from "./referencePrimitives";
import { ChoiceEditor, InputTypePicker } from "./optionChoice";

const createOption = (): ProductDraftOption => ({
  optionId: crypto.randomUUID(),
  label: "New option",
  inputType: "select",
  required: false,
  defaultValue: null,
  choices: [{ choiceValue: "choice", label: "Choice" }],
  canRemove: true,
});

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

  useEffect(() => {
    if (option && option.optionId !== selected && !options.some((entry) => entry.optionId === selected)) {
      setSelected(option.optionId);
    }
  }, [option, options, selected]);

  const updateOption = (index: number, next: ProductDraftOption) => {
    onChange(options.map((entry, position) => (position === index ? next : entry)));
  };

  const addOption = () => {
    const next = createOption();
    onChange([...options, next]);
    setSelected(next.optionId);
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
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3.5" />
          Option groups
          <span className="num ml-auto rounded border border-border px-1.5 text-[11px] text-foreground">
            {options.length}
          </span>
        </div>
        <button type="button" className="button h-8 w-full gap-1.5" disabled={disabled} onClick={addOption}>
          <Plus className="size-4" />
          Add option group
        </button>
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
                  <span className="block truncate text-[13px] font-semibold">
                    {entry.label || "Untitled option"}
                  </span>
                  <span className="num block text-[11px] text-muted-foreground">
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
        <p className="text-[11px] text-muted-foreground">
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
        <div className="grid place-items-center rounded-md border border-dashed border-border p-10 text-[13px] text-muted-foreground">
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

  return (
    <div className={`min-w-0 space-y-3 rounded-md border border-border p-3 ${disabled ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Cell label="Option label" className="min-w-[200px] flex-1">
          <input
            className="h-8 text-[13px]"
            value={option.label}
            disabled={disabled}
            onChange={(event) => onChange({ ...option, label: event.target.value })}
          />
        </Cell>
        <button
          type="button"
          className="mt-6 flex h-8 items-center gap-1.5 text-[12px] text-muted-foreground hover:text-late disabled:cursor-not-allowed"
          disabled={disabled || !option.canRemove}
          title={option.removalReason}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
          Delete option
        </button>
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
      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Choices</div>
        <div className="flex items-center gap-2">
          {onJumpToRules && <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground" onClick={onJumpToRules}>View conditions</button>}
          <button
            type="button"
            className="button secondary h-7 gap-1 text-[12px]"
            disabled={disabled || !isChoice}
            title={isChoice ? undefined : "This input type does not use choices."}
            onClick={() => onChange({ ...option, choices: [...option.choices, { choiceValue: `choice_${option.choices.length + 1}`, label: "New choice" }] })}
          >
            <Plus className="size-3.5" />
            Add choice
          </button>
        </div>
      </div>
      <div className="rounded-md border border-border">
        <div className="flex flex-wrap items-center gap-2 px-2 py-2">
          <button type="button" onClick={() => setOpen((value) => !value)} className="text-muted-foreground hover:text-foreground" aria-label={open ? "Collapse choices" : "Expand choices"}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
          <span className="text-[13px] font-semibold">Configured choices</span>
          <span className="num text-[11px] text-muted-foreground">{option.choices.length} choice{option.choices.length === 1 ? "" : "s"}</span>
        </div>
        {open && <div className="space-y-2 border-t border-border p-3">
          {!isChoice && <p className="text-[12px] italic text-muted-foreground">This input type does not use choices.</p>}
          {isChoice && option.choices.length === 0 && <p className="text-[12px] italic text-muted-foreground">No choices yet — this option will be skipped at quote time.</p>}
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
