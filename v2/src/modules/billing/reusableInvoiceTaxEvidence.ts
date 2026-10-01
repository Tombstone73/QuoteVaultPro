/** Billing's current financial revision, never a repair of persisted history. */
export type InvoiceTaxEvidenceIdentity = Readonly<{ organizationId: string; invoiceId: string; orderId: string }>;
type EvidenceIdentity = InvoiceTaxEvidenceIdentity & Readonly<{ schemaVersion: 1; financialVersion: string | null; currency: string | null }>;
export type UnresolvedInvoiceTaxReason = "tax_jurisdiction_not_configured" | "tax_jurisdiction_conflict";
export type ReusableInvoiceTaxEvidence = EvidenceIdentity & (
  | Readonly<{ status: "resolved"; source: "canonical"; jurisdiction: Readonly<{ id: string; name: string; receiptLocation: Readonly<{ country: string; region: string; postalCode?: string }>; rateBasisPoints: number }>; exemption: Readonly<{ exempt: boolean; reason?: string; certificateReference?: string }> }>
  | Readonly<{ status: "unresolved"; source: "canonical" | "zero_tax_compatibility"; reason: UnresolvedInvoiceTaxReason }>
  | Readonly<{ status: "not_reusable"; reason: "invalid_identity" | "invalid_canonical_evidence" | "unsupported_evidence" | "invalid_compatibility_evidence" | "unbound_issued_evidence" }>
);

