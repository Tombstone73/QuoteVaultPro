export type ProductTypeUpdateGuardWarning = {
  code: "PRODUCT_TYPE_BLANK_PRESERVED";
  message: string;
  attemptedValue: unknown;
  preservedValue: string;
};

export type ProductTypeUpdateGuardResult =
  | {
      ok: true;
      productData: Record<string, unknown>;
      warning?: ProductTypeUpdateGuardWarning;
    }
  | {
      ok: false;
      status: 400;
      code: "INVALID_PRODUCT_TYPE_ID" | "UNKNOWN_PRODUCT_TYPE_ID";
      message: string;
      details: {
        attemptedValue: unknown;
        existingValue: string | null;
      };
    };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function applyProductTypeIdUpdateGuard({
  productData,
  existingProductTypeId,
  knownProductTypeIds,
}: {
  productData: Record<string, unknown>;
  existingProductTypeId: string | null | undefined;
  knownProductTypeIds: Iterable<string>;
}): ProductTypeUpdateGuardResult {
  const nextProductData = { ...productData };

  if (!Object.prototype.hasOwnProperty.call(nextProductData, "productTypeId")) {
    return { ok: true, productData: nextProductData };
  }

  const knownIds = new Set(Array.from(knownProductTypeIds).filter(isNonEmptyString));
  const existingValue = isNonEmptyString(existingProductTypeId) ? existingProductTypeId.trim() : null;
  const attemptedValue = nextProductData.productTypeId;

  if (attemptedValue === undefined) {
    delete nextProductData.productTypeId;
    return { ok: true, productData: nextProductData };
  }

  if (attemptedValue === null || (typeof attemptedValue === "string" && attemptedValue.trim().length === 0)) {
    if (existingValue) {
      nextProductData.productTypeId = existingValue;
      return {
        ok: true,
        productData: nextProductData,
        warning: {
          code: "PRODUCT_TYPE_BLANK_PRESERVED",
          message: "Blank productTypeId update preserved the existing product type.",
          attemptedValue,
          preservedValue: existingValue,
        },
      };
    }

    nextProductData.productTypeId = null;
    return { ok: true, productData: nextProductData };
  }

  if (typeof attemptedValue !== "string") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PRODUCT_TYPE_ID",
      message: "productTypeId must be a string, null, or omitted.",
      details: { attemptedValue, existingValue },
    };
  }

  const trimmedValue = attemptedValue.trim();
  if (!knownIds.has(trimmedValue)) {
    return {
      ok: false,
      status: 400,
      code: "UNKNOWN_PRODUCT_TYPE_ID",
      message: `Unknown product type '${trimmedValue}'. Choose a valid product type before saving.`,
      details: { attemptedValue: trimmedValue, existingValue },
    };
  }

  nextProductData.productTypeId = trimmedValue;
  return { ok: true, productData: nextProductData };
}
