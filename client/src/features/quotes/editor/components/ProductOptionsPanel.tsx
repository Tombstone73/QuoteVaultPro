import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ProductOptionItem } from "@shared/schema";
import type { ProductOptionUiChild, ProductOptionUiChoice, ProductOptionUiDefinition } from "@shared/productOptionUi";
import {
    applyOptionDefaultsToSelections,
    getMissingRequiredOptionLabels,
    injectDerivedMaterialOptionIntoProductOptions,
    normalizeProductOptionItemsToUiDefinitions,
} from "@shared/productOptionUi";
import { choiceValueIsValid } from "@/lib/optionChoiceValidation";
import type { OptionSelection } from "../types";
import { formatOptionPriceLabel } from "../utils";
import { cn } from "@/lib/utils";

type ProductOptionsPanelProps = {
    product?: unknown;
    productOptions: ProductOptionItem[];
    optionSelections: Record<string, OptionSelection>;
    onOptionSelectionsChange: (selections: Record<string, OptionSelection>) => void;
};

function groupSortKey(groupName: string): number {
    const key = groupName.toLowerCase();
    if (key === "material") return 0;
    if (key === "finishing") return 1;
    return 2;
}

function normalizeGroup(groupName: string | undefined): string {
    const v = (groupName || "").trim();
    return v.length > 0 ? v : "Other";
}

function formatGroupHeader(groupName: string): string {
    const key = groupName.toLowerCase();
    if (key === "finishing") return "Finishing Options";
    if (key === "material") return "Material";
    if (key === "other") return "Other";
    return groupName;
}


function optionIsMissingRequired(def: ProductOptionUiDefinition, selection: OptionSelection | undefined): boolean {
    if (!def.required) return false;
    const rawVal = selection?.value;

    if (def.type === "select" || def.type === "segmented") {
        const effectiveVal = rawVal ?? def.defaultValue;
        const missingValue = effectiveVal == null || String(effectiveVal).trim() === "";
        if (missingValue) return true;

        const selectedValue = String(effectiveVal);
        const selectedChoice = (def.choices ?? []).find((c) => c.value === selectedValue);
        if (selectedChoice?.requiresNote) {
            const note = selection?.note;
            return note == null || String(note).trim() === "";
        }

        return false;
    }

    const val = rawVal;
    if (def.type === "number") return val == null;
    if (def.type === "boolean") return !val;
    return val == null || String(val).trim() === "";
}

function findSelectedChoiceForValue(choices: ProductOptionUiChoice[] | undefined, value: unknown): ProductOptionUiChoice | null {
    const v = value == null ? "" : String(value);
    if (!Array.isArray(choices) || v.trim() === "") return null;
    return choices.find((c) => c.value === v) ?? null;
}

type OptionTileProps = {
    ui: ProductOptionUiDefinition;
    source?: ProductOptionItem;
    selection?: OptionSelection;
    isInvalid?: boolean;
    onSetSelection: (optionId: string, next: OptionSelection) => void;
    onRemoveSelection: (optionId: string) => void;
    onCacheSelection: (optionId: string, selection: OptionSelection) => void;
    onRestoreCachedSelection: (optionId: string) => OptionSelection | null;
};

