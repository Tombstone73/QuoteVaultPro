export type ProductAiParsingDescriptionMode = "new" | "improve" | "replace";

export type ProductAiParsingDescriptionContextArgs = {
  mode: ProductAiParsingDescriptionMode;
  productId?: string | null;
  values: Record<string, any>;
  productTypes?: Array<{ id: string; name: string }> | null;
  currentTree?: unknown;
  fallbackTree?: unknown;
};

export function hasExistingAiParsingDescription(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildProductAiParsingDescriptionContext({
  mode,
  productId,
  values,
  productTypes,
  currentTree,
  fallbackTree,
}: ProductAiParsingDescriptionContextArgs) {
  const selectedProductType = Array.isArray(productTypes)
    ? productTypes.find((type) => type.id === values.productTypeId)
    : null;

  return {
    productId: productId ?? null,
    mode,
    name: values.name ?? null,
    category: values.category ?? null,
    productTypeId: values.productTypeId ?? null,
    productTypeName: selectedProductType?.name ?? null,
    description: values.description ?? null,
    existingAiParsingDescription: values.aiParsingDescription ?? null,
    optionTreeJson: currentTree ?? fallbackTree ?? values.optionTreeJson ?? null,
    aliases: [],
    parsingMetadata: null,
  };
}

export function normalizeGeneratedAiParsingDescriptionResponse(json: any) {
  if (json?.success === false) {
    throw new Error(json?.message || "Failed to generate AI parsing description.");
  }

  const generatedDescription = json?.data?.generatedDescription;
  if (typeof generatedDescription !== "string" || !generatedDescription.trim()) {
    throw new Error("AI did not return a generated parsing description.");
  }

  return {
    generatedDescription,
    mode: json.data.mode as ProductAiParsingDescriptionMode,
    sourceFields: Array.isArray(json.data.sourceFields) ? json.data.sourceFields : [],
  };
}
