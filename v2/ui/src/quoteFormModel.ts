import type {
  ProductConfiguration,
  QuoteLine,
  QuoteSellingInstruction,
  UiBootstrap,
} from "./api";

export type SellingDraft = Readonly<{
  mode:
    | "calculated"
    | "unit_override"
    | "total_override"
    | "discount_preserved"
    | "locked_preserved";
  cents: string;
  reason: string;
  discountBasisPoints?: number;
}>;

export type QuoteLineDraft = Readonly<{
  productId: string;
  description: string;
  quantity: string;
  selections: Readonly<Record<string, unknown>>;
  dimensions: Readonly<{
    width: string;
    height: string;
    unit: "in" | "ft" | "mm";
  }>;
  selling: SellingDraft;
}>;

export type QuoteLineMutationInput = Readonly<{
  productId: string;
  description?: string;
  quantity: number;
  selections?: Readonly<Record<string, unknown>>;
  dimensions?: Readonly<{
    width: string;
    height: string;
    unit: "in" | "ft" | "mm";
  }>;
  selling?: QuoteSellingInstruction;
}>;

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};

const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const dimensionUnit = (value: unknown): "in" | "ft" | "mm" =>
  value === "ft" || value === "mm" ? value : "in";

export const emptyQuoteLineDraft = (): QuoteLineDraft => ({
  productId: "",
  description: "",
  quantity: "1",
  selections: {},
  dimensions: { width: "", height: "", unit: "in" },
  selling: { mode: "calculated", cents: "", reason: "" },
});

export const draftFromQuoteLine = (line: QuoteLine): QuoteLineDraft => {
  const resolved = asRecord(line.resolvedConfiguration);
  const dimensions = asRecord(resolved.dimensions);
  const decision = line.sellingPriceDecision;
  const selling: SellingDraft =
    decision.kind === "unit_override"
      ? {
          mode: "unit_override",
          cents: String(line.sellingUnitAmount.cents),
          reason: decision.reason ?? "",
        }
      : decision.kind === "total_override"
        ? {
            mode: "total_override",
            cents: String(line.sellingLineAmount.cents),
            reason: decision.reason ?? "",
          }
        : decision.kind === "discount"
          ? {
              mode: "discount_preserved",
              cents: "",
              reason: decision.reason ?? "",
              discountBasisPoints: decision.discountBasisPoints,
            }
          : decision.kind === "locked"
            ? {
                mode: "locked_preserved",
                cents: "",
                reason: decision.reason ?? "",
              }
            : { mode: "calculated", cents: "", reason: "" };
  return {
    productId: line.productId,
    description: line.description,
    quantity: String(line.quantity),
    selections: asRecord(resolved.selections),
    dimensions: {
      width: asText(dimensions.width),
      height: asText(dimensions.height),
      unit: dimensionUnit(dimensions.unit),
    },
    selling,
  };
};

export const changeDraftProduct = (
  draft: QuoteLineDraft,
  productId: string,
): QuoteLineDraft => ({
  ...draft,
  productId,
  description: "",
  selections: {},
  dimensions: { width: "", height: "", unit: "in" },
});

export const clearContactForCustomerChange = (customerId: string) => ({
  customerId,
  contactId: "",
});

export const markOverrideUnavailable = (
  current: UiBootstrap | undefined,
): UiBootstrap | undefined =>
  current
    ? {
        ...current,
        capabilities: {
          ...current.capabilities,
          quoteOverridePrice: false,
        },
      }
    : current;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

/** Exact equality prevents current Product defaults from silently changing a persisted line. */
export const sameEffectiveSelections = (
  persisted: Readonly<Record<string, unknown>>,
  resolved: Readonly<Record<string, unknown>>,
): boolean => canonical(persisted) === canonical(resolved);

export const configurationInputSupported = (inputType: string): boolean =>
  ["select", "boolean", "number", "text", "textarea", "multiselect"].includes(
    inputType,
  );

export const applyServerConfiguration = (
  draft: QuoteLineDraft,
  configuration: ProductConfiguration,
): QuoteLineDraft => ({
  ...draft,
  selections: { ...configuration.effectiveSelections },
  dimensions: configuration.requiresDimensions
    ? {
        ...draft.dimensions,
        unit: dimensionUnit(
          configuration.supportedDimensionUnits.includes(draft.dimensions.unit)
            ? draft.dimensions.unit
            : configuration.supportedDimensionUnits[0],
        ),
      }
    : { width: "", height: "", unit: "in" },
});

