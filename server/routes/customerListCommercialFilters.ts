import { z } from "zod";
import { CUSTOMER_CREDIT_LIMIT_FILTERS, CUSTOMER_TERMS_FILTERS } from "@shared/customerListCommercialFilters";
import { canManageCustomerCommercialConfiguration } from "../services/customerCommercialConfigurationAccess";

const filtersSchema = z.object({
  terms: z.enum(CUSTOMER_TERMS_FILTERS).optional(),
  creditLimit: z.enum(CUSTOMER_CREDIT_LIMIT_FILTERS).optional(),
});

export function parseCustomerListCommercialFilters(role: unknown, query: { terms?: unknown; creditLimit?: unknown }) {
  if ((query.terms !== undefined || query.creditLimit !== undefined) && !canManageCustomerCommercialConfiguration(role)) {
    return { ok: false as const, status: 403 as const, message: "Commercial customer filters require Owner or Admin permission." };
  }
  const parsed = filtersSchema.safeParse(query);
  if (!parsed.success) return { ok: false as const, status: 400 as const, message: "Invalid customer commercial filter" };
  return { ok: true as const, filters: parsed.data };
}
