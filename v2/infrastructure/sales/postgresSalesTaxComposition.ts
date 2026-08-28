import type { PoolClient } from "pg";
import { composeSalesTax, resolveTaxJurisdiction, type CommercialCharge, type FrozenTaxExemption, type SalesTaxComposition, type TenantTaxJurisdiction } from "../../src/modules/sales/taxComposition.js";
import type { RequestedFulfillment, SalesLineSnapshot, SalesOrderAdjustment } from "../../src/modules/sales/contracts.js";

/** Thin PostgreSQL adapter: configuration and Customer evidence are fetched
 * once then the pure Sales composer produces the frozen JSON evidence. */
export const composePostgresSalesTax = async (input: Readonly<{
  client: PoolClient;
  organizationId: string;
  customerId?: string;
  fulfillment?: RequestedFulfillment;
  lines: readonly SalesLineSnapshot[];
  adjustment?: SalesOrderAdjustment;
  charge?: CommercialCharge;
}>): Promise<SalesTaxComposition> => {
  const jurisdictions = await input.client.query<{
    id: string; name: string; country_code: string; region_code: string; postal_code: string | null; rate_basis_points: number; active: boolean; home_business: boolean; destination_methods: ("shipping"|"local_delivery")[];
  }>("SELECT id,name,country_code,region_code,postal_code,rate_basis_points,active,home_business,destination_methods FROM v2_sales_tax_jurisdictions WHERE organization_id=$1", [input.organizationId]);
  const configured: TenantTaxJurisdiction[] = jurisdictions.rows.map((row) => ({
    jurisdictionId: row.id, name: row.name, receiptLocation: { country: row.country_code, region: row.region_code, ...(row.postal_code ? { postalCode: row.postal_code } : {}) }, rateBasisPoints: row.rate_basis_points, active: row.active, homeBusiness: row.home_business, ...(!row.home_business ? { destinationMethods: row.destination_methods } : {}),
  }));
  const customer = input.customerId ? await input.client.query<{ is_tax_exempt: boolean; tax_exempt_reason: string | null; tax_exempt_certificate_ref: string | null }>(
    "SELECT is_tax_exempt,tax_exempt_reason,tax_exempt_certificate_ref FROM customers WHERE organization_id=$1 AND id=$2", [input.organizationId, input.customerId],
  ) : { rows: [] };
  const record = customer.rows[0];
  const exemption: FrozenTaxExemption = record?.is_tax_exempt
    ? { exempt: true, ...(record.tax_exempt_reason ? { reason: record.tax_exempt_reason } : {}), ...(record.tax_exempt_certificate_ref ? { certificateReference: record.tax_exempt_certificate_ref } : {}) }
    : { exempt: false };
  const fulfillment = input.fulfillment ?? { method: "pickup" as const };
  const destination = fulfillment.destination && fulfillment.destination.country && fulfillment.destination.region
    ? { country: fulfillment.destination.country, region: fulfillment.destination.region, ...(fulfillment.destination.postalCode ? { postalCode: fulfillment.destination.postalCode } : {}) }
    : undefined;
  return composeSalesTax({
    lines: input.lines.map((line) => ({ lineId: line.lineId, amountCents: line.sellingLineAmount.cents, taxable: line.taxability?.taxable ?? true })),
    adjustmentCents: input.adjustment?.cents,
    ...(input.charge ? { charges: [input.charge] } : {}), exemption,
    resolution: resolveTaxJurisdiction({ fulfillment: { method: fulfillment.method, ...(destination ? { destination } : {}) }, jurisdictions: configured }),
  });
};
