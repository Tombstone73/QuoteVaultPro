import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { nanoid } from "nanoid";
import type { ProductOptionItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  choiceValueIsValid,
  getValidChoices,
  optionHasInvalidChoices,
} from "@/lib/optionChoiceValidation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  CircleX,
} from "lucide-react";

function slugify(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return cleaned || "group";
}

function slugifyChoiceValue(input: string): string {
  const raw = String(input || "").trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return cleaned || "option";
}

function uniqueChoiceValue(base: string, existing: Set<string>): string {
  let v = base;
  if (!existing.has(v)) return v;
  let i = 2;
  while (existing.has(`${v}-${i}`)) i += 1;
  return `${v}-${i}`;
}

function formatGroupHeaderFromKey(groupKey: string): string {
  const key = String(groupKey || "").trim().toLowerCase();
  if (key === "finishing") return "Finishing Options";
  if (key === "material") return "Material";
  if (key === "other") return "Other";

  const withSpaces = key.replace(/[_-]+/g, " ");
  return withSpaces.replace(/\b\w/g, (m) => m.toUpperCase());
}

function deriveGroupKeyFromOption(option: ProductOptionItem): string {
  const anyOpt: any = option as any;
  const explicit =
    (typeof anyOpt.groupKey === "string" && anyOpt.groupKey.trim()) ||
    (typeof anyOpt.group === "string" && anyOpt.group.trim()) ||
    "";

  if (explicit) return slugify(explicit);

  const configKind = option.config?.kind;
  if (configKind && ["grommets", "hems", "pole_pockets", "sides", "thickness"].includes(configKind)) {
    return "finishing";
  }

  const idKey = String((option as any)?.id ?? "").trim().toLowerCase();
  const labelKey = String((option as any)?.label ?? "").trim().toLowerCase();
  if (idKey === "material" || labelKey === "material") return "material";

  return "other";
}

function deriveGroupLabelFromOption(option: ProductOptionItem, groupKey: string): string {
  const anyOpt: any = option as any;
  const stored = typeof anyOpt.groupLabel === "string" ? anyOpt.groupLabel.trim() : "";
  if (stored) return stored;
  return formatGroupHeaderFromKey(groupKey);
}

function generateOptionId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCrypto: any = globalThis.crypto;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  } catch {
    // ignore
  }
  return `opt_${Math.random().toString(36).slice(2, 10)}`;
}

function generateChoiceId(): string {
  return nanoid();
}

type GroupDraft = {
  key: string;
  label: string;
};

