export type InvoiceBulkAction = "send" | "markSent" | "approve" | "payment";
export type InvoiceBulkActionPermissions = Record<InvoiceBulkAction, boolean>;

/** Active tenant membership supplies V1 grants; assigned permission sets add
 * specific operations for Accounting and custom staff. Global user flags are
 * deliberately ignored. */
export function invoiceBulkActionPermissions(role: unknown, capabilities: readonly string[]): InvoiceBulkActionPermissions {
  const normalizedRole = String(role ?? "").trim().toLowerCase();
  const grants = new Set(capabilities);
  const administrator = normalizedRole === "owner" || normalizedRole === "admin";
  return {
    send: administrator,
    markSent: administrator,
    approve: administrator,
    payment: administrator || normalizedRole === "manager" || grants.has("payment.record"),
  };
}
