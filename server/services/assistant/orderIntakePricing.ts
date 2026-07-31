type PricingFailure = {
  code: string;
  summary: string;
};

type PricingErrorLike = {
  code?: unknown;
  message?: unknown;
};

const INPUT_REQUIRED_CODES = new Set([
  "PBV2_PRICING_MATRIX_ERROR",
  "PBV2_OPTION_RULE_VALIDATION_FAILED",
]);

const safeMessage = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim().replace(/\s+/g, " ").slice(0, 500)
    : null;

/**
 * Pricing remains canonical and server-owned. This only turns known canonical
 * input rejections into a safe conversational blocker; it never supplies a
 * default option, dimension, or price.
 */
export function orderIntakePricingFailure(error: unknown): PricingFailure {
  const candidate = error as PricingErrorLike | null;
  const sourceCode = typeof candidate?.code === "string" ? candidate.code : null;
  const sourceMessage = safeMessage(candidate?.message);

  if (sourceCode && INPUT_REQUIRED_CODES.has(sourceCode)) {
    return {
      code: "ORDER_PRICING_INPUT_REQUIRED",
      summary: sourceMessage ?? "This product needs required pricing selections before an order preview can be created.",
    };
  }

  return {
    code: "ORDER_PRICING_UNAVAILABLE",
    summary: "This product cannot currently be priced for order entry. No order proposal was created.",
  };
}

export function orderIntakePricingBlocker(error: unknown) {
  const failure = orderIntakePricingFailure(error);
  return {
    response: failure.summary,
    card: {
      kind: "missing_information" as const,
      title: failure.code === "ORDER_PRICING_INPUT_REQUIRED" ? "Order pricing information needed" : "Order pricing unavailable",
      summary: failure.summary,
      sourceLinks: [],
      details: { code: failure.code },
    },
  };
}
