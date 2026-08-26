import type { Pool } from "pg";

export type ArtworkWorkspaceFile = Readonly<{
  id: string;
  originalFilename: string;
  displayFilename: string;
  contentType: string;
  byteSize: number;
  source: "customer_upload" | "prepress_derived" | "imported";
  pageCount?: number;
  detectedWidthMicrons?: number;
  detectedHeightMicrons?: number;
  derivedFromArtworkFileId?: string;
  createdAt: string;
}>;
export type ArtworkWorkspaceAssignment = Readonly<{
  id: string; artworkFileId: string; orderId: string; orderLineId: string;
  purpose: "customer_supplied" | "production" | "proof" | "reference";
  side?: "front" | "back"; sourcePageIndex?: number; layerKey?: string; layerOrder?: number; createdAt: string;
}>;
export type ArtworkWorkspaceContext = Readonly<{
  assignment: ArtworkWorkspaceAssignment; orderNumber: string; customerId?: string; customerDisplayName: string; lineDescription: string;
}>;
export type ArtworkWorkspaceItem = ArtworkWorkspaceContext & Readonly<{ file: ArtworkWorkspaceFile }>;
export type ArtworkWorkspaceDetail = Readonly<{ file: ArtworkWorkspaceFile; assignments: readonly ArtworkWorkspaceContext[] }>;

type Row = Readonly<{
  assignment_id: string | null; artwork_file_id: string | null; order_id: string | null; order_line_id: string | null;
  purpose: ArtworkWorkspaceAssignment["purpose"] | null; side: "front" | "back" | null; source_page_index: number | null; layer_key: string | null; layer_order: number | null; assignment_created_at: Date | null;
  file_id: string; original_filename: string; display_filename: string; content_type: string; byte_size: string; source_kind: ArtworkWorkspaceFile["source"]; page_count: number | null; detected_width_microns: number | null; detected_height_microns: number | null; derived_from_artwork_file_id: string | null; file_created_at: Date;
  order_number: string | null; customer_id: string | null; customer_display_name: string | null; line_description: string | null;
}>;

const file = (row: Row): ArtworkWorkspaceFile => ({
  id: row.file_id, originalFilename: row.original_filename, displayFilename: row.display_filename, contentType: row.content_type,
  byteSize: Number(row.byte_size), source: row.source_kind,
  ...(row.page_count === null ? {} : { pageCount: row.page_count }),
  ...(row.detected_width_microns === null ? {} : { detectedWidthMicrons: row.detected_width_microns }),
  ...(row.detected_height_microns === null ? {} : { detectedHeightMicrons: row.detected_height_microns }),
  ...(row.derived_from_artwork_file_id ? { derivedFromArtworkFileId: row.derived_from_artwork_file_id } : {}), createdAt: row.file_created_at.toISOString(),
});
const context = (row: Row): ArtworkWorkspaceContext | undefined => {
  if (!row.assignment_id || !row.artwork_file_id || !row.order_id || !row.order_line_id || !row.purpose || !row.assignment_created_at || !row.order_number || !row.customer_display_name || row.line_description === null) return undefined;
  return {
    assignment: { id: row.assignment_id, artworkFileId: row.artwork_file_id, orderId: row.order_id, orderLineId: row.order_line_id, purpose: row.purpose, ...(row.side ? { side: row.side } : {}), ...(row.source_page_index === null ? {} : { sourcePageIndex: row.source_page_index }), ...(row.layer_key ? { layerKey: row.layer_key, layerOrder: row.layer_order! } : {}), createdAt: row.assignment_created_at.toISOString() },
    orderNumber: row.order_number, ...(row.customer_id ? { customerId: row.customer_id } : {}), customerDisplayName: row.customer_display_name, lineDescription: row.line_description,
  };
};
const select = `SELECT a.id assignment_id,a.artwork_file_id,a.order_document_id order_id,a.order_line_id,a.purpose,a.side,a.source_page_index,a.layer_key,a.layer_order,a.created_at assignment_created_at,
  f.id file_id,f.original_filename,f.display_filename,f.content_type,f.byte_size,f.source_kind,f.page_count,f.detected_width_microns,f.detected_height_microns,f.derived_from_artwork_file_id,f.created_at file_created_at,
  d.display_number order_number,c.id customer_id,COALESCE(c.display_name,c.company_name,'Customer') customer_display_name,l.description line_description
  FROM v2_artwork_files f`;
const joins = `LEFT JOIN v2_artwork_assignments a ON a.organization_id=f.organization_id AND a.artwork_file_id=f.id
  LEFT JOIN v2_sales_documents d ON d.organization_id=a.organization_id AND d.id=a.order_document_id
  LEFT JOIN v2_sales_document_lines l ON l.organization_id=a.organization_id AND l.id=a.order_line_id
  LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id`;

/** Artwork-owned, bounded operator catalog. Rows retain exact canonical file/assignment identity. */
export class PostgresArtworkWorkspaceReads {
  constructor(private readonly pool: Pool) {}
  async list(organizationId: string, query = ""): Promise<readonly ArtworkWorkspaceItem[]> {
    const pattern = `%${query.trim().slice(0, 120)}%`;
    const result = await this.pool.query<Row>(`${select}\n  JOIN v2_artwork_assignments a ON a.organization_id=f.organization_id AND a.artwork_file_id=f.id
  JOIN v2_sales_documents d ON d.organization_id=a.organization_id AND d.id=a.order_document_id
  JOIN v2_sales_document_lines l ON l.organization_id=a.organization_id AND l.id=a.order_line_id
  LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
  WHERE a.organization_id=$1 AND (f.display_filename ILIKE $2 OR d.display_number ILIKE $2 OR l.description ILIKE $2 OR COALESCE(c.display_name,c.company_name,'') ILIKE $2)
  ORDER BY a.created_at DESC,a.id LIMIT 100`, [organizationId, pattern]);
    return result.rows.flatMap((row) => { const assignment = context(row); return assignment ? [{ file: file(row), ...assignment }] : []; });
  }
  async get(organizationId: string, artworkFileId: string): Promise<ArtworkWorkspaceDetail | null> {
    const result = await this.pool.query<Row>(`${select}\n${joins}
  WHERE f.organization_id=$1 AND f.id=$2
  ORDER BY a.created_at DESC NULLS LAST,a.id`, [organizationId, artworkFileId]);
    const first = result.rows[0];
    if (!first) return null;
    return { file: file(first), assignments: result.rows.flatMap((row) => { const assignment = context(row); return assignment ? [assignment] : []; }) };
  }
  /** Internal delivery lookup: object identity never crosses the HTTP boundary. */
  async objectForDelivery(organizationId: string, artworkFileId: string): Promise<Readonly<{ objectKey: string; contentType: string; byteSize: number }> | null> {
    const result = await this.pool.query<{ object_key: string; content_type: string; byte_size: string }>("SELECT object_key,content_type,byte_size FROM v2_artwork_files WHERE organization_id=$1 AND id=$2 AND storage_provider='supabase'", [organizationId, artworkFileId]);
    const row = result.rows[0];
    return row ? { objectKey: row.object_key, contentType: row.content_type, byteSize: Number(row.byte_size) } : null;
  }
}
