/** The base Order / Job number is sequence one.  Billable replacements start
 * at B and intentionally stop at Z until a future explicit policy exists. */
export const replacementInvoiceSuffix = (sequence: number): string => {
  if (!Number.isSafeInteger(sequence) || sequence < 2 || sequence > 26)
    throw new Error("Replacement Invoice suffix is outside the supported B-Z range.");
  return String.fromCharCode("A".charCodeAt(0) + sequence - 1);
};

export const nextReplacementInvoiceSequence = (usedSequences: readonly number[]): number => {
  const used = new Set(usedSequences);
  for (let sequence = 2; sequence <= 26; sequence += 1) if (!used.has(sequence)) return sequence;
  throw new Error("Replacement Invoice suffix capacity is exhausted for this Order.");
};

/** Preserve the original effective selling basis, including a discounted or
 * total-override line, with the canonical deterministic half-up cent rule. */
export const proportionalReplacementLineCents = (sourceLineCents: number, sourceQuantity: number, replacementQuantity: number): number => {
  if (!Number.isSafeInteger(sourceLineCents) || !Number.isSafeInteger(sourceQuantity) || !Number.isSafeInteger(replacementQuantity)
    || sourceQuantity <= 0 || replacementQuantity <= 0)
    throw new Error("Replacement Invoice quantity cannot be priced from the original line.");
  const sign = sourceLineCents < 0 ? -1 : 1;
  const cents = Math.floor((Math.abs(sourceLineCents) * replacementQuantity + Math.floor(sourceQuantity / 2)) / sourceQuantity);
  if (!Number.isSafeInteger(cents)) throw new Error("Replacement Invoice amount is outside the safe cent range.");
  return cents * sign;
};
