/**
 * Customer payment terms and credit limits are financial configuration. Keep
 * this small policy independent from route/database setup so every entry point
 * can apply the same owner-or-admin boundary.
 */
export function canManageCustomerCommercialConfiguration(role: unknown): boolean {
  return ["owner", "admin"].includes(String(role ?? "").trim().toLowerCase());
}