export type InvoiceTaxEvidenceSource = Readonly<{
  organizationId: unknown; invoiceId: unknown; orderId: unknown; invoiceState: unknown;
  financialVersion: unknown; currency: unknown; invoiceNumber: unknown;
  rawEvidence: unknown; calculatorVersion: unknown; contextReference: unknown;
  salesTaxComposition: unknown; commercialCharge: unknown; hasAdditionalCharges: unknown;
  subtotalCents: unknown; taxTotalCents: unknown; totalCents: unknown; adjustmentCents: unknown;
  lines: unknown; issuedCheckpoint: unknown;
}>;

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const reason = (value: unknown): value is UnresolvedInvoiceTaxReason => value === "tax_jurisdiction_not_configured" || value === "tax_jurisdiction_conflict";
const version = (value: unknown): string | null => {
  const candidate = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  return typeof candidate === "string" && /^[1-9]\d*$/.test(candidate) && BigInt(candidate) <= 9223372036854775807n ? candidate : null;
};
const cents = (value: unknown): number | undefined => {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?(0|[1-9]\d*)$/.test(value))) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};
const keysWithin = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Decode only persisted Invoice facts. Eligibility for issuance is a separate, unchanged policy. */
export function readReusableInvoiceTaxEvidence(source: InvoiceTaxEvidenceSource, expected: InvoiceTaxEvidenceIdentity): ReusableInvoiceTaxEvidence {
  const financialVersion = version(source.financialVersion);
  const currency = typeof source.currency === "string" && /^[A-Z]{3}$/.test(source.currency) ? source.currency : null;
  const identity: EvidenceIdentity = { schemaVersion: 1, ...expected, financialVersion, currency };
  const unavailable = (failure: Extract<ReusableInvoiceTaxEvidence, { status: "not_reusable" }>["reason"]): ReusableInvoiceTaxEvidence => ({ ...identity, status: "not_reusable", reason: failure });
  if (!text(expected.organizationId) || !text(expected.invoiceId) || !text(expected.orderId) ||
    source.organizationId !== expected.organizationId || source.invoiceId !== expected.invoiceId || source.orderId !== expected.orderId ||
    !financialVersion || !currency || (source.invoiceState !== "draft" && source.invoiceState !== "issued")) return unavailable("invalid_identity");

  const raw = object(source.rawEvidence);
  // Native evidence deliberately retains the historical consumers' minimum basis:
  // no newly required composition totals or calculatorVersion on native snapshots.
  if (raw?.status === "unresolved") return reason(raw.reason)
    ? { ...identity, status: "unresolved", source: "canonical", reason: raw.reason }
    : unavailable("invalid_canonical_evidence");
  if (raw?.status === "resolved") {
    const jurisdiction = object(raw.jurisdiction), receipt = object(jurisdiction?.receiptLocation), exemption = object(raw.exemption);
    const id = text(jurisdiction?.id), name = text(jurisdiction?.name), country = text(receipt?.country), region = text(receipt?.region);
    const rate = jurisdiction?.rateBasisPoints;
    if (!id || !name || !country || !region || typeof rate !== "number" || !Number.isSafeInteger(rate) || rate < 0 || rate > 10000 || typeof exemption?.exempt !== "boolean") return unavailable("invalid_canonical_evidence");
    return { ...identity, status: "resolved", source: "canonical",
      jurisdiction: { id, name, receiptLocation: { country, region, ...(text(receipt?.postalCode) ? { postalCode: text(receipt?.postalCode) } : {}) }, rateBasisPoints: rate },
      exemption: { exempt: exemption.exempt, ...(text(exemption.reason) ? { reason: text(exemption.reason) } : {}), ...(text(exemption.certificateReference) ? { certificateReference: text(exemption.certificateReference) } : {}) } };
  }
  if (!raw || raw.kind !== "zero_tax_compatibility" || !keysWithin(raw, ["kind", "calculatorVersion", "taxContextReference"])) return unavailable("unsupported_evidence");
  const compatibilityVersion = "v2-billing-zero-tax-compatibility-v1";
  const companion = object(source.salesTaxComposition);
  const context = source.contextReference;
  const contextValid = context === null ? !("taxContextReference" in raw) : !!text(context) && raw.taxContextReference === context;
  const subtotal = cents(source.subtotalCents), tax = cents(source.taxTotalCents), total = cents(source.totalCents), adjustment = cents(source.adjustmentCents);
  if (raw.calculatorVersion !== compatibilityVersion || source.calculatorVersion !== compatibilityVersion || !contextValid ||
    !companion || !keysWithin(companion, ["status", "calculatorVersion", "reason", "finalTotalCents"]) || companion.status !== "unresolved" ||
    companion.calculatorVersion !== "v2-sales-receipt-jurisdiction-v1" || !reason(companion.reason) ||
    typeof companion.finalTotalCents !== "number" || !Number.isSafeInteger(companion.finalTotalCents) ||
    subtotal === undefined || total === undefined || adjustment === undefined || subtotal < 0 || total !== subtotal || tax !== 0 ||
    companion.finalTotalCents !== total || source.commercialCharge !== null || source.hasAdditionalCharges !== false ||
    !Array.isArray(source.lines) || !source.lines.length) return unavailable("invalid_compatibility_evidence");
  let lineTotal = 0;
  const lineIds = new Set<string>();
  for (const value of source.lines) {
    const line = object(value), id = text(line?.lineId), amount = cents(line?.cents);
    if (!id || lineIds.has(id) || line?.currency !== currency || amount === undefined || amount < 0) return unavailable("invalid_compatibility_evidence");
    lineIds.add(id);
    lineTotal += amount;
    if (!Number.isSafeInteger(lineTotal)) return unavailable("invalid_compatibility_evidence");
  }
  if (!Number.isSafeInteger(lineTotal + adjustment) || lineTotal + adjustment !== subtotal) return unavailable("invalid_compatibility_evidence");
  const result: ReusableInvoiceTaxEvidence = { ...identity, status: "unresolved", source: "zero_tax_compatibility", reason: companion.reason };
  if (source.invoiceState === "issued") {
    const checkpoint = object(source.issuedCheckpoint), commercial = object(checkpoint?.commercial), evidence = object(checkpoint?.taxEvidence);
    const agrees = (value: unknown, amount: number) => { const money = object(value); return money?.currency === currency && money.cents === amount; };
    const checkpointAdjustment = object(commercial?.salesAdjustment);
    if (!checkpoint || checkpoint.schemaVersion !== 1 || checkpoint.invoiceId !== expected.invoiceId || checkpoint.organizationId !== expected.organizationId ||
      !text(source.invoiceNumber) || checkpoint.invoiceNumber !== source.invoiceNumber || commercial?.currency !== currency ||
      evidence?.calculationId !== `${expected.invoiceId}:${financialVersion}` || evidence.calculatorVersion !== compatibilityVersion ||
      (context === null ? "contextReference" in evidence : evidence.contextReference !== context) ||
      !Array.isArray(evidence.components) || evidence.components.length !== 0 ||
      !agrees(commercial.subtotal, subtotal) || !agrees(commercial.taxTotal, 0) || !agrees(commercial.total, total) ||
      (adjustment === 0 ? commercial.salesAdjustment !== undefined : !agrees(checkpointAdjustment?.amount, adjustment))) return unavailable("unbound_issued_evidence");
  }
  return result;
}
