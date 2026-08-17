import type { Pool } from "pg";

export type ArtworkWorkspaceItem = Readonly<{
  assignment: Readonly<{ id: string; artworkFileId: string; orderId: string; orderLineId: string; purpose: "customer_supplied" | "production" | "proof" | "reference"; side?: "front" | "back"; sourcePageIndex?: number; layerKey?: string; layerOrder?: number; createdAt: string }>;
  file: Readonly<{ id: string; displayFilename: string; contentType: string; byteSize: number; source: "customer_upload" | "prepress_derived" | "imported"; derivedFromArtworkFileId?: string; createdAt: string }>;
  orderNumber: string;
  customerDisplayName: string;
  lineDescription: string;
}>;
type Row = Readonly<{ assignment_id:string; artwork_file_id:string; order_id:string; order_line_id:string; purpose:ArtworkWorkspaceItem["assignment"]["purpose"]; side:"front"|"back"|null; source_page_index:number|null; layer_key:string|null; layer_order:number|null; assignment_created_at:Date; file_id:string; display_filename:string; content_type:string; byte_size:string; source_kind:ArtworkWorkspaceItem["file"]["source"]; derived_from_artwork_file_id:string|null; file_created_at:Date; order_number:string; customer_display_name:string; line_description:string }>;

/** Artwork-owned, bounded operator catalog. Every row is an existing file usage; it creates no queue state. */
export class PostgresArtworkWorkspaceReads {
  constructor(private readonly pool: Pool) {}
  async list(organizationId: string, query = ""): Promise<readonly ArtworkWorkspaceItem[]> {
    const pattern = `%${query.trim().slice(0, 120)}%`;
    const result = await this.pool.query<Row>(`SELECT a.id assignment_id,a.artwork_file_id,a.order_document_id order_id,a.order_line_id,a.purpose,a.side,a.source_page_index,a.layer_key,a.layer_order,a.created_at assignment_created_at,
      f.id file_id,f.display_filename,f.content_type,f.byte_size,f.source_kind,f.derived_from_artwork_file_id,f.created_at file_created_at,
      d.display_number order_number,COALESCE(c.display_name,c.company_name,'Customer') customer_display_name,l.description line_description
      FROM v2_artwork_assignments a JOIN v2_artwork_files f ON f.organization_id=a.organization_id AND f.id=a.artwork_file_id
      JOIN v2_sales_documents d ON d.organization_id=a.organization_id AND d.id=a.order_document_id
      JOIN v2_sales_document_lines l ON l.organization_id=a.organization_id AND l.id=a.order_line_id
      LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
      WHERE a.organization_id=$1 AND (f.display_filename ILIKE $2 OR d.display_number ILIKE $2 OR l.description ILIKE $2 OR COALESCE(c.display_name,c.company_name,'') ILIKE $2)
      ORDER BY a.created_at DESC,a.id LIMIT 100`, [organizationId, pattern]);
    return result.rows.map((row) => ({ assignment: { id: row.assignment_id, artworkFileId: row.artwork_file_id, orderId: row.order_id, orderLineId: row.order_line_id, purpose: row.purpose, ...(row.side ? { side: row.side } : {}), ...(row.source_page_index === null ? {} : { sourcePageIndex: row.source_page_index }), ...(row.layer_key ? { layerKey: row.layer_key, layerOrder: row.layer_order! } : {}), createdAt: row.assignment_created_at.toISOString() }, file: { id: row.file_id, displayFilename: row.display_filename, contentType: row.content_type, byteSize: Number(row.byte_size), source: row.source_kind, ...(row.derived_from_artwork_file_id ? { derivedFromArtworkFileId: row.derived_from_artwork_file_id } : {}), createdAt: row.file_created_at.toISOString() }, orderNumber: row.order_number, customerDisplayName: row.customer_display_name, lineDescription: row.line_description }));
  }
}