/**
 * Artwork metadata can assist a blank dimensional line, but an operator's
 * entered dimensions always remain authoritative local intent.
 */
export const applyDetectedArtworkDimensions = (
  draft: QuoteLineDraft,
  configuration: ProductConfiguration,
  size: Readonly<{ widthIn: number; heightIn: number }>,
): QuoteLineDraft | undefined => {
  if (
    !configuration.requiresDimensions ||
    draft.dimensions.width ||
    draft.dimensions.height ||
    draft.dimensions.unit !== "in"
  )
    return undefined;
  return {
    ...draft,
    dimensions: {
      ...draft.dimensions,
      width: String(size.widthIn),
      height: String(size.heightIn),
    },
  };
};

/**
 * Advances local draft intent before an async server resolution starts. This makes
 * rapid changes compose instead of allowing a later request to omit an earlier one.
 */
export const beginConfigurationSelectionResolution = (
  draft: QuoteLineDraft,
  selectionKey: string,
  value: unknown,
): Readonly<{
  draft: QuoteLineDraft;
  requestedSelections: Readonly<Record<string, unknown>>;
}> => {
  const requestedSelections = { ...draft.selections, [selectionKey]: value };
  return {
    draft: { ...draft, selections: requestedSelections },
    requestedSelections,
  };
};

export const assessPersistedConfiguration = (
  draft: QuoteLineDraft,
  resolved: ProductConfiguration,
): Readonly<{
  draft: QuoteLineDraft;
  configuration: ProductConfiguration;
  compatible: boolean;
}> => ({
  // Persisted Quote truth is retained even when the current definition adds defaults.
  draft,
  configuration: resolved,
  compatible: sameEffectiveSelections(
    draft.selections,
    resolved.effectiveSelections,
  ),
});

const safeCents = (value: string, label: string): number => {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error(`${label} must be a non-negative whole number of cents.`);
  return cents;
};

export const sellingInstructionFromDraft = (
  selling: SellingDraft,
): QuoteSellingInstruction => {
  if (selling.mode === "calculated") return { kind: "calculated" };
  if (selling.mode === "locked_preserved")
    throw new Error("A locked selling-price decision cannot be replaced by this UI.");
  if (!selling.reason.trim()) throw new Error("An override reason is required.");
  if (selling.mode === "unit_override")
    return {
      kind: "unit_override",
      unitCents: safeCents(selling.cents, "Unit override"),
      reason: selling.reason.trim(),
    };
  if (selling.mode === "total_override")
    return {
      kind: "total_override",
      totalCents: safeCents(selling.cents, "Total override"),
      reason: selling.reason.trim(),
    };
  if (
    !Number.isSafeInteger(selling.discountBasisPoints) ||
    selling.discountBasisPoints! < 0 ||
    selling.discountBasisPoints! > 10_000
  )
    throw new Error("The existing discount cannot be preserved safely.");
  return {
    kind: "discount",
    discountBasisPoints: selling.discountBasisPoints!,
    reason: selling.reason.trim(),
  };
};

export const quoteLineInputFromDraft = (
  draft: QuoteLineDraft,
  configuration: ProductConfiguration,
): QuoteLineMutationInput => {
  const quantity = Number(draft.quantity);
  if (!draft.productId) throw new Error("Select a Product.");
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error("Quantity must be a positive whole number.");
  if (
    configuration.fields.some(
      (field) => !configurationInputSupported(field.inputType),
    )
  )
    throw new Error("This Product contains a configuration field that this UI cannot edit safely.");
  if (
    configuration.requiresDimensions &&
    (!draft.dimensions.width || !draft.dimensions.height)
  )
    throw new Error("Width and height are required for this Product.");
  return {
    productId: draft.productId,
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    quantity,
    selections: { ...draft.selections },
    ...(configuration.requiresDimensions
      ? { dimensions: { ...draft.dimensions } }
      : {}),
    selling: sellingInstructionFromDraft(draft.selling),
  };
};
