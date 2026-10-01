import assert from "node:assert/strict";
import { readReusableInvoiceTaxEvidence, type InvoiceTaxEvidenceSource } from "../../src/modules/billing/reusableInvoiceTaxEvidence.js";

const identity = { organizationId: "org", invoiceId: "invoice", orderId: "order" };
const calculatorVersion = "v2-billing-zero-tax-compatibility-v1";
const money = (cents: number) => ({ currency: "USD", cents });
const fixture = (): InvoiceTaxEvidenceSource => ({ ...identity, invoiceState: "issued", financialVersion: "1", currency: "USD", invoiceNumber: "ORD-1021",
  rawEvidence: { kind: "zero_tax_compatibility", calculatorVersion }, calculatorVersion, contextReference: null,
  salesTaxComposition: { status: "unresolved", calculatorVersion: "v2-sales-receipt-jurisdiction-v1", reason: "tax_jurisdiction_not_configured", finalTotalCents: 8750 },
  commercialCharge: null, hasAdditionalCharges: false, subtotalCents: "8750", taxTotalCents: "0", totalCents: "8750", adjustmentCents: "0",
  lines: [{ lineId: "line", currency: "USD", cents: "8750" }],
  issuedCheckpoint: { schemaVersion: 1, invoiceId: "invoice", organizationId: "org", invoiceNumber: "ORD-1021",
    commercial: { currency: "USD", subtotal: money(8750), taxTotal: money(0), total: money(8750) },
    taxEvidence: { calculationId: "invoice:1", calculatorVersion, components: [] } },
});
const resolved = { status: "resolved", jurisdiction: { id: "frozen", name: "Frozen home", receiptLocation: { country: "US", region: "IN" }, rateBasisPoints: 700 }, exemption: { exempt: false } };
const read = (source: InvoiceTaxEvidenceSource) => readReusableInvoiceTaxEvidence(source, identity);
const rejected = (source: InvoiceTaxEvidenceSource) => assert.equal(read(source).status, "not_reusable");
let count = 0;
const check = (name: string, run: () => void) => { run(); count++; console.log(`PASS ${name}`); };