const OptionRow = memo(function OptionRow({
    ui,
    source,
    selection,
    isInvalid,
    onSetSelection,
    onRemoveSelection,
    onCacheSelection,
    onRestoreCachedSelection,
}: OptionTileProps) {
    const children = ui.children;
    const hasChildren = !!children && children.length > 0;

    const isVisible = ui.ui?.visible !== false;
    if (!isVisible) return null;

    const showPrice = ui.ui?.showPrice !== false;

    const optionBadge = showPrice && source?.amount != null ? (
        <Badge variant="secondary" className="text-[11px]">
            {formatOptionPriceLabel(source)}
        </Badge>
    ) : null;

    const childrenOpen = hasChildren && !!selection;

    const applyChildDefaults = (base: OptionSelection) => {
        if (!children || children.length === 0) return base;
        const next: any = { ...base };
        for (const child of children) {
            if (child.defaultValue == null) continue;
            if (next[child.selectionKey] == null || next[child.selectionKey] === "") {
                next[child.selectionKey] = child.defaultValue;
            }
        }
        return next as OptionSelection;
    };

    const isChildVisible = (child: ProductOptionUiChild, sel: OptionSelection | undefined) => {
        if (!child.visibleWhen) return true;
        const currentValue = (sel as any)?.[child.visibleWhen.key];
        if (child.visibleWhen.when === "truthy") return !!currentValue;
        return currentValue === child.visibleWhen.value;
    };

    const ensureParentSelection = () => {
        if (selection) return selection;
        const restored = onRestoreCachedSelection(ui.id);
        if (restored) return restored;
        const next = applyChildDefaults({ value: true } as OptionSelection);
        onSetSelection(ui.id, next);
        return next;
    };

    const renderChildControl = (child: ProductOptionUiChild) => {
        if (!isChildVisible(child, selection)) return null;
        const current = (selection as any)?.[child.selectionKey];
        const value = current ?? child.defaultValue ?? (child.type === "number" ? 0 : "");

        if (child.type === "number") {
            return (
                <div key={child.selectionKey} className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{child.label}</span>
                    <Input
                        type="number"
                        min="0"
                        value={typeof value === "number" ? value : parseFloat(String(value)) || 0}
                        onChange={(e) => {
                            const nextNum = parseFloat(e.target.value);
                            const parent = ensureParentSelection();
                            onSetSelection(ui.id, {
                                ...(parent as any),
                                [child.selectionKey]: Number.isFinite(nextNum) ? nextNum : 0,
                            });
                        }}
                        className="h-8 w-20"
                    />
                </div>
            );
        }

        if (child.type === "select" || child.type === "segmented") {
            const choices = (child.choices ?? []).filter((c) => choiceValueIsValid(c));
            if (child.type === "segmented" && choices.length > 0) {
                return (
                    <div key={child.selectionKey} className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">{child.label}</span>
                        <div className="flex items-center gap-1">
                            {choices.map((c) => (
                                <Button
                                    key={c.value}
                                    type="button"
                                    variant={String(value) === c.value ? "default" : "outline"}
                                    size="sm"
                                    className="h-8 px-2"
                                    onClick={() => {
                                        const parent = ensureParentSelection();
                                        onSetSelection(ui.id, {
                                            ...(parent as any),
                                            [child.selectionKey]: c.value,
                                        });
                                    }}
                                >
                                    {c.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                );
            }

            return (
                <div key={child.selectionKey} className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{child.label}</span>
                    <Select
                        value={String(value ?? "")}
                        onValueChange={(val) => {
                            const parent = ensureParentSelection();
                            onSetSelection(ui.id, {
                                ...(parent as any),
                                [child.selectionKey]: val,
                            });
                        }}
                    >
                        <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                            {choices.map((c) => (
                                <SelectItem key={c.value} value={c.value}>
                                    {c.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            );
        }

        if (child.type === "text") {
            return (
                <div key={child.selectionKey} className="w-full">
                    <div className="text-[11px] text-muted-foreground mb-1">{child.label}</div>
                    <Textarea
                        value={typeof value === "string" ? value : String(value ?? "")}
                        onChange={(e) => {
                            const parent = ensureParentSelection();
                            onSetSelection(ui.id, {
                                ...(parent as any),
                                [child.selectionKey]: e.target.value,
                            });
                        }}
                        rows={2}
                        className="text-xs"
                    />
                </div>
            );
        }

        return (
            <div key={child.selectionKey} className="flex items-center gap-2">
                <Switch
                    checked={!!value}
                    onCheckedChange={(checked) => {
                        const parent = ensureParentSelection();
                        onSetSelection(ui.id, {
                            ...(parent as any),
                            [child.selectionKey]: checked,
                        });
                    }}
                />
                <span className="text-[11px] text-muted-foreground">{child.label}</span>
            </div>
        );
    };

    const rowClass = cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2",
        "rounded-md border border-border/40 bg-muted/10 px-3 py-2",
        isInvalid && "border-destructive/40 bg-destructive/5"
    );

    const labelClass = cn(
        "text-sm leading-snug whitespace-normal",
        isInvalid ? "text-destructive" : "text-foreground"
    );

    const leftControl = (() => {
        if (ui.type === "boolean" && !ui.required) {
            const isSelected = !!selection;
            return (
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                        const nextChecked = checked === true;
                        if (!nextChecked) {
                            if (selection) onCacheSelection(ui.id, selection);
                            onRemoveSelection(ui.id);
                            return;
                        }
                        const restored = onRestoreCachedSelection(ui.id);
                        const next = restored ?? applyChildDefaults({ value: true } as OptionSelection);
                        onSetSelection(ui.id, next);
                    }}
                    className="mt-0.5"
                />
            );
        }
        return <div className="h-5 w-10" />;
    })();

    const renderChildren = () => {
        if (!hasChildren) return null;
        return (
            <div
                className={cn(
                    "overflow-hidden transition-[max-height,opacity] duration-150",
                    childrenOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
                )}
            >
                <div className="flex flex-wrap items-center gap-2">
                    {children!.map((child) => renderChildControl(child))}
                </div>
            </div>
        );
    };

    const rightControlsClass = "flex flex-wrap items-center justify-end gap-2 ml-auto";

    if (ui.type === "boolean" && !ui.required) {
        return (
            <div className={rowClass}>
                <div className="flex items-start gap-2 min-w-0">
                    <div className="pt-0.5 w-10 shrink-0">{leftControl}</div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Label className={labelClass}>{ui.label}</Label>
                            {optionBadge}
                        </div>
                    </div>
                </div>

                <div className={rightControlsClass}>
                    {renderChildren()}
                </div>
            </div>
        );
    }

    if (ui.type === "segmented") {
        const choices = ui.choices ?? [];
        const current = selection?.value ?? ui.defaultValue ?? choices[0]?.value ?? "";
        const selectedChoice = findSelectedChoiceForValue(choices, current);
        const requiresNote = !!selectedChoice?.requiresNote;
        const noteLabel = (selectedChoice?.noteLabel || "Details").trim() || "Details";
        const notePlaceholder = selectedChoice?.notePlaceholder || "";
        const noteIsInvalid = ui.required && requiresNote && (selection?.note == null || String(selection.note).trim() === "");
        return (
            <div className={rowClass}>
                <div className="flex items-start gap-2 min-w-0">
                    <div className="pt-0.5 w-10 shrink-0">{leftControl}</div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Label className={labelClass}>{ui.label}</Label>
                            {optionBadge}
                        </div>
                    </div>
                </div>

                <div className={rightControlsClass}>
                    <div className="flex flex-wrap items-center gap-1">
                        {choices.map((c) => (
                            <Button
                                key={c.value}
                                type="button"
                                variant={String(current) === c.value ? "default" : "outline"}
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => {
                                    const base = { ...(selection as any), value: c.value } as OptionSelection;
                                    const next = applyChildDefaults(base);
                                    onSetSelection(ui.id, next);
                                }}
                            >
                                {c.label}
                            </Button>
                        ))}
                    </div>

                    {requiresNote ? (
                        <div className="w-full">
                            <div className="text-[11px] text-muted-foreground mb-1">{noteLabel}</div>
                            <Textarea
                                value={typeof selection?.note === "string" ? selection.note : ""}
                                placeholder={notePlaceholder}
                                onChange={(e) => {
                                    const currentSelection = selection ?? (applyChildDefaults({ value: current } as OptionSelection) as OptionSelection);
                                    onSetSelection(ui.id, {
                                        ...(currentSelection as any),
                                        note: e.target.value,
                                    });
                                }}
                                rows={2}
                                className={cn("text-xs", noteIsInvalid && "border-destructive/40")}
                            />
                            {noteIsInvalid ? (
                                <div className="mt-1 text-xs text-destructive">Please enter details</div>
                            ) : null}
                        </div>
                    ) : null}

                    {renderChildren()}
                </div>
            </div>
        );
    }

    if (ui.type === "number") {
        const current = typeof selection?.value === "number" ? selection.value : 0;
        return (
            <div className={rowClass}>
                <div className="flex items-start gap-2 min-w-0">
                    <div className="pt-0.5 w-10 shrink-0">{leftControl}</div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <Label className={labelClass}>{ui.label}</Label>
                            {optionBadge}
                        </div>
                    </div>
                </div>

                <div className={rightControlsClass}>
                    <Input
                        type="number"
                        min="0"
                        value={current}
                        onChange={(e) => {
                            const nextNum = parseInt(e.target.value, 10) || 0;
                            if (nextNum > 0 || ui.required) {
                                const next = applyChildDefaults({ value: nextNum } as OptionSelection);
                                onSetSelection(ui.id, next);
                            } else {
                                if (selection) onCacheSelection(ui.id, selection);
                                onRemoveSelection(ui.id);
                            }
                        }}
                        className="h-8 w-28"
                    />
                    {renderChildren()}
                </div>
            </div>
        );
    }

    // select (including required selects)
    const choices = (ui.choices ?? []).filter((c) => choiceValueIsValid(c));
    const current = selection?.value ?? ui.defaultValue ?? "";
    const selectedChoice = findSelectedChoiceForValue(choices, current);
    const requiresNote = !!selectedChoice?.requiresNote;
    const noteLabel = (selectedChoice?.noteLabel || "Details").trim() || "Details";
    const notePlaceholder = selectedChoice?.notePlaceholder || "";
    const noteIsInvalid = ui.required && requiresNote && (selection?.note == null || String(selection.note).trim() === "");
    return (
        <div className={rowClass}>
            <div className="flex items-start gap-2 min-w-0">
                <div className="pt-0.5 w-10 shrink-0">{leftControl}</div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Label className={labelClass}>{ui.label}</Label>
                        {ui.required && <span className="text-[11px] text-muted-foreground">Required</span>}
                        {optionBadge}
                    </div>
                </div>
            </div>

            <div className={rightControlsClass}>
                <Select
                    value={typeof current === "string" ? current : String(current ?? "")}
                    onValueChange={(val) => {
                        const base = { ...(selection as any), value: val } as OptionSelection;
                        const next = applyChildDefaults(base);
                        onSetSelection(ui.id, next);
                    }}
                >
                    <SelectTrigger
                        className={cn("h-8 w-[220px]", ui.required && isInvalid && "border-destructive/40")}
                    >
                        <SelectValue placeholder={choices.length > 0 ? "Select" : "No choices"} />
                    </SelectTrigger>
                    <SelectContent>
                        {choices.map((c) => (
                            <SelectItem key={c.value} value={c.value}>
                                {c.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {requiresNote ? (
                    <div className="w-full">
                        <div className="text-[11px] text-muted-foreground mb-1">{noteLabel}</div>
                        <Textarea
                            value={typeof selection?.note === "string" ? selection.note : ""}
                            placeholder={notePlaceholder}
                            onChange={(e) => {
                                const currentSelection = selection ?? (applyChildDefaults({ value: current } as OptionSelection) as OptionSelection);
                                onSetSelection(ui.id, {
                                    ...(currentSelection as any),
                                    note: e.target.value,
                                });
                            }}
                            rows={2}
                            className={cn("text-xs", noteIsInvalid && "border-destructive/40")}
                        />
                        {noteIsInvalid ? (
                            <div className="mt-1 text-xs text-destructive">Please enter details</div>
                        ) : null}
                    </div>
                ) : null}
                {renderChildren()}
            </div>
        </div>
    );
});

export const ProductOptionsPanel = memo(function ProductOptionsPanel({
    product,
    productOptions,
    optionSelections,
    onOptionSelectionsChange,
}: ProductOptionsPanelProps) {
    const effectiveProductOptions = useMemo(() => {
        return injectDerivedMaterialOptionIntoProductOptions(product, productOptions || []);
    }, [product, productOptions]);

    const uiOptions = useMemo(() => {
        return normalizeProductOptionItemsToUiDefinitions(effectiveProductOptions || []);
    }, [effectiveProductOptions]);

    // Cache selections for toggled-off options so values return on re-enable,
    // but are NOT persisted as "active" selections while disabled.
    const cachedSelectionsRef = useRef<Record<string, OptionSelection>>({});

    const onCacheSelection = useCallback((optionId: string, selection: OptionSelection) => {
        cachedSelectionsRef.current[optionId] = selection;
    }, []);

    const onRestoreCachedSelection = useCallback((optionId: string) => {
        const cached = cachedSelectionsRef.current[optionId];
        if (!cached) return null;
        // restore into active selections
        onOptionSelectionsChange({
            ...optionSelections,
            [optionId]: cached,
        });
        return cached;
    }, [onOptionSelectionsChange, optionSelections]);

    const onRemoveSelection = useCallback((optionId: string) => {
        const { [optionId]: _, ...rest } = optionSelections;
        onOptionSelectionsChange(rest);
    }, [onOptionSelectionsChange, optionSelections]);

    const onSetSelection = useCallback((optionId: string, next: OptionSelection) => {
        onOptionSelectionsChange({
            ...optionSelections,
            [optionId]: next,
        });
    }, [onOptionSelectionsChange, optionSelections]);

    // Apply product-defined defaults for ALL options (visible + hidden) without overwriting
    // any existing selection values (including false/0).
    useEffect(() => {
        const { selections, changed } = applyOptionDefaultsToSelections(uiOptions, optionSelections as any);
        if (!changed) return;
        onOptionSelectionsChange(selections as any);
    }, [uiOptions, optionSelections, onOptionSelectionsChange]);

    const missingRequiredLabels = useMemo(() => {
        return getMissingRequiredOptionLabels(effectiveProductOptions || [], optionSelections as any);
    }, [effectiveProductOptions, optionSelections]);

    const groupedAll = useMemo(() => {
        const groups = new Map<string, ProductOptionUiDefinition[]>();
        for (const opt of uiOptions) {
            const name = normalizeGroup(opt.group);
            const list = groups.get(name) ?? [];
            list.push(opt);
            groups.set(name, list);
        }
        const entries = Array.from(groups.entries());
        entries.sort((a, b) => {
            const ak = groupSortKey(a[0]);
            const bk = groupSortKey(b[0]);
            if (ak !== bk) return ak - bk;
            // stable-ish: alpha for non-priority groups
            if (ak === 2) return a[0].localeCompare(b[0]);
            return 0;
        });
        return entries;
    }, [uiOptions]);

    const groupedVisible = useMemo(() => {
        return groupedAll
            .map(([name, defs]) => [name, defs.filter((d) => d.ui?.visible !== false)] as const)
            .filter(([, defs]) => defs.length > 0);
    }, [groupedAll]);

    const productOptionById = useMemo(() => {
        const m = new Map<string, ProductOptionItem>();
        for (const opt of effectiveProductOptions || []) {
            m.set(opt.id, opt);
        }
        return m;
    }, [effectiveProductOptions]);

    if (uiOptions.length === 0) {
        return null;
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{formatGroupHeader(groupedVisible[0]?.[0] ?? "Options")}</div>
                {missingRequiredLabels.length > 0 && (
                    <Badge
                        variant="outline"
                        className="text-[11px] border-destructive/40 text-destructive bg-destructive/5"
                    >
                        Missing: {missingRequiredLabels.join(", ")}
                    </Badge>
                )}
            </div>

            {groupedVisible.map(([groupName, options], idx) => {
                const showGroupHeader = groupedVisible.length > 1;
                return (
                    <div key={groupName} className="space-y-1.5">
                        {showGroupHeader && idx !== 0 && (
                            <div className="text-sm font-medium">{formatGroupHeader(groupName)}</div>
                        )}
                        <div className="space-y-2">
                            {options.map((ui) => {
                                const source = productOptionById.get(ui.id);
                                const selection = optionSelections[ui.id];
                                const isInvalid = optionIsMissingRequired(ui, selection);
                                return (
                                    <OptionRow
                                        key={ui.id}
                                        ui={ui}
                                        source={source}
                                        selection={selection}
                                        isInvalid={isInvalid}
                                        onSetSelection={onSetSelection}
                                        onRemoveSelection={onRemoveSelection}
                                        onCacheSelection={onCacheSelection}
                                        onRestoreCachedSelection={onRestoreCachedSelection}
                                    />
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});
