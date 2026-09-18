/**
 * Terminal Orders are historical records, not universally immutable records.
 * This policy deliberately keeps narrow, non-financial corrections available
 * without granting access to commercial or workflow changes.
 */
const COMPLETED_ORDER_SAFE_METADATA_FIELDS = new Set([
  "poNumber",
  "label",
  "priority",
  "dueDate",
  "promisedDate",
  "contactId",
  "shippingInstructions",
  "carrier",
  "carrierAccountNumber",
  "trackingNumber",
  "shippingAddress",
]);

export type TerminalOrderPatchClassification = "safe_metadata" | "high_risk";

export function classifyTerminalOrderPatch(patch: Record<string, unknown>): TerminalOrderPatchClassification {
  const submittedFields = Object.keys(patch).filter((field) => patch[field] !== undefined);
  return submittedFields.every((field) => COMPLETED_ORDER_SAFE_METADATA_FIELDS.has(field))
    ? "safe_metadata"
    : "high_risk";
}

export function isCompletedOrderSafeMetadataPatch(patch: Record<string, unknown>): boolean {
  return classifyTerminalOrderPatch(patch) === "safe_metadata";
}