check("native resolved preserves minimal historical basis without requiring totals or calculatorVersion", () => {
  const result = read({ ...fixture(), rawEvidence: resolved, salesTaxComposition: null, issuedCheckpoint: null });
  assert.deepEqual(result, { schemaVersion: 1, ...identity, financialVersion: "1", currency: "USD", ...resolved, source: "canonical" });
});
check("native configured zero and frozen exemption are not compatibility guesses", () => {
  for (const evidence of [{ ...resolved, jurisdiction: { ...resolved.jurisdiction, rateBasisPoints: 0 } }, { ...resolved, exemption: { exempt: true, reason: "certificate", certificateReference: "cert-1" } }]) {
    const result = read({ ...fixture(), rawEvidence: evidence });
    assert.equal(result.status, "resolved"); assert.equal("source" in result && result.source, "canonical");
    if (result.status === "resolved") assert.deepEqual(result.exemption, evidence.exemption);
  }
});
check("both existing native unresolved reasons remain supported without new version prerequisites", () => {
  for (const reason of ["tax_jurisdiction_not_configured", "tax_jurisdiction_conflict"]) {
    const result = read({ ...fixture(), rawEvidence: { status: "unresolved", reason }, calculatorVersion: "historical", issuedCheckpoint: null });
    assert.equal(result.status, "unresolved"); assert.equal("source" in result && result.source, "canonical");
  }
});
check("sufficient immutable compatibility yields explicitly sourced unresolved, never invented exemption", () => {
  const source = fixture(), before = JSON.stringify(source), result = read(source);
  assert.deepEqual(result, { schemaVersion: 1, ...identity, currency: "USD", financialVersion: "1", status: "unresolved", source: "zero_tax_compatibility", reason: "tax_jurisdiction_not_configured" });
  assert.equal(JSON.stringify(source), before); assert.equal("exemption" in result, false); assert.equal("jurisdiction" in result, false);
});
check("current draft normalization needs no pretend historical checkpoint", () => {
  assert.equal(read({ ...fixture(), invoiceState: "draft", invoiceNumber: null, issuedCheckpoint: null }).status, "unresolved");
});
check("malformed canonical never falls back to valid companion", () => {
  for (const rawEvidence of [{ status: "resolved" }, { ...resolved, exemption: {} }, { ...resolved, jurisdiction: { ...resolved.jurisdiction, rateBasisPoints: -1 } }, { status: "unresolved", reason: "unknown" }, { status: "bogus", kind: "zero_tax_compatibility", calculatorVersion }]) rejected({ ...fixture(), rawEvidence });
});
check("zero tax alone, null, strings and unknown envelopes are not evidence", () => {
  for (const rawEvidence of [null, {}, [], "zero_tax_compatibility", { kind: "other" }, { kind: "zero_tax_compatibility", calculatorVersion, arbitrary: true }]) rejected({ ...fixture(), rawEvidence });
});
check("both compatibility calculator versions must match exactly", () => {
  rejected({ ...fixture(), calculatorVersion: "tax-v1" });
  rejected({ ...fixture(), rawEvidence: { kind: "zero_tax_compatibility", calculatorVersion: "tax-v1" } });
});
check("explicit companion requires known version and supported reason", () => {
  const companion = fixture().salesTaxComposition as object;
  for (const salesTaxComposition of [null, {}, [], { ...companion, calculatorVersion: "unknown" }, { ...companion, reason: "zero" }, { ...companion, status: "resolved" }, { ...companion, finalTotalCents: "8750" }, { ...companion, jurisdiction: {} }]) rejected({ ...fixture(), salesTaxComposition });
});
check("identity, state and currency are never coerced or borrowed", () => {
  for (const patch of [{ organizationId: "foreign" }, { invoiceId: "other" }, { orderId: "other" }, { invoiceState: "void" }, { currency: "usd" }, { currency: null }, { financialVersion: undefined }]) rejected({ ...fixture(), ...patch });
});
check("financial versions compare losslessly beyond JS safe integers", () => {
  const source = fixture(), checkpoint = source.issuedCheckpoint as { taxEvidence: object };
  const large = "9007199254740993";
  assert.equal(read({ ...source, financialVersion: large, issuedCheckpoint: { ...checkpoint, taxEvidence: { ...checkpoint.taxEvidence, calculationId: `invoice:${large}` } } }).financialVersion, large);
  for (const financialVersion of [9007199254740993, "01", "1.0", "0", "-1", "9223372036854775808", null]) rejected({ ...source, financialVersion });
});
check("missing or changed issued checkpoint version fails closed", () => {
  rejected({ ...fixture(), issuedCheckpoint: null }); rejected({ ...fixture(), financialVersion: "2" });
});
check("checkpoint identity, version, number and currency must match", () => {
  const source = fixture(), checkpoint = source.issuedCheckpoint as { commercial: object; taxEvidence: object };
  for (const patch of [{ invoiceId: "other" }, { organizationId: "foreign" }, { invoiceNumber: "ORD-other" }, { schemaVersion: 2 }, { commercial: { ...checkpoint.commercial, currency: "CAD" } }, { taxEvidence: { ...checkpoint.taxEvidence, calculatorVersion: "unknown" } }]) rejected({ ...source, issuedCheckpoint: { ...checkpoint, ...patch } });
});
check("context presence and exact value bind envelope, scalar and checkpoint", () => {
  const source = fixture(), checkpoint = source.issuedCheckpoint as { taxEvidence: object };
  rejected({ ...source, contextReference: "opaque" }); rejected({ ...source, contextReference: undefined });
  const withContext = { ...source, contextReference: "opaque", rawEvidence: { ...(source.rawEvidence as object), taxContextReference: "opaque" }, issuedCheckpoint: { ...checkpoint, taxEvidence: { ...checkpoint.taxEvidence, contextReference: "opaque" } } };
  assert.equal(read(withContext).status, "unresolved");
  rejected({ ...withContext, contextReference: "different" }); rejected({ ...source, issuedCheckpoint: { ...checkpoint, taxEvidence: { ...checkpoint.taxEvidence, contextReference: null } } });
});
check("null, unsafe, fractional, mismatched and nonzero tax amounts reject", () => {
  for (const patch of [{ subtotalCents: null }, { taxTotalCents: "1" }, { totalCents: "8749" }, { subtotalCents: "8750.0" }, { adjustmentCents: undefined }, { totalCents: Number.MAX_SAFE_INTEGER + 1 }]) rejected({ ...fixture(), ...patch });
});
check("line currency, identity, safe amounts and sum are coherent", () => {
  for (const lines of [null, [], [{ currency: "USD", cents: "8750" }], [{ lineId: "line", currency: "CAD", cents: "8750" }], [{ lineId: "line", currency: "USD", cents: null }], [{ lineId: "line", currency: "USD", cents: "8749" }]]) rejected({ ...fixture(), lines });
});
check("commercial charges, retained zero charges and missing charge presence reject", () => {
  for (const patch of [{ commercialCharge: {} }, { commercialCharge: { kind: "shipping", cents: 0 } }, { commercialCharge: undefined }, { hasAdditionalCharges: true }, { hasAdditionalCharges: undefined }]) rejected({ ...fixture(), ...patch });
});
check("commercial-charge divergence is rejected rather than silently repaired", () => {
  rejected({ ...fixture(), totalCents: "1899", subtotalCents: "1899", adjustmentCents: "-101", lines: [{ lineId: "line", currency: "USD", cents: "2000" }], commercialCharge: { kind: "shipping", cents: 101 }, salesTaxComposition: { ...(fixture().salesTaxComposition as object), finalTotalCents: 2000 } });
});
check("checkpoint money and adjustment contradictions reject", () => {
  const source = fixture(), checkpoint = source.issuedCheckpoint as { commercial: object };
  for (const commercial of [{ ...checkpoint.commercial, total: money(8749) }, { ...checkpoint.commercial, subtotal: { currency: "CAD", cents: 8750 } }, { ...checkpoint.commercial, salesAdjustment: { amount: money(0) } }]) rejected({ ...source, issuedCheckpoint: { ...checkpoint, commercial } });
});
check("current canonical evidence wins over stale companion and prior checkpoint", () => {
  const source = fixture();
  rejected({ ...source, financialVersion: "2" });
  const native = read({ ...source, rawEvidence: resolved, financialVersion: "2", salesTaxComposition: null });
  assert.equal(native.status, "resolved", "current canonical raw always wins over an old checkpoint or companion");
});
console.log(`Reusable Invoice tax evidence: ${count} pure cases passed.`);
