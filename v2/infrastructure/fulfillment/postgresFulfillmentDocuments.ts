import type { Pool } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { FulfillmentHandoffId, OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { ownerDocumentFilename, renderOwnerPdf, type OwnerPdfDocument } from "../documents/ownerPdfRenderer.js";
import { readTenantBranding } from "../documents/postgresTenantBranding.js";

type Row = Readonly<{ customer_id: string | null; snapshot: unknown }>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
const integer = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
const methodLabel = (value: string) => value === "pickup" ? "Pickup receipt" : "Packing slip";

/** Immutable handoff snapshot renderer. It never substitutes ordered or produced quantity for the recorded allocation. */
export class PostgresFulfillmentDocumentService {
  constructor(private readonly pool: Pool) {}
  private async row(organizationId: OrganizationId, handoffId: FulfillmentHandoffId): Promise<Row> {
    const result = await this.pool.query<Row>("SELECT h.customer_id,s.snapshot FROM v2_fulfillment_handoffs h JOIN v2_fulfillment_handoff_document_snapshots s ON s.organization_id=h.organization_id AND s.handoff_id=h.id WHERE h.organization_id=$1 AND h.id=$2", [organizationId, handoffId]);
    if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Fulfillment handoff document was not found.");
    return result.rows[0];
  }
  async customerId(organizationId: OrganizationId, handoffId: FulfillmentHandoffId) { return (await this.row(organizationId, handoffId)).customer_id ?? undefined; }
  async document(organizationId: OrganizationId, handoffId: FulfillmentHandoffId): Promise<OwnerPdfDocument> {
    const [branding, row] = await Promise.all([readTenantBranding(this.pool, organizationId), this.row(organizationId, handoffId)]);
    const snapshot = record(row.snapshot), method = string(snapshot.method) ?? "shipment", destination = record(snapshot.destination), lines = Array.isArray(snapshot.lines) ? snapshot.lines.map(record) : [];
    if (!lines.length) throw new V2ApplicationError("CONFLICT", "Fulfillment handoff document evidence is incomplete.");
    const destinationText = [string(destination.recipient), string(destination.company), string(destination.addressLine1), string(destination.addressLine2), [string(destination.city), string(destination.region)].filter(Boolean).join(", "), string(destination.postalCode), string(destination.country)].filter(Boolean).join(" · ");
    return { kind: method === "pickup" ? "pickup-receipt" : "packing-slip", title: `${methodLabel(method)} · ${string(snapshot.orderNumber) ?? "Order"}`, number: string(snapshot.orderNumber) ?? "Order", issuedAt: string(snapshot.completedAt)?.slice(0, 10) ?? new Date().toISOString().slice(0, 10), organization: branding, sections: [
      { heading: "Handoff", entries: [{ label: "Order", value: string(snapshot.orderNumber) ?? "Unavailable" }, { label: "Customer", value: string(snapshot.customer) ?? "Customer unavailable" }, ...(string(snapshot.purchaseOrder) ? [{ label: "Customer PO", value: string(snapshot.purchaseOrder)! }] : []), { label: "Actual handoff method", value: method === "pickup" ? "Customer pickup" : "Shipment" }, ...(string(snapshot.completedAt) ? [{ label: "Completed", value: string(snapshot.completedAt)! }] : [])] },
      { heading: "Items in this handoff", entries: lines.map((line) => ({ value: `${string(line.description) ?? "Line item"} · Qty ${integer(line.quantity)}` })) },
      ...(method === "shipment" && destinationText ? [{ heading: "Requested destination", entries: [{ value: destinationText }] }] : []),
      ...(string(snapshot.instructions) ? [{ heading: "Instructions", entries: [{ value: string(snapshot.instructions)! }] }] : []),
    ] };
  }
  async pdf(organizationId: OrganizationId, handoffId: FulfillmentHandoffId) { return renderOwnerPdf(await this.document(organizationId, handoffId)); }
  async filename(organizationId: OrganizationId, handoffId: FulfillmentHandoffId) { return ownerDocumentFilename(await this.document(organizationId, handoffId)); }
}
