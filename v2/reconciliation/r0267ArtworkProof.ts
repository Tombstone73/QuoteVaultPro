import type { ReconciliationStageDefinition } from "./types.js";

/**
 * Recreates the absent M0197--M0199 physical foundation only after R0265 has
 * established its Sales dependencies. There is intentionally no V1 artwork,
 * attachment, proof, or storage backfill here: legacy rows lack sufficient
 * canonical file identity and proof-history evidence for automatic import.
 */
export const r0267ArtworkProof: ReconciliationStageDefinition = {
  id: "R0267",
  label: "Artwork and proof physical foundation",
  migrationFiles: [
    "server/db/migrations_v2/0197_v2_artwork_domain_foundation.sql",
    "server/db/migrations_v2/0198_v2_artwork_storage_identity_hardening.sql",
    "server/db/migrations_v2/0199_v2_proofing_domain_foundation.sql",
  ],
  legacyDataPolicy:
    "DDL only. Do not copy V1 attachments, object URLs, proofs, or orphan-like artwork into V2. Record candidate counts separately; import is permitted only through a later evidence-complete, idempotent manifest with durable storage identity, organization, order line, source, and proof-history evidence.",
  postconditions: [
    { kind: "table", name: "v2_artwork_files" },
    { kind: "table", name: "v2_artwork_assignments" },
    { kind: "table", name: "v2_proof_works" },
    { kind: "table", name: "v2_proof_versions" },
    { kind: "table", name: "v2_proof_version_artwork" },
    { kind: "table", name: "v2_proof_responses" },
    { kind: "column", name: "storage_provider", table: "v2_artwork_files" },
    { kind: "column", name: "object_key", table: "v2_artwork_files" },
    { kind: "column", name: "byte_size", table: "v2_artwork_files" },
    { kind: "constraint", name: "v2_artwork_files_storage_identity_uidx", table: "v2_artwork_files" },
    { kind: "constraint", name: "v2_artwork_assignments_order_line_identity_uidx", table: "v2_artwork_assignments" },
    { kind: "constraint", name: "v2_proof_works_order_line_uidx", table: "v2_proof_works" },
    { kind: "constraint", name: "v2_proof_versions_work_sequence_uidx", table: "v2_proof_versions" },
    { kind: "constraint", name: "v2_proof_responses_version_uidx", table: "v2_proof_responses" },
    { kind: "index", name: "v2_artwork_files_org_created_idx", table: "v2_artwork_files" },
    { kind: "index", name: "v2_proof_versions_org_work_sequence_idx", table: "v2_proof_versions" },
    { kind: "function", name: "v2_artwork_file_lineage_validate" },
    { kind: "function", name: "v2_proof_version_artwork_validate" },
    { kind: "function", name: "v2_proof_version_immutable_validate" },
    { kind: "function", name: "v2_proof_response_immutable_validate" },
    { kind: "trigger", name: "v2_artwork_file_lineage_validate_trigger", table: "v2_artwork_files" },
    { kind: "trigger", name: "v2_proof_version_artwork_validate_trigger", table: "v2_proof_version_artwork" },
    { kind: "trigger", name: "v2_proof_version_immutable_validate_trigger", table: "v2_proof_versions" },
    { kind: "trigger", name: "v2_proof_response_immutable_validate_trigger", table: "v2_proof_responses" },
    {
      kind: "query",
      name: "no-automatic-legacy-artwork-import",
      sql: "SELECT NOT EXISTS (SELECT 1 FROM v2_artwork_files) AND NOT EXISTS (SELECT 1 FROM v2_artwork_assignments) AND NOT EXISTS (SELECT 1 FROM v2_proof_works)",
    },
  ],
};
