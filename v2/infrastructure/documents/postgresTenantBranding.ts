import type { Pool, PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";
import type { TenantBranding } from "./ownerPdfRenderer.js";

type Row = Readonly<{ name: string; address: string | null; physical_address: unknown; remittance_address: unknown; phone: string | null; email: string | null; website: string | null; invoice_footer_note: string | null; invoice_payment_instructions: string | null; checks_payable_to: string | null }>;
const value = (input: string | null) => input?.trim() || undefined;
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
const address = (input: unknown, fallback: string | null = null) => {
  const source = record(input); const text = (name: string) => typeof source[name] === "string" && source[name].trim() ? source[name].trim() : undefined;
  const locality = [text("city"), [text("state") ?? text("region"), text("postalCode")].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [text("line1"), text("line2"), locality, text("country")].filter(Boolean).join("\n") || value(fallback);
};

/** Canonical tenant presentation projection used by every server-rendered document. */
export const readTenantBranding = async (client: Pool | PoolClient, organizationId: OrganizationId): Promise<TenantBranding> => {
  const result = await client.query<Row>("SELECT COALESCE(NULLIF(btrim(cs.company_display_name),''),NULLIF(btrim(cs.company_name),''),o.name) name,cs.address,cs.physical_address,cs.remittance_address,cs.phone,cs.email,cs.website,cs.invoice_footer_note,cs.invoice_payment_instructions,cs.checks_payable_to FROM organizations o LEFT JOIN company_settings cs ON cs.organization_id=o.id WHERE o.id=$1", [organizationId]);
  const row = result.rows[0];
  if (!row) throw new V2ApplicationError("NOT_FOUND", "Organization was not found.");
  const businessAddress = address(row.physical_address, row.address);
  const remittanceAddress = address(row.remittance_address);
  return { name: row.name, ...(businessAddress ? { address: businessAddress } : {}), ...(value(row.phone) ? { phone: value(row.phone) } : {}), ...(value(row.email) ? { email: value(row.email) } : {}), ...(value(row.website) ? { website: value(row.website) } : {}), ...(value(row.invoice_footer_note) ? { footerNote: value(row.invoice_footer_note) } : {}), ...(value(row.invoice_payment_instructions) ? { paymentInstructions: value(row.invoice_payment_instructions) } : {}), ...(value(row.checks_payable_to) ? { checksPayableTo: value(row.checks_payable_to) } : {}), ...(remittanceAddress ? { remittanceAddress } : {}) };
};
