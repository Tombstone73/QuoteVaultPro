import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import React, { useState } from "react";
import type { ProductDraftOption } from "../api";
import { Cell, Chip, Picker, ReferenceButton } from "./referencePrimitives";

/**
 * Direct presentation port of Lovable's option-choice.tsx. Pricing impacts,
 * material requirements, and workflow metadata remain in their V2 owners;
 * only canonical Draft option-choice fields are editable here.
 */
export function ChoiceEditor({
  choice,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: Readonly<{
  choice: ProductDraftOption["choices"][number];
  disabled?: boolean;
  onChange: (next: ProductDraftOption["choices"][number]) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}>) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-border bg-surface-2/50">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse choice" : "Expand choice"}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <input
          className="h-7 max-w-[220px] border-transparent bg-transparent text-[0.8125rem] font-medium hover:border-border focus:border-border"
          value={choice.label}
          disabled={disabled}
          onChange={(event) => onChange({ ...choice, label: event.target.value })}
        />
        <Chip>{choice.choiceValue}</Chip>
        <span className="flex-1" />
        <ReferenceButton
          type="button"
          variant="ghost"
          size="compactIcon"
          className="text-muted-foreground"
          disabled={disabled || !onMoveUp}
          onClick={onMoveUp}
          aria-label={`Move ${choice.label || "choice"} up`}
          title="Move choice up"
        >
          <ArrowUp className="size-3" />
        </ReferenceButton>
        <ReferenceButton
          type="button"
          variant="ghost"
          size="compactIcon"
          className="text-muted-foreground"
          disabled={disabled || !onMoveDown}
          onClick={onMoveDown}
          aria-label={`Move ${choice.label || "choice"} down`}
          title="Move choice down"
        >
          <ArrowDown className="size-3" />
        </ReferenceButton>
        <ReferenceButton
          type="button"
          variant="ghost"
          size="compactIcon"
          className="text-muted-foreground hover:text-late"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Delete choice"
        >
          <Trash2 className="size-3.5" />
        </ReferenceButton>
      </div>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 @container">
          <div className="grid gap-3 @[520px]:grid-cols-2">
            <Cell label="Label">
              <input
                className="h-8 text-[0.8125rem]"
                value={choice.label}
                disabled={disabled}
                onChange={(event) => onChange({ ...choice, label: event.target.value })}
              />
            </Cell>
            <Cell label="Value" hint="Stable key stored on the Order Line.">
              <input
                className="num h-8 text-[0.8125rem]"
                value={choice.choiceValue}
                disabled={disabled}
                onChange={(event) => onChange({ ...choice, choiceValue: event.target.value })}
              />
            </Cell>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="text-[0.75rem] font-semibold">Canonical ownership</div>
            <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
              Use stable choice identity here. Pricing impacts are edited in Pricing; material requirements
              are edited in Materials &amp; recipe.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export const V2_INPUT_TYPES: readonly ProductDraftOption["inputType"][] = [
  "select",
  "multiselect",
  "boolean",
  "number",
  "text",
  "textarea",
];

export function InputTypePicker({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: ProductDraftOption["inputType"];
  disabled?: boolean;
  onChange: (value: ProductDraftOption["inputType"]) => void;
}>) {
  return <Picker value={value} disabled={disabled} onChange={onChange} items={V2_INPUT_TYPES} />;
}