export default function ProductOptionsEditor({
  form,
  fieldName,
  addGroupSignal,
}: {
  form: any;
  fieldName: string;
  addGroupSignal?: number | null;
}) {
  const options: ProductOptionItem[] = form.watch(fieldName) || [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [emptyGroups, setEmptyGroups] = useState<Record<string, GroupDraft>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const groupMeta = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string;
        label: string;
        options: Array<{ opt: ProductOptionItem; index: number }>;
      }
    >();

    options.forEach((opt, index) => {
      const key = deriveGroupKeyFromOption(opt);
      const label = deriveGroupLabelFromOption(opt, key);
      const entry = groups.get(key) ?? { key, label, options: [] };
      entry.options.push({ opt, index });
      // Prefer a stored groupLabel if present on any option in group
      if (label && label !== formatGroupHeaderFromKey(key)) {
        entry.label = label;
      }
      groups.set(key, entry);
    });

    for (const draft of Object.values(emptyGroups)) {
      if (!groups.has(draft.key)) {
        groups.set(draft.key, { key: draft.key, label: draft.label, options: [] });
      }
    }

    const list = Array.from(groups.values());
    list.sort((a, b) => {
      const aKey = a.key.toLowerCase();
      const bKey = b.key.toLowerCase();
      const aPri = aKey === "material" ? 0 : aKey === "finishing" ? 1 : 2;
      const bPri = bKey === "material" ? 0 : bKey === "finishing" ? 1 : 2;
      if (aPri !== bPri) return aPri - bPri;
      if (aPri === 2) return a.label.localeCompare(b.label);
      return 0;
    });

    return list;
  }, [options, emptyGroups]);

  const setAllOptions = (next: ProductOptionItem[]) => {
    form.setValue(fieldName, next);
  };

  const updateOptionAt = (index: number, patch: Partial<ProductOptionItem> & { ui?: any }) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    const prev = current[index];
    if (!prev) return;

    const merged: any = {
      ...prev,
      ...patch,
    };

    if (patch.ui) {
      merged.ui = { ...(prev as any).ui, ...patch.ui };
    }

    current[index] = merged as ProductOptionItem;
    setAllOptions(current);
  };

  const updateOptionTypeAt = (index: number, nextType: ProductOptionItem["type"]) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    const prev = current[index] as any;
    if (!prev) return;

    const basePatch: any = { type: nextType };

    // Clear defaults that don't apply to the new type.
    if (nextType === "select") {
      basePatch.defaultChecked = undefined;
      basePatch.defaultQty = undefined;
      basePatch.min = undefined;
      basePatch.max = undefined;
      basePatch.step = undefined;
      basePatch.defaultSelected = undefined;
    } else if (nextType === "checkbox" || nextType === "toggle") {
      basePatch.defaultValue = undefined;
      basePatch.defaultQty = undefined;
      basePatch.min = undefined;
      basePatch.max = undefined;
      basePatch.step = undefined;
    } else if (nextType === "quantity") {
      basePatch.defaultValue = undefined;
      basePatch.defaultChecked = undefined;
      basePatch.defaultSelected = undefined;
    } else {
      // attachment or unknown: clear all option defaults
      basePatch.defaultValue = undefined;
      basePatch.defaultChecked = undefined;
      basePatch.defaultQty = undefined;
      basePatch.min = undefined;
      basePatch.max = undefined;
      basePatch.step = undefined;
      basePatch.defaultSelected = undefined;
    }

    updateOptionAt(index, basePatch);
  };

  const deleteOptionAt = (index: number) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    current.splice(index, 1);
    setAllOptions(current);
  };

  const addOptionToGroup = (groupKey: string, groupLabel: string) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    current.push({
      id: generateOptionId(),
      label: "",
      type: "checkbox",
      priceMode: "flat",
      amount: 0,
      defaultSelected: false,
      sortOrder: (current.length || 0) + 1,
      config: { kind: "generic" },
      // New group metadata (persisted in optionsJson)
      group: groupKey,
      groupKey,
      groupLabel,
      ui: { visible: true, showPrice: true },
      required: false,
    } as any);
    setAllOptions(current);

    setEmptyGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
  };

  const deleteGroup = (groupKey: string) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    const next = current.filter((opt) => deriveGroupKeyFromOption(opt) !== groupKey);
    setAllOptions(next);
    setEmptyGroups((prev) => {
      if (!prev[groupKey]) return prev;
      const copy = { ...prev };
      delete copy[groupKey];
      return copy;
    });
  };

  const updateGroupLabel = (groupKey: string, nextLabel: string) => {
    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    const updated = current.map((opt) => {
      if (deriveGroupKeyFromOption(opt) !== groupKey) return opt;
      return {
        ...(opt as any),
        group: groupKey,
        groupKey,
        groupLabel: nextLabel,
      } as ProductOptionItem;
    });
    setAllOptions(updated);

    setEmptyGroups((prev) => {
      if (!prev[groupKey]) return prev;
      return { ...prev, [groupKey]: { key: groupKey, label: nextLabel } };
    });
  };

  const createEmptyGroup = () => {
    const used = new Set<string>([...groupMeta.map((g) => g.key)]);
    const baseLabel = "New Option Group";
    let key = slugify(baseLabel);
    let i = 2;
    while (used.has(key)) {
      key = `${slugify(baseLabel)}_${i}`;
      i += 1;
    }

    setEmptyGroups((prev) => ({
      ...prev,
      [key]: { key, label: baseLabel },
    }));
  };

  useEffect(() => {
    if (addGroupSignal == null) return;
    createEmptyGroup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addGroupSignal]);

  const toggleExpanded = (optionId: string) => {
    setExpanded((prev) => ({ ...prev, [optionId]: !prev[optionId] }));
  };

  const handleOptionDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId || !overId || activeId === overId) return;

    const current = [...(form.getValues(fieldName) || [])] as ProductOptionItem[];
    const activeIndex = current.findIndex((opt) => String((opt as any)?.id) === activeId);
    const overIndex = current.findIndex((opt) => String((opt as any)?.id) === overId);
    if (activeIndex < 0 || overIndex < 0) return;

    const activeGroup = deriveGroupKeyFromOption(current[activeIndex]);
    const overGroup = deriveGroupKeyFromOption(current[overIndex]);
    if (activeGroup !== overGroup) return;

    const groupIndices = current
      .map((opt, idx) => ({ opt, idx }))
      .filter(({ opt }) => deriveGroupKeyFromOption(opt) === activeGroup)
      .map(({ idx }) => idx);

    const from = groupIndices.indexOf(activeIndex);
    const to = groupIndices.indexOf(overIndex);
    if (from < 0 || to < 0) return;

    const groupItems = groupIndices.map((idx) => current[idx]);
    const moved = arrayMove(groupItems, from, to);
    const next = [...current];
    groupIndices.forEach((targetIdx, pos) => {
      next[targetIdx] = moved[pos];
    });

    // Keep sortOrder aligned with array order for stable rendering across the app.
    const withSort = next.map((opt, idx) => ({ ...(opt as any), sortOrder: idx + 1 })) as ProductOptionItem[];
    setAllOptions(withSort);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOptionDragEnd}>
      <div className="space-y-3">

      {groupMeta.length === 0 ? (
        <div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
          No options configured yet.
        </div>
      ) : null}

      {groupMeta.map((group) => {
        const groupLabel = group.label || formatGroupHeaderFromKey(group.key);

        return (
          <Card key={group.key} className="overflow-hidden">
            <CardHeader className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />

                  <Input
                    value={groupLabel}
                    onChange={(e) => updateGroupLabel(group.key, e.target.value)}
                    className="h-9 max-w-[360px]"
                    placeholder="Group label (customer-facing)"
                  />

                  <Badge variant="secondary" className={cn("text-[11px] font-mono", "shrink-0")}>
                    Internal Name: {group.key}
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete group"
                    onClick={() => deleteGroup(group.key)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4 pt-0 space-y-3">
              <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium px-1">
                <div className="col-span-3">Option Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-2">Settings</div>
                <div className="col-span-4">Price Impact</div>
                <div className="col-span-1 text-right">Action</div>
              </div>

              {group.options.length === 0 ? (
                <div className="text-sm text-muted-foreground italic p-3 border border-dashed rounded-lg text-center">
                  Empty group. Add an option below.
                </div>
              ) : null}

              <SortableContext
                items={group.options.map(({ opt }) => String(opt.id))}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                {group.options.map(({ opt, index }) => {
                  const anyOpt: any = opt as any;
                  const visible = anyOpt?.ui?.visible !== false;
                  const pill = anyOpt?.ui?.showPrice !== false;
                  const required = !!anyOpt?.required;
                  const isExpanded = !!expanded[String(opt.id)];

                  const hasAnyDefault =
                    (typeof anyOpt?.defaultValue === "string" && anyOpt.defaultValue.trim() !== "") ||
                    anyOpt?.defaultChecked === true ||
                    anyOpt?.defaultSelected === true ||
                    (typeof anyOpt?.defaultQty === "number" && Number.isFinite(anyOpt.defaultQty));

                  return (
                    <SortableOptionCard key={String(opt.id)} id={String(opt.id)}>
                      {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                        <div className={cn("rounded-lg border border-border/60 bg-background/40", isDragging && "opacity-70")}>
                          <div className="p-3 grid grid-cols-12 gap-2 items-start">
                            <div className="col-span-3 flex items-center gap-2">
                              <button
                                type="button"
                                ref={setActivatorNodeRef}
                                {...attributes}
                                {...listeners}
                                aria-label="Reorder option"
                                className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border/60 bg-background hover:bg-muted/40"
                              >
                                <GripVertical className="h-4 w-4 text-muted-foreground" />
                              </button>

                              <Input
                                value={opt.label || ""}
                                onChange={(e) => updateOptionAt(index, { label: e.target.value })}
                                placeholder="e.g., Lamination"
                                className="h-9 flex-1"
                              />
                            </div>

                            <div className="col-span-2">
                              <Select value={opt.type} onValueChange={(val) => updateOptionTypeAt(index, val as any)}>
                                <SelectTrigger className="h-9">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="checkbox">Checkbox</SelectItem>
                                  <SelectItem value="toggle">Toggle</SelectItem>
                                  <SelectItem value="quantity">Quantity</SelectItem>
                                  <SelectItem value="select">Dropdown</SelectItem>
                                  <SelectItem value="attachment">Attachment</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="col-span-2 flex items-center gap-3 pt-1">
                              <div className="flex items-center gap-2">
                                <Checkbox checked={required} onCheckedChange={(v) => updateOptionAt(index, { required: !!v })} />
                                <span className="text-xs">Req</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Checkbox checked={visible} onCheckedChange={(v) => updateOptionAt(index, { ui: { visible: !!v } })} />
                                <span className="text-xs">Vis</span>
                              </div>
                            </div>

                            <div className="col-span-4 grid grid-cols-12 gap-2">
                              <div className="col-span-5">
                                <Select value={opt.priceMode} onValueChange={(val) => updateOptionAt(index, { priceMode: val as any })}>
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="flat">Flat</SelectItem>
                                    <SelectItem value="per_qty">Per Qty</SelectItem>
                                    <SelectItem value="per_sqft">Per SqFt</SelectItem>
                                    <SelectItem value="flat_per_item">Per Item</SelectItem>
                                    <SelectItem value="percent_of_base">% of Base</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="col-span-4">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={(opt.amount ?? 0) as any}
                                  onChange={(e) => updateOptionAt(index, { amount: parseFloat(e.target.value) || 0 })}
                                  className="h-9"
                                />
                              </div>

                              <div className="col-span-3 flex items-center gap-2 pt-2">
                                <Checkbox checked={pill} onCheckedChange={(v) => updateOptionAt(index, { ui: { showPrice: !!v } })} />
                                <span className="text-xs">Pill</span>
                              </div>
                            </div>

                            <div className="col-span-1 flex items-center justify-end gap-1">
                              {hasAnyDefault ? <Badge variant="outline" className="text-[10px]">Default</Badge> : null}

                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                                onClick={() => toggleExpanded(String(opt.id))}
                              >
                                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </Button>

                              <Button type="button" variant="ghost" size="icon" aria-label="Delete option" onClick={() => deleteOptionAt(index)}>
                                <CircleX className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {isExpanded ? (
                            <div className="border-t border-border/60 p-3 bg-muted/10 space-y-3">
                          {opt.type === "select" ? (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">Dropdown choices</div>
                              <ChoiceEditor
                                value={(anyOpt.choices as any) || []}
                                onChange={(next) => {
                                  const nextValues = new Set((next || []).map((c) => String((c as any)?.value ?? "")).filter(Boolean));
                                  const currentDefault = typeof anyOpt?.defaultValue === "string" ? anyOpt.defaultValue : undefined;
                                  const nextDefault = currentDefault && nextValues.has(currentDefault) ? currentDefault : undefined;
                                  updateOptionAt(index, { choices: next as any, defaultValue: nextDefault as any });
                                }}
                              />

                              <div className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-3 text-xs text-muted-foreground font-medium">Default choice</div>
                                <div className="col-span-6">
                                  {optionHasInvalidChoices(anyOpt) ? (
                                    <div className="text-xs text-destructive">
                                      Fix choice values to set a default.
                                    </div>
                                  ) : null}

                                  {Array.isArray(anyOpt.choices) &&
                                  !optionHasInvalidChoices(anyOpt) &&
                                  !getValidChoices(anyOpt.choices as any[]).some((c: any) => String(c.value) === "none") ? (
                                    <div className="mb-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          const existing = new Set(
                                            (Array.isArray(anyOpt.choices) ? (anyOpt.choices as any[]) : [])
                                              .map((c: any) => String(c?.value ?? "").trim())
                                              .filter(Boolean)
                                          );
                                          const value = uniqueChoiceValue("none", existing);
                                          const nextChoices = [
                                            ...((Array.isArray(anyOpt.choices) ? (anyOpt.choices as any[]) : []) as any[]),
                                            { id: generateChoiceId(), label: "None", value, requiresNote: false },
                                          ];
                                          updateOptionAt(index, { choices: nextChoices as any });
                                        }}
                                      >
                                        Add “None” choice
                                      </Button>
                                    </div>
                                  ) : null}

                                  <Select
                                    disabled={optionHasInvalidChoices(anyOpt)}
                                    value={typeof anyOpt?.defaultValue === "string" ? anyOpt.defaultValue : "__no_default__"}
                                    onValueChange={(val) =>
                                      updateOptionAt(index, { defaultValue: val === "__no_default__" ? undefined : val })
                                    }
                                  >
                                    <SelectTrigger className="h-9">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__no_default__">No default</SelectItem>
                                      {getValidChoices(Array.isArray(anyOpt.choices) ? (anyOpt.choices as any[]) : []).map((c: any) => (
                                        <SelectItem key={String(c.value)} value={String(c.value)}>
                                          {String(c.label || c.value)}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>

                                <div className="col-span-3 flex justify-end">
                                  {typeof anyOpt?.defaultValue === "string" && anyOpt.defaultValue.trim() !== "" ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => updateOptionAt(index, { defaultValue: undefined })}
                                    >
                                      Clear
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : opt.type === "checkbox" || opt.type === "toggle" ? (
                            <div className="grid grid-cols-12 gap-2 items-center">
                              <div className="col-span-3 text-xs text-muted-foreground font-medium">Default</div>
                              <div className="col-span-9 flex items-center gap-2">
                                <Checkbox
                                  checked={anyOpt?.defaultChecked === true}
                                  onCheckedChange={(v) => {
                                    const checked = v === true;
                                    updateOptionAt(index, {
                                      defaultChecked: checked,
                                      // keep legacy field in sync for older runtime readers
                                      defaultSelected: checked,
                                    } as any);
                                  }}
                                />
                                <span className="text-xs text-muted-foreground">On by default</span>
                              </div>
                            </div>
                          ) : opt.type === "quantity" ? (
                            <div className="space-y-2">
                              <div className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-3 text-xs text-muted-foreground font-medium">Default qty</div>
                                <div className="col-span-3">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={typeof anyOpt?.defaultQty === "number" ? String(anyOpt.defaultQty) : ""}
                                    onChange={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      updateOptionAt(index, { defaultQty: Number.isFinite(parsed) ? Math.max(0, parsed) : undefined } as any);
                                    }}
                                    className="h-9"
                                  />
                                </div>
                                <div className="col-span-6 text-xs text-muted-foreground">Applies only when no selection exists yet.</div>
                              </div>

                              <div className="grid grid-cols-12 gap-2 items-center">
                                <div className="col-span-3 text-xs text-muted-foreground font-medium">Min / Max / Step</div>
                                <div className="col-span-3">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={typeof anyOpt?.min === "number" ? String(anyOpt.min) : ""}
                                    onChange={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      updateOptionAt(index, { min: Number.isFinite(parsed) ? parsed : undefined } as any);
                                    }}
                                    className="h-9"
                                    placeholder="Min"
                                  />
                                </div>
                                <div className="col-span-3">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={typeof anyOpt?.max === "number" ? String(anyOpt.max) : ""}
                                    onChange={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      updateOptionAt(index, { max: Number.isFinite(parsed) ? parsed : undefined } as any);
                                    }}
                                    className="h-9"
                                    placeholder="Max"
                                  />
                                </div>
                                <div className="col-span-3">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={typeof anyOpt?.step === "number" ? String(anyOpt.step) : ""}
                                    onChange={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      updateOptionAt(index, { step: Number.isFinite(parsed) ? parsed : undefined } as any);
                                    }}
                                    className="h-9"
                                    placeholder="Step"
                                  />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">Advanced settings (placeholder).</div>
                          )}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </SortableOptionCard>
                  );
                })}
                </div>
              </SortableContext>

              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {group.options.length} option{group.options.length === 1 ? "" : "s"}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addOptionToGroup(group.key, groupLabel)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Option Row
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </DndContext>
  );
}

function SortableOptionCard({
  id,
  children,
}: {
  id: string;
  children: (args: {
    attributes: any;
    listeners?: any;
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}

function ChoiceEditor({
  value,
  onChange,
}: {
  value: Array<{
    id?: string;
    value: string;
    label: string;
    requiresNote?: boolean;
    noteLabel?: string;
    notePlaceholder?: string;
  }>;
  onChange: (
    next: Array<{
      id?: string;
      value: string;
      label: string;
      requiresNote?: boolean;
      noteLabel?: string;
      notePlaceholder?: string;
    }>
  ) => void;
}) {
  const rows = Array.isArray(value) ? value : [];

  // Backfill stable ids exactly once per missing row (persisted in optionsJson).
  const hasMissingIds = rows.some((r) => !r || typeof (r as any).id !== "string" || String((r as any).id).trim() === "");
  useEffect(() => {
    if (!hasMissingIds) return;
    const next = rows.map((r) => {
      const existingId = typeof (r as any)?.id === "string" ? String((r as any).id).trim() : "";
      return existingId ? r : ({ ...r, id: generateChoiceId() } as any);
    });
    onChange(next as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMissingIds]);

  const rowsWithIds = useMemo(() => {
    return rows.map((r) => {
      const id = typeof (r as any)?.id === "string" ? String((r as any).id).trim() : "";
      return id ? r : ({ ...r, id: generateChoiceId() } as any);
    });
  }, [rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const handleChoiceDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId || !overId || activeId === overId) return;

    const ids = rowsWithIds.map((r) => String((r as any).id));
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(rowsWithIds as any[], from, to) as any);
  };

  const updateRowById = (
    rowId: string,
    patch: Partial<{
      value: string;
      label: string;
      requiresNote?: boolean;
      noteLabel?: string;
      notePlaceholder?: string;
    }>
  ) => {
    const next = [...rowsWithIds];
    const idx = next.findIndex((r: any) => String(r?.id) === rowId);
    if (idx < 0) return;
    const prev = next[idx] || { id: rowId, value: "", label: "" };
    const merged: any = { ...prev, ...patch };
    next[idx] = merged;
    onChange(next);
  };

  const deleteRowById = (rowId: string) => {
    const next = rowsWithIds.filter((r: any) => String(r?.id) !== rowId);
    onChange(next as any);
  };

  const addRow = () => {
    const existing = new Set(rowsWithIds.map((c) => String((c as any)?.value || "").trim()).filter(Boolean));
    const label = "";
    const value = uniqueChoiceValue("Value/Variable", existing);
    onChange([...(rowsWithIds || []), { id: generateChoiceId(), value, label, requiresNote: false } as any]);
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No choices yet.</div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleChoiceDragEnd}>
        <SortableContext items={rowsWithIds.map((r: any) => String(r?.id))} strategy={verticalListSortingStrategy}>
          {rowsWithIds.map((r: any) => (
            <SortableChoiceRow key={String(r.id)} id={String(r.id)}>
              {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                <div className={cn("space-y-2", isDragging && "opacity-70")}>
                  <div className="grid grid-cols-12 gap-2 items-start">
                    <div className="col-span-1 flex items-center">
                      <button
                        type="button"
                        ref={setActivatorNodeRef}
                        {...attributes}
                        {...listeners}
                        aria-label="Reorder choice"
                        className="h-9 w-9 inline-flex items-center justify-center rounded-md border border-border/60 bg-background hover:bg-muted/40"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                      </button>
                    </div>
                    <div className="col-span-4">
                      <Input
                        value={r.label || ""}
                        onChange={(e) => updateRowById(String(r.id), { label: e.target.value })}
                        placeholder="Label"
                        className="h-9"
                      />
                    </div>
                    <div className="col-span-4">
                      <div>
                        <Input
                          required
                          value={r.value || ""}
                          onChange={(e) => updateRowById(String(r.id), { value: e.target.value })}
                          placeholder="Value"
                          className={cn("h-9", !choiceValueIsValid(r) && "border-destructive/40")}
                        />
                        {!choiceValueIsValid(r) ? (
                          <div className="mt-1 text-[11px] text-destructive">Value is required (internal key)</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center gap-2 justify-end">
                      <Checkbox
                        checked={!!r.requiresNote}
                        onCheckedChange={(checked) => updateRowById(String(r.id), { requiresNote: checked === true })}
                      />
                      <span className="text-xs text-muted-foreground">Requires note</span>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRowById(String(r.id))}
                        aria-label="Remove choice"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {r.requiresNote ? (
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <Input
                          value={r.noteLabel || ""}
                          onChange={(e) => updateRowById(String(r.id), { noteLabel: e.target.value })}
                          placeholder="Note label (optional)"
                          className="h-9"
                        />
                      </div>
                      <div className="col-span-6">
                        <Input
                          value={r.notePlaceholder || ""}
                          onChange={(e) => updateRowById(String(r.id), { notePlaceholder: e.target.value })}
                          placeholder="Note placeholder (optional)"
                          className="h-9"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </SortableChoiceRow>
          ))}
        </SortableContext>
      </DndContext>

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-2" />
        Add Choice
      </Button>
    </div>
  );
}

function SortableChoiceRow({
  id,
  children,
}: {
  id: string;
  children: (args: {
    attributes: any;
    listeners?: any;
    setActivatorNodeRef: (node: HTMLElement | null) => void;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  );
}
