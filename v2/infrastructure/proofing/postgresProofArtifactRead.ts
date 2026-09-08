import type { Pool } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";

/**
 * Read-only delivery adapter for a proof's immutable evidence. It does not
 * own Artwork or generate a second proof file: the bound version/file pair is
 * verified before the canonical Artwork binary is read.
 */
export class PostgresProofArtifactRead {
  constructor(
    private readonly pool: Pool,
    private readonly artwork: Readonly<{
      file(organizationId: string, artworkFileId: string): Promise<Readonly<{ contentType: string; bytes: Buffer }> | null>;
    }>,
  ) {}

  async file(organizationId: string, proofVersionId: string, artworkFileId: string): Promise<Readonly<{ filename: string; contentType: string; bytes: Buffer }>> {
    const result = await this.pool.query<{ display_filename: string; content_type: string }>(
      `SELECT f.display_filename,f.content_type
       FROM v2_proof_version_artwork evidence
       JOIN v2_proof_versions version ON version.organization_id=evidence.organization_id AND version.id=evidence.proof_version_id
       JOIN v2_artwork_files f ON f.organization_id=evidence.organization_id AND f.id=evidence.artwork_file_id
       WHERE evidence.organization_id=$1 AND evidence.proof_version_id=$2 AND evidence.artwork_file_id=$3`,
      [organizationId, proofVersionId, artworkFileId],
    );
    const bound = result.rows[0];
    if (!bound) throw new V2ApplicationError("NOT_FOUND", "Proof artifact was not found.");
    const content = await this.artwork.file(organizationId, artworkFileId);
    if (!content) throw new V2ApplicationError("NOT_FOUND", "Proof artifact content is unavailable.");
    return { filename: bound.display_filename, contentType: content.contentType || bound.content_type, bytes: content.bytes };
  }
}
