import { useMemo, useState } from "react";
import type { ProductOptionItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
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

type GroupDraft = {
  key: string;
  label: string;
};

export default function ProductOptionsEditor({
  form,
  fieldName,
}: {
  form: any;
  fieldName: string;
}) {
  const options: ProductOptionItem[] = form.watch(fieldName) || [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [emptyGroups, setEmptyGroups] = useState<Record<string, GroupDraft>>({});

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

  const toggleExpanded = (optionId: string) => {
    setExpanded((prev) => ({ ...prev, [optionId]: !prev[optionId] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Options & Add-ons</div>
          <div className="text-xs text-muted-foreground">Organize options into customer-facing groups.</div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={createEmptyGroup}>
          <Plus className="h-4 w-4 mr-2" />
          Add Option Group
        </Button>
      </div>

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

              <div className="space-y-2">
                {group.options.map(({ opt, index }) => {
                  const anyOpt: any = opt as any;
                  const visible = anyOpt?.ui?.visible !== false;
                  const pill = anyOpt?.ui?.showPrice !== false;
                  const required = !!anyOpt?.required;
                  const isExpanded = !!expanded[String(opt.id)];

                  return (
                    <div key={String(opt.id)} className="rounded-lg border border-border/60 bg-background/40">
                      <div className="p-3 grid grid-cols-12 gap-2 items-start">
                        <div className="col-span-3">
                          <Input
                            value={opt.label || ""}
                            onChange={(e) => updateOptionAt(index, { label: e.target.value })}
                            placeholder="e.g., Lamination"
                            className="h-9"
                          />
                        </div>

                        <div className="col-span-2">
                          <Select
                            value={opt.type}
                            onValueChange={(val) => updateOptionAt(index, { type: val as any })}
                          >
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
                            <Checkbox
                              checked={required}
                              onCheckedChange={(v) => updateOptionAt(index, { required: !!v })}
                            />
                            <span className="text-xs">Req</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={visible}
                              onCheckedChange={(v) => updateOptionAt(index, { ui: { visible: !!v } })}
                            />
                            <span className="text-xs">Vis</span>
                          </div>
                        </div>

                        <div className="col-span-4 grid grid-cols-12 gap-2">
                          <div className="col-span-5">
                            <Select
                              value={opt.priceMode}
                              onValueChange={(val) => updateOptionAt(index, { priceMode: val as any })}
                            >
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
                            <Checkbox
                              checked={pill}
                              onCheckedChange={(v) => updateOptionAt(index, { ui: { showPrice: !!v } })}
                            />
                            <span className="text-xs">Pill</span>
                          </div>
                        </div>

                        <div className="col-span-1 flex items-center justify-end gap-1">
                          {opt.defaultSelected ? (
                            <Badge variant="outline" className="text-[10px]">Default</Badge>
                          ) : null}

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={isExpanded ? "Collapse" : "Expand"}
                            onClick={() => toggleExpanded(String(opt.id))}
                          >
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Delete option"
                            onClick={() => deleteOptionAt(index)}
                          >
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
                                onChange={(next) => updateOptionAt(index, { choices: next as any })}
                              />
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground">
                              Advanced settings (placeholder).
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

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
  );
}

function ChoiceEditor({
  value,
  onChange,
}: {
  value: Array<{ value: string; label: string }>;
  onChange: (next: Array<{ value: string; label: string }>) => void;
}) {
  const rows = Array.isArray(value) ? value : [];

  const updateRow = (idx: number, patch: Partial<{ value: string; label: string }>) => {
    const next = [...rows];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const deleteRow = (idx: number) => {
    const next = [...rows];
    next.splice(idx, 1);
    onChange(next);
  };

  const addRow = () => {
    onChange([...(rows || []), { value: "", label: "" }]);
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">No choices yet.</div>
      ) : null}

      {rows.map((r, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-5">
            <Input
              value={r.value || ""}
              onChange={(e) => updateRow(idx, { value: e.target.value })}
              placeholder="value"
              className="h-9"
            />
          </div>
          <div className="col-span-6">
            <Input
              value={r.label || ""}
              onChange={(e) => updateRow(idx, { label: e.target.value })}
              placeholder="label"
              className="h-9"
            />
          </div>
          <div className="col-span-1 flex justify-end">
            <Button type="button" variant="ghost" size="icon" onClick={() => deleteRow(idx)} aria-label="Remove choice">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-2" />
        Add Choice
      </Button>
    </div>
  );
}
