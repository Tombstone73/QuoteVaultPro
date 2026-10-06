import { and, eq, sql } from "drizzle-orm";
import { invoiceLineItems, invoices, orderLineItems, orders } from "@shared/schema";

/** Child financial tables have no organization_id; require a correlated parent
 * ownership check on every repair read/delete/update, not just an earlier read. */
export function scopedOrderLine(orderId: string, organizationId: string) {
  return and(
    eq(orderLineItems.orderId, orderId),
    sql`exists (select 1 from ${orders} where ${orders.id} = ${orderLineItems.orderId} and ${orders.organizationId} = ${organizationId})`,
  );
}

export function scopedOrderLineId(lineId: string, organizationId: string) {
  return and(
    eq(orderLineItems.id, lineId),
    sql`exists (select 1 from ${orders} where ${orders.id} = ${orderLineItems.orderId} and ${orders.organizationId} = ${organizationId})`,
  );
}

export function scopedInvoiceLine(invoiceId: string, organizationId: string) {
  return and(
    eq(invoiceLineItems.invoiceId, invoiceId),
    sql`exists (select 1 from ${invoices} where ${invoices.id} = ${invoiceLineItems.invoiceId} and ${invoices.organizationId} = ${organizationId})`,
  );
}

export type RepairCandidate = { organizationId: string };

/** Fleet audits must select only the supplied tenant; document numbering is
 * advisory and never a substitute for this predicate. */
export function scopedFleetInvoice(organizationId: string) {
  if (!organizationId) throw new Error("An explicit target organization ID is required.");
  return eq(invoices.organizationId, organizationId);
}

export function scopedInvoiceIdentity(invoiceId: string, organizationId: string) {
  if (!invoiceId || !organizationId) throw new Error("Invoice ID and target organization ID are required.");
  return and(eq(invoices.id, invoiceId), scopedFleetInvoice(organizationId));
}

export function assertExclusiveTenantCandidates(
  targetOrganizationId: string,
  resolvedOrganizations: Array<{ id: string; name: string }>,
  candidates: RepairCandidate[],
) {
  if (!targetOrganizationId || resolvedOrganizations.length !== 1 || resolvedOrganizations[0]?.id !== targetOrganizationId) {
    throw new Error("Refusing repair: target organization must resolve exactly once by ID.");
  }
  const countsByOrganization = Object.fromEntries(
    Array.from(new Set(candidates.map((candidate) => candidate.organizationId)))
      .sort()
      .map((id) => [id, candidates.filter((candidate) => candidate.organizationId === id).length]),
  );
  if (candidates.some((candidate) => candidate.organizationId !== targetOrganizationId)) {
    throw new Error(`Refusing repair: candidate identity crosses organizations: ${JSON.stringify(countsByOrganization)}`);
  }
  if (candidates.length !== 1) {
    throw new Error(`Refusing repair: expected one target candidate, found ${candidates.length}.`);
  }
  return { organization: resolvedOrganizations[0]!, countsByOrganization };
}
