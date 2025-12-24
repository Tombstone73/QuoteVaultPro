import { z } from "zod";
import type { ProductOptionItem } from "./schema";

export type ProductOptionUiType = "boolean" | "number" | "select" | "segmented" | "text";

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
  choices?: Array<{ value: string; label: string }>;
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
  choices?: Array<{ value: string; label: string }>;
  layout?: ProductOptionUiLayoutHints;
  children?: ProductOptionUiChild[];
};

const productOptionUiChildSchema: z.ZodType<ProductOptionUiChild> = z.object({
  label: z.string(),
  type: z.enum(["boolean", "number", "select", "segmented", "text"]),
  selectionKey: z.string(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().optional(),
  choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
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
  choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  layout: z
    .object({
      layoutSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      minWidth: z.number().optional(),
    })
    .optional(),
  children: z.array(productOptionUiChildSchema).optional(),
});

function toChoiceArray(values: unknown): Array<{ value: string; label: string }> | undefined {
  if (!Array.isArray(values)) return undefined;

  const out: Array<{ value: string; label: string }> = [];
  for (const v of values) {
    if (typeof v === "string") {
      const s = v.trim();
      if (s) out.push({ value: s, label: s });
      continue;
    }
    if (v && typeof v === "object") {
      const anyV: any = v;
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
      if (valueStr) out.push({ value: valueStr, label: labelStr || valueStr });
    }
  }

  // de-dupe by value, preserve first label
  const seen = new Set<string>();
  const deduped: Array<{ value: string; label: string }> = [];
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
    | Record<string, { value: unknown } | undefined>
    | Array<{ optionId: string; value: unknown }>
    | null
    | undefined
): string[] {
  const ui = normalizeProductOptionItemsToUiDefinitions(items);
  const missing: string[] = [];

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

    if (isMissing) missing.push(def.label);
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
        return {
          id: opt.id,
          label: opt.label,
          type: "number",
          group: groupKey,
          ui: uiFlags,
          required: coerceBoolean((opt as any).required) ?? false,
          defaultValue: 0,
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
      return {
        id: opt.id,
        label: opt.label,
        type: "boolean",
        group: groupKey,
        ui: uiFlags,
        required: coerceBoolean((opt as any).required) ?? false,
        defaultValue: opt.defaultSelected ?? false,
        layout: baseLayout,
        children: children.length > 0 ? children : undefined,
      };
    });
}
