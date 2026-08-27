import type { Pool } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { salesConfigurationPresentation } from "../../src/modules/sales/configurationPresentation.js";
import type { OrganizationId, ProductionWorkId } from "../../src/modules/shared/commercialValues.js";
import { ownerDocumentFilename, renderOwnerPdf, type OwnerPdfDocument } from "../documents/ownerPdfRenderer.js";
import { readTenantBranding } from "../documents/postgresTenantBranding.js";

type Row = Readonly<{ number: string; customer: string | null; po: string | null; due: string | null; description: string; configuration: unknown; ordered_quantity: number; completed_quantity: string; requirement_key: string; side: "front" | "back" | null; source_page_index: number | null; layer_key: string | null; layer_order: number | null; station: string | null; materials: string | null }>;
const text = (value: string | null | undefined) => value?.trim() || undefined;
const title = (value: string) => value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
const requirement = (row: Row) => [row.side ? title(row.side) : undefined, row.source_page_index === null ? undefined : `Page ${row.source_page_index + 1}`, row.layer_key ? `${row.layer_key}${row.layer_order === null ? "" : ` ${row.layer_order + 1}`}` : undefined].filter(Boolean).join(" · ") || row.requirement_key;

/** Production-owned operational projection. It reads frozen line/work facts and never exposes Artwork storage identities. */
export class PostgresProductionDocumentService {
  constructor(private readonly pool: Pool) {}
  async traveler(organizationId: OrganizationId, productionWorkId: ProductionWorkId): Promise<OwnerPdfDocument> {
    const [branding, result] = await Promise.all([readTenantBranding(this.pool, organizationId), this.pool.query<Row>(`SELECT d.display_number number,COALESCE(NULLIF(btrim(c.display_name),''),NULLIF(btrim(c.company_name),'')) customer,d.purchase_order_number po,d.requested_due_date::text due,l.description,l.resolved_configuration configuration,w.ordered_quantity,
      COALESCE((SELECT sum(a.good_quantity) FROM v2_production_attempts a WHERE a.organization_id=w.organization_id AND a.production_work_id=w.id AND a.completed_at IS NOT NULL),0)::text completed_quantity,
      w.requirement_key,w.side,w.source_page_index,w.layer_key,w.layer_order,
      (SELECT a.station_key FROM v2_production_attempts a WHERE a.organization_id=w.organization_id AND a.production_work_id=w.id ORDER BY a.sequence DESC LIMIT 1) station,
      (SELECT string_agg(DISTINCT concat_ws(' ',r.material_name_snapshot,r.material_sku_snapshot),', ' ORDER BY concat_ws(' ',r.material_name_snapshot,r.material_sku_snapshot)) FROM v2_order_line_material_requirements r WHERE r.organization_id=w.organization_id AND r.order_line_id=w.order_line_id) materials
      FROM v2_production_works w JOIN v2_sales_documents d ON d.organization_id=w.organization_id AND d.id=w.order_document_id AND d.document_kind='order'
      JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
      JOIN v2_sales_document_lines l ON l.organization_id=w.organization_id AND l.id=w.order_line_id AND l.document_id=w.order_document_id
      LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
      WHERE w.organization_id=$1 AND w.id=$2`, [organizationId, productionWorkId])]);
    const row = result.rows[0];
    if (!row) throw new V2ApplicationError("NOT_FOUND", "Production work was not found.");
    return {
      kind: "traveler", title: `Production traveler · ${row.number}`, number: row.number, issuedAt: new Date().toISOString().slice(0, 10), organization: branding,
      sections: [
        { heading: "Job", entries: [{ label: "Order", value: row.number }, ...(text(row.customer) ? [{ label: "Customer", value: text(row.customer)! }] : []), ...(text(row.po) ? [{ label: "Customer PO", value: text(row.po)! }] : []), ...(text(row.due) ? [{ label: "Requested due", value: text(row.due)! }] : [])] },
        { heading: "Production work", entries: [{ label: "Line", value: row.description }, { label: "Required unit", value: requirement(row) }, { label: "Quantity ordered", value: String(row.ordered_quantity) }, { label: "Completed good quantity", value: row.completed_quantity }, { label: "Station", value: row.station ? title(row.station) : "Not started" }] },
        { heading: "Specifications", entries: [{ label: "Configuration", value: salesConfigurationPresentation((row.configuration && typeof row.configuration === "object" && !Array.isArray(row.configuration) ? row.configuration : {}) as Record<string, unknown>) || "No additional configuration" }, ...(text(row.materials) ? [{ label: "Material", value: text(row.materials)! }] : []), { label: "Artwork", value: `Artwork attached${row.side ? ` · ${title(row.side)}` : ""}` }] },
      ],
    };
  }
  async travelerPdf(organizationId: OrganizationId, productionWorkId: ProductionWorkId) { return renderOwnerPdf(await this.traveler(organizationId, productionWorkId)); }
  async filename(organizationId: OrganizationId, productionWorkId: ProductionWorkId) { return ownerDocumentFilename(await this.traveler(organizationId, productionWorkId)); }
}
