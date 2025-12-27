import { z } from "zod";
import type { ProductOptionItem } from "./schema";

export type ProductOptionUiType = "boolean" | "number" | "select" | "segmented" | "text";

export type ProductOptionUiChoice = {
  /** Stable identifier for editor/DnD (optional for backward compatibility). */
  id?: string;
  value: string;
  label: string;
  /** When true, the selected choice requires an additional free-text note on the line item. */
  requiresNote?: boolean;
  /** Optional label for the note field (defaults to "Details" in the renderer). */
  noteLabel?: string;
  /** Optional placeholder for the note field. */
  notePlaceholder?: string;
};

export type ProductOptionUiLayoutHints = {
  layoutSpan?: 1 | 2 | 3;
  minWidth?: number;
};

export type ProductOptionUiVisibility =
  | { key: string; when: "truthy" }
  | { key: string; when: "equals"; value: string | number | boolean };

export type ProductOptionUiChild = {
  label: string;
  type: ProductOptionUiType;
  selectionKey: string;
  defaultValue?: string | number | boolean;
  required?: boolean;
  choices?: ProductOptionUiChoice[];
  visibleWhen?: ProductOptionUiVisibility;
  layout?: ProductOptionUiLayoutHints;
  inline?: boolean;
};

export type ProductOptionUiFlags = {
  /** If false, option is hidden in Quote UI (still exists for pricing/state). Default true. */
  visible?: boolean;
  /** If false, hide the price pill (e.g. +$x.xx). Default true. */
  showPrice?: boolean;
};

export type ProductOptionUiDefinition = {
  id: string;
  label: string;
  type: ProductOptionUiType;
  /** Optional internal group key (material/finishing/finish_opt/etc) for compact grouping UI. */
  group?: string;
  /** UI-only flags for Quote editor rendering. */
  ui?: ProductOptionUiFlags;
  required?: boolean;
  defaultValue?: string | number | boolean;
  choices?: ProductOptionUiChoice[];
  layout?: ProductOptionUiLayoutHints;
  children?: ProductOptionUiChild[];
};

export type ProductOptionSelectionsMap = Record<string, { value: unknown; [key: string]: unknown } | undefined>;

const productOptionUiChoiceSchema: z.ZodType<ProductOptionUiChoice> = z.object({
  id: z.string().optional(),
  value: z.string(),
  label: z.string(),
  requiresNote: z.boolean().optional(),
  noteLabel: z.string().optional(),
  notePlaceholder: z.string().optional(),
});

function stableChoiceIdFromSeed(seed: string): string {
  // Deterministic, low-collision id for legacy data. This is NOT used for editor-created choices.
  // Keeps normalization stable across reloads when `id` is missing.
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  // Force unsigned 32-bit and base36-encode.
  return `ch_${(hash >>> 0).toString(36)}`;
}

const productOptionUiChildSchema: z.ZodType<ProductOptionUiChild> = z.object({
  label: z.string(),
  type: z.enum(["boolean", "number", "select", "segmented", "text"]),
  selectionKey: z.string(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  choices: z.array(productOptionUiChoiceSchema).optional(),
  visibleWhen: z
    .union([
      z.object({ key: z.string(), when: z.literal("truthy") }),
      z.object({ key: z.string(), when: z.literal("equals"), value: z.union([z.string(), z.number(), z.boolean()]) }),
    ])
    .optional(),
  layout: z
    .object({
      layoutSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      minWidth: z.number().optional(),
    })
    .optional(),
  inline: z.boolean().optional(),
});

export const productOptionUiDefinitionSchema: z.ZodType<ProductOptionUiDefinition> = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["boolean", "number", "select", "segmented", "text"]),
  group: z.string().optional(),
  ui: z
    .object({
      visible: z.boolean().optional(),
      showPrice: z.boolean().optional(),
    })
    .optional(),
  required: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  choices: z.array(productOptionUiChoiceSchema).optional(),
  layout: z
    .object({
      layoutSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      minWidth: z.number().optional(),
    })
    .optional(),
  children: z.array(productOptionUiChildSchema).optional(),
});

