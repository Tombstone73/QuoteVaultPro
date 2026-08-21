import { ChevronDown, ChevronRight, GripVertical, Layers, Plus, Trash2 } from "lucide-react";
import React, { useMemo, useState } from "react";
import type { ProductDraftOption } from "../api";
import { Cell, Chip, Toggle } from "./referencePrimitives";
import { ChoiceEditor, InputTypePicker } from "./optionChoice";

const clone = <T,>(value: T): T => structuredClone(value);
const newOption = (): ProductDraftOption => ({ optionId: crypto.randomUUID(), label: "New option", inputType: "select", required: false, defaultValue: null, choices: [{ choiceValue: "choice", label: "Choice" }], canRemove: true });

/**
 * Direct composition port of Lovable's option-groups.tsx, adapted to V2's
 * authoritative flat ProductDraftOption collection. A synthetic visual group
 * avoids inventing a group persistence model that V2 does not own.
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
  const [selected, setSelected] = useState<string | null>(() => options[0]?.optionId ?? null);
  const [dragged, setDragged] = useState<string | null>(null);
  const option = useMemo(() => options.find((entry) => entry.optionId === selected) ?? options[0], [options, selected]);
  const optionIndex = option ? options.findIndex((entry) => entry.optionId === option.optionId) : -1;
  const updateOption = (index: number, next: ProductDraftOption) => onChange(options.map((entry, position) => position === index ? next : entry));
  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const source = options.findIndex((entry) => entry.optionId === fromId);
    const target = options.findIndex((entry) => entry.optionId === toId);
    if (source < 0 || target < 0) return;
    const next = [...options];
    const [moved] = next.splice(source, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  };
  return <div className="grid gap-3 lg:grid-cols-[264px_minmax(0,1fr)]">
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground"><Layers className="size-3.5" />Option groups<span className="num ml-auto rounded border border-border px-1.5 text-[11px] text-foreground">{options.length}</span></div>
      <button type="button" className="button h-8 w-full gap-1.5" disabled={disabled} onClick={() => { const next = newOption(); onChange([...options, next]); setSelected(next.optionId); }}><Plus className="size-4" />Add option group</button>
      <p className="rounded-md border border-border bg-surface-2/50 p-2 text-[11px] text-muted-foreground">V2 stores a canonical ordered option collection. This visual group preserves the approved editor composition without introducing a second group model.</p>
      <ul className="space-y-1.5">{options.map((entry) => <li key={entry.optionId} draggable={!disabled} onDragStart={() => setDragged(entry.optionId)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragged) reorder(dragged, entry.optionId); setDragged(null); }}><button type="button" onClick={() => setSelected(entry.optionId)} className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${entry.optionId === option?.optionId ? "border-primary/60 bg-primary/10" : "border-border hover:bg-accent/60"}`}><GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{entry.label || "Untitled option"}</span><span className="num block text-[11px] text-muted-foreground">{entry.choices.length} choice{entry.choices.length === 1 ? "" : "s"}</span><span className="mt-1 flex flex-wrap gap-1">{entry.required && <Chip tone="late">Required</Chip>}<Chip>{entry.inputType}</Chip></span></span></button></li>)}</ul>
      <p className="text-[11px] text-muted-foreground">Drag options to reorder — order follows through to quoting and the storefront.</p>
    </div>
    {option ? <OptionEditor option={option} disabled={disabled} onJumpToRules={onJumpToRules} onChange={(next) => updateOption(optionIndex, next)} onDelete={() => { onChange(options.filter((_, index) => index !== optionIndex)); setSelected(options.find((_, index) => index !== optionIndex)?.optionId ?? null); }} /> : <div className="grid place-items-center rounded-md border border-dashed border-border p-10 text-[13px] text-muted-foreground">Add an option to start configuring choices.</div>}
  </div>;
}

function OptionEditor({ option, disabled, onChange, onDelete, onJumpToRules }: Readonly<{ option: ProductDraftOption; disabled?: boolean; onChange: (next: ProductDraftOption) => void; onDelete: () => void; onJumpToRules?: () => void }>) {
  const [open, setOpen] = useState(true);
  const choicesAllowed = option.inputType === "select" || option.inputType === "multiselect";
  return <div className={`rounded-md border border-border ${disabled ? "opacity-60" : ""}`}>
    <div className="flex flex-wrap items-center gap-2 px-2 py-2"><button type="button" onClick={() => setOpen((value) => !value)} className="text-muted-foreground hover:text-foreground" aria-label={open ? "Collapse option" : "Expand option"}>{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button><span className="text-[13px] font-semibold">{option.label || "Untitled option"}</span><Chip>{option.inputType}</Chip>{option.required && <Chip tone="late">Required</Chip>}<span className="num text-[11px] text-muted-foreground">{option.choices.length} choice{option.choices.length === 1 ? "" : "s"}</span><span className="flex-1" />{onJumpToRules && <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={onJumpToRules}>Conditions</button>}<button type="button" className="size-7 text-muted-foreground hover:text-late" disabled={disabled || !option.canRemove} title={option.removalReason} aria-label="Delete option" onClick={onDelete}><Trash2 className="size-3.5" /></button></div>
    {open && <div className="space-y-3 border-t border-border p-3 @container"><div className="grid gap-3 @[560px]:grid-cols-2"><Cell label="Option label"><input className="h-8 text-[13px]" value={option.label} disabled={disabled} onChange={(event) => onChange({ ...option, label: event.target.value })} /></Cell><Cell label="Input type"><InputTypePicker value={option.inputType} disabled={disabled} onChange={(inputType) => onChange({ ...option, inputType })} /></Cell></div><Toggle label="Required field" checked={option.required} disabled={disabled} onChange={(required) => onChange({ ...option, required })} />
      {choicesAllowed && <div className="space-y-2"><div className="flex items-center justify-between gap-2"><div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Choices</div><button type="button" className="button secondary h-7 gap-1 text-[12px]" disabled={disabled} onClick={() => onChange({ ...option, choices: [...option.choices, { choiceValue: `choice_${option.choices.length + 1}`, label: "New choice" }] })}><Plus className="size-3.5" />Add choice</button></div>{option.choices.length === 0 && <p className="text-[12px] italic text-muted-foreground">No choices yet — this option will be skipped at quote time.</p>}{option.choices.map((choice, index) => <ChoiceEditor key={`${choice.choiceValue}-${index}`} choice={choice} disabled={disabled} onChange={(next) => onChange({ ...option, choices: option.choices.map((entry, position) => position === index ? next : entry) })} onRemove={() => onChange({ ...option, choices: option.choices.filter((_, position) => position !== index) })} />)}</div>}
    </div>}
  </div>;
}