function toChoiceArray(values: unknown): ProductOptionUiChoice[] | undefined {
  if (!Array.isArray(values)) return undefined;

  const out: ProductOptionUiChoice[] = [];
  for (let idx = 0; idx < values.length; idx++) {
    const v = values[idx];
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push({ id: stableChoiceIdFromSeed(`s:${idx}:${s}`), value: s, label: s });
      continue;
    }
    if (v && typeof v === "object") {
      const anyV: any = v;
      const rawId = typeof anyV.id === "string" ? anyV.id : undefined;
      const rawValue =
        (typeof anyV.value === "string" && anyV.value) ||
        (typeof anyV.id === "string" && anyV.id) ||
        (typeof anyV.materialId === "string" && anyV.materialId) ||
        (typeof anyV.key === "string" && anyV.key) ||
        "";
      const rawLabel =
        (typeof anyV.label === "string" && anyV.label) ||
        (typeof anyV.name === "string" && anyV.name) ||
        rawValue;
      const valueStr = String(rawValue || "").trim();
      const labelStr = String(rawLabel || "").trim();
      if (valueStr) {
      out.push({
        id: rawId && rawId.trim() ? rawId.trim() : stableChoiceIdFromSeed(`o:${idx}:${valueStr}|${labelStr}`),
          value: valueStr,
          label: labelStr || valueStr,
          requiresNote: typeof anyV.requiresNote === "boolean" ? anyV.requiresNote : undefined,
          noteLabel: typeof anyV.noteLabel === "string" ? anyV.noteLabel : undefined,
          notePlaceholder: typeof anyV.notePlaceholder === "string" ? anyV.notePlaceholder : undefined,
        });
      }
    }
  }

  // de-dupe by value, preserve first label
  const seen = new Set<string>();
  const deduped: ProductOptionUiChoice[] = [];
  for (const c of out) {
    if (seen.has(c.value)) continue;
    seen.add(c.value);
    deduped.push(c);
  }

  return deduped.length > 0 ? deduped : undefined;
}

function normalizeGroupName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length > 0 ? v : undefined;
}

function coerceBoolean(raw: unknown): boolean | undefined {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function hasMaterialOptionAlready(items: ProductOptionItem[]): boolean {
  return (items || []).some((opt) => {
    const id = String((opt as any)?.id ?? "").trim().toLowerCase();
    const label = String((opt as any)?.label ?? "").trim().toLowerCase();
    return id === "material" || label === "material";
  });
}

function deriveMaterialChoicesFromProduct(product: unknown): Array<{ value: string; label: string }> | undefined {
  const anyP: any = product as any;
  if (!anyP) return undefined;
  const raw = anyP.materials;
  return toChoiceArray(raw);
}

/**
 * UI-only injection: if a product carries a `materials` list (runtime field) but does not
 * have an explicit "material" option in `optionsJson`, inject a derived select option.
 *
 * This is intentionally UI-layer only (no schema/pricing changes).
 */
export function injectDerivedMaterialOptionIntoProductOptions(
  product: unknown,
  items: ProductOptionItem[]
): ProductOptionItem[] {
  const base = Array.isArray(items) ? items : [];
  if (base.length === 0 && !product) return base;
  if (hasMaterialOptionAlready(base)) return base;

  const choices = deriveMaterialChoicesFromProduct(product);
  if (!choices || choices.length === 0) return base;

  const anyP: any = product as any;
  const preferredDefault =
    (typeof anyP?.primaryMaterialId === "string" && anyP.primaryMaterialId) ||
    (typeof anyP?.defaultMaterialId === "string" && anyP.defaultMaterialId) ||
    undefined;
  const defaultValue =
    preferredDefault && choices.some((c) => c.value === preferredDefault)
      ? preferredDefault
      : choices[0]?.value;

  const derived: any = {
    id: "material",
    label: "Material",
    type: "select",
    // Ensure it behaves like a normal option everywhere without adding cost.
    priceMode: "flat",
    // Leave amount undefined so the UI doesn't show a $0.00 pill.
    amount: undefined,
    defaultSelected: false,
    sortOrder: -1000,
    // UI-only metadata consumed by the normalizer/renderer
    required: true,
    defaultValue,
    choices,
    group: "Material",
    ui: { visible: true, showPrice: false },
    config: { kind: "generic" },
  };

  return [derived as ProductOptionItem, ...base];
}

/**
 * Extract a generic selection value for a given optionId from either:
 * - the quote editor's `optionSelections` map
 * - or a persisted `selectedOptions` array from the backend
 */
export function getSelectionValueForOption(
  selections:
    | Record<string, { value: unknown } | undefined>
    | Array<{ optionId: string; value: unknown }>
    | null
    | undefined,
  optionId: string
): unknown {
  if (!selections) return undefined;
  if (Array.isArray(selections)) {
    const match = selections.find((s) => s?.optionId === optionId);
    return match?.value;
  }
  return selections[optionId]?.value;
}

/**
 * Compute missing required option labels for a given product option definition list.
 *
 * Rules:
 * - Required applies when `required: true` is set on an option definition (stored in product JSON).
 * - For select/segmented: missing when value is null/undefined/empty string.
 * - For number: missing when value is null/undefined.
 * - For boolean: missing when falsey.
 */
export function getMissingRequiredOptionLabels(
  items: ProductOptionItem[],
  selections:
    | Record<string, { value: unknown; note?: unknown } | undefined>
    | Array<{ optionId: string; value: unknown; note?: unknown }>
    | null
    | undefined
): string[] {
  const ui = normalizeProductOptionItemsToUiDefinitions(items);
  const missing: string[] = [];

  const getSelectionNoteForOption = (optionId: string): unknown => {
    if (!selections) return undefined;
    if (Array.isArray(selections)) {
      const match = selections.find((s) => s?.optionId === optionId);
      return (match as any)?.note;
    }
    return (selections as any)[optionId]?.note;
  };

  for (const def of ui) {
    if (!def.required) continue;
    const val = getSelectionValueForOption(selections, def.id);
    const isMissing =
      def.type === "select" || def.type === "segmented"
        ? val == null || String(val).trim() === ""
        : def.type === "number"
          ? val == null
          : def.type === "boolean"
            ? !val
            : val == null || String(val).trim() === "";

    if (isMissing) {
      missing.push(def.label);
      continue;
    }

    // If the required option is a select/segmented and the selected choice requires a note,
    // then the note is required too.
    if ((def.type === "select" || def.type === "segmented") && Array.isArray(def.choices)) {
      const selected = String(val ?? "");
      const choice = def.choices.find((c) => c.value === selected);
      if (choice?.requiresNote) {
        const note = getSelectionNoteForOption(def.id);
        if (note == null || String(note).trim() === "") {
          missing.push(def.label);
        }
      }
    }
  }

  return missing;
}

/**
 * Normalize the product's `optionsJson` (legacy `ProductOptionItem[]`) into a UI-friendly,
 * fully dynamic structure (supports conditional children and dense layout hints).
 *
 * Note: This is intentionally backward compatible with existing option configs
 * (e.g. `config.kind = grommets/hems/pole_pockets/sides`). The *renderer* can stay generic.
 */
export function normalizeProductOptionItemsToUiDefinitions(
  items: ProductOptionItem[]
): ProductOptionUiDefinition[] {
  const sorted = [...(items || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return sorted
    .filter((opt) => opt.type !== "attachment")
    .map((opt) => {
      const uiFlagsRaw = (opt as any).ui;
      const uiFlags: ProductOptionUiFlags = {
        visible: coerceBoolean(uiFlagsRaw?.visible) ?? true,
        showPrice: coerceBoolean(uiFlagsRaw?.showPrice) ?? true,
      };

      const baseLayout: ProductOptionUiLayoutHints | undefined = (opt as any).layout
        ? {
            layoutSpan: (opt as any).layout?.layoutSpan,
            minWidth: (opt as any).layout?.minWidth,
          }
        : undefined;

      const explicitGroup = normalizeGroupName((opt as any).group) ?? undefined;

      // Legacy fallback grouping: finishing kinds go to "finishing" by default.
      const legacyDefaultGroupKey =
        opt.config?.kind && ["grommets", "hems", "pole_pockets", "sides", "thickness"].includes(opt.config.kind)
          ? "finishing"
          : undefined;

      const groupKey = explicitGroup ?? legacyDefaultGroupKey;

      // Allow future products to define children generically in JSON without code changes.
      const directChildren = Array.isArray((opt as any).children)
        ? (opt as any).children
            .map((c: unknown) => {
              const parsed = productOptionUiChildSchema.safeParse(c);
              return parsed.success ? parsed.data : null;
            })
            .filter(Boolean)
        : undefined;

      const configKind = opt.config?.kind;
      const legacyChildren: ProductOptionUiChild[] = [];

      if (configKind === "sides") {
        return {
          id: opt.id,
          label: opt.label,
          type: "segmented",
          group: groupKey,
          ui: uiFlags,
          required: coerceBoolean((opt as any).required) ?? false,
          defaultValue: (opt.config as any)?.defaultSide ?? "single",
          choices: [
            { value: "single", label: opt.config?.singleLabel || "Single" },
            { value: "double", label: opt.config?.doubleLabel || "Double" },
          ],
          layout: baseLayout,
        };
      }

      if (configKind === "grommets") {
        const spacingChoices = toChoiceArray((opt.config as any)?.spacingOptions?.map((n: any) => String(n)));
        if (spacingChoices) {
          legacyChildren.push({
            label: "Spacing",
            type: "select",
            selectionKey: "grommetsSpacingInches",
            defaultValue: (opt.config as any)?.defaultSpacingInches ?? Number(spacingChoices[0]?.value ?? 12),
            choices: spacingChoices.map((c) => ({ value: c.value, label: `${c.value}\"` })),
            inline: true,
          });
        }

        legacyChildren.push({
          label: "Per",
          type: "number",
          selectionKey: "grommetsPerSign",
          defaultValue: 4,
          inline: true,
        });

        legacyChildren.push({
          label: "Location",
          type: "select",
          selectionKey: "grommetsLocation",
          defaultValue: (opt.config as any)?.defaultLocation ?? "all_corners",
          choices: [
            { value: "all_corners", label: "All Corners" },
            { value: "top_corners", label: "Top Corners" },
            { value: "top_even", label: "Top Even" },
            { value: "custom", label: "Custom" },
          ],
          inline: true,
        });

        legacyChildren.push({
          label: "Count",
          type: "number",
          selectionKey: "grommetsSpacingCount",
          defaultValue: (opt.config as any)?.defaultSpacingCount ?? 0,
          inline: true,
          visibleWhen: { key: "grommetsLocation", when: "equals", value: "top_even" },
        });

        legacyChildren.push({
          label: "Notes",
          type: "text",
          selectionKey: "customPlacementNote",
          inline: false,
          visibleWhen: { key: "grommetsLocation", when: "equals", value: "custom" },
        });
      }

      if (configKind === "hems") {
        const hems = toChoiceArray((opt.config as any)?.hemsChoices);
        legacyChildren.push({
          label: "Hem",
          type: "select",
          selectionKey: "hemsType",
          defaultValue: (opt.config as any)?.defaultHems ?? (hems?.[0]?.value ?? "none"),
          choices:
            hems ??
            [
              { value: "none", label: "None" },
              { value: "all_sides", label: "All Sides" },
              { value: "top_bottom", label: "Top & Bottom" },
              { value: "left_right", label: "Left & Right" },
            ],
          inline: true,
        });
      }

      if (configKind === "pole_pockets") {
        const pockets = toChoiceArray((opt.config as any)?.polePocketChoices);
        legacyChildren.push({
          label: "Pocket",
          type: "select",
          selectionKey: "polePocket",
          defaultValue: (opt.config as any)?.defaultPolePocket ?? (pockets?.[0]?.value ?? "none"),
          choices:
            pockets ??
            [
              { value: "none", label: "None" },
              { value: "top", label: "Top" },
              { value: "bottom", label: "Bottom" },
              { value: "top_bottom", label: "Top & Bottom" },
            ],
          inline: true,
        });
      }

      const children = [...legacyChildren, ...(directChildren ?? [])];

      // Base control types
      if (opt.type === "quantity") {
        const rawDefaultQty = (opt as any).defaultQty;
        const defaultQty = typeof rawDefaultQty === "number" && Number.isFinite(rawDefaultQty) ? rawDefaultQty : undefined;
        return {
          id: opt.id,
          label: opt.label,
          type: "number",
          group: groupKey,
          ui: uiFlags,
          required: coerceBoolean((opt as any).required) ?? false,
          defaultValue: defaultQty,
          layout: baseLayout,
          children: children.length > 0 ? children : undefined,
        };
      }

      if (opt.type === "select") {
        const choices =
          toChoiceArray((opt as any).choices) ??
          toChoiceArray((opt as any).config?.choices) ??
          toChoiceArray((opt as any).config?.options);

        return {
          id: opt.id,
          label: opt.label,
          type: "select",
          ui: uiFlags,
          defaultValue: (opt as any).defaultValue,
          required: coerceBoolean((opt as any).required) ?? false,
          group: groupKey,
          choices,
          layout: baseLayout,
          children: children.length > 0 ? children : undefined,
        };
      }

      // checkbox + generic toggle => boolean
      const rawDefaultChecked = (opt as any).defaultChecked;
      const rawLegacyDefaultSelected = (opt as any).defaultSelected;
      const defaultChecked =
        typeof rawDefaultChecked === "boolean"
          ? rawDefaultChecked
          : typeof rawLegacyDefaultSelected === "boolean"
            ? rawLegacyDefaultSelected
            : undefined;
      return {
        id: opt.id,
        label: opt.label,
        type: "boolean",
        group: groupKey,
        ui: uiFlags,
        required: coerceBoolean((opt as any).required) ?? false,
        // Only treat boolean defaults as "enabled by default" when explicitly true.
        // Leaving this undefined preserves existing behavior where "off" is represented by no selection.
        defaultValue: defaultChecked === true ? true : undefined,
        layout: baseLayout,
        children: children.length > 0 ? children : undefined,
      };
    });
}

function applyChildDefaultsForDefinition(def: ProductOptionUiDefinition, base: Record<string, unknown>): Record<string, unknown> {
  const children = def.children;
  if (!children || children.length === 0) return base;
  const next: Record<string, unknown> = { ...base };
  for (const child of children) {
    if (child.defaultValue == null) continue;
    const existing = next[child.selectionKey];
    if (existing == null || existing === "") {
      next[child.selectionKey] = child.defaultValue;
    }
  }
  return next;
}

function selectionIsMissingForDefinition(def: ProductOptionUiDefinition, selection: { value?: unknown } | undefined): boolean {
  if (!selection) return true;
  const rawVal = (selection as any).value;
  if (rawVal == null) return true;
  // Empty string counts as missing for text/select types.
  if ((def.type === "select" || def.type === "segmented" || def.type === "text") && typeof rawVal === "string") {
    return rawVal.trim() === "";
  }
  // Note: false and 0 are valid selections and must NOT be treated as missing.
  return false;
}

function getDefaultSelectionForDefinition(def: ProductOptionUiDefinition): Record<string, unknown> | null {
  const v = def.defaultValue;

  if (def.type === "boolean") {
    // Preserve legacy semantics: only create a selection when default is explicitly ON.
    if (v === true) {
      return applyChildDefaultsForDefinition(def, { value: true });
    }
    return null;
  }

  if (def.type === "select" || def.type === "segmented") {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return null;
    const choices = def.choices ?? [];
    if (choices.length > 0 && !choices.some((c) => c.value === raw)) return null;
    return applyChildDefaultsForDefinition(def, { value: raw });
  }

  if (def.type === "number") {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    const sanitized = Math.max(0, v);
    return applyChildDefaultsForDefinition(def, { value: sanitized });
  }

  if (def.type === "text") {
    const raw = typeof v === "string" ? v.trim() : "";
    if (!raw) return null;
    return applyChildDefaultsForDefinition(def, { value: raw });
  }

  return null;
}

/**
 * Apply product-defined defaults to an optionSelections map.
 *
 * Rules:
 * - Only applies when the selection for that option is missing.
 * - Never overwrites an existing selection value (including false/0).
 * - For boolean options, only creates a selection when default is explicitly ON.
 */
export function applyOptionDefaultsToSelections(
  defs: ProductOptionUiDefinition[],
  selections: ProductOptionSelectionsMap | null | undefined
): { selections: ProductOptionSelectionsMap; changed: boolean } {
  const base: ProductOptionSelectionsMap = selections ? { ...selections } : {};
  let changed = false;

  for (const def of defs) {
    const existing = base[def.id];
    if (!selectionIsMissingForDefinition(def, existing as any)) continue;
    const defaultSel = getDefaultSelectionForDefinition(def);
    if (!defaultSel) continue;
    base[def.id] = defaultSel as any;
    changed = true;
  }

  return { selections: base, changed };
}
