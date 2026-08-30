import type { TransactionalClient } from "../persistence/types.js";

const tables = ["v2_artwork_files", "v2_artwork_assignments"] as const;
const constraints = [
  "v2_artwork_files_storage_identity_uidx", "v2_artwork_files_derived_from_tenant_fk", "v2_artwork_files_not_self_derived_chk",
  "v2_artwork_assignments_order_line_identity_uidx", "v2_artwork_assignments_file_tenant_fk", "v2_artwork_assignments_order_tenant_fk", "v2_artwork_assignments_order_line_tenant_fk", "v2_artwork_assignments_supersedes_tenant_fk",
] as const;
const indexes = ["v2_artwork_files_org_created_idx", "v2_artwork_assignments_org_order_line_idx", "v2_artwork_assignments_org_file_idx", "v2_artwork_assignments_one_successor_uidx", "v2_artwork_assignments_org_successor_idx"] as const;

export async function checkV2ArtworkPhysicalPostconditions(client: TransactionalClient): Promise<readonly Readonly<{ id: string; passed: boolean; detail: string }>[]> {
  const [foundTables, foundConstraints, foundIndexes, foundTriggers] = await Promise.all([
    client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])", [tables]),
    client.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])", [constraints]),
    client.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])", [indexes]),
    client.query<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE tgname=ANY($1::text[]) AND NOT tgisinternal", [["v2_artwork_file_lineage_validate_trigger", "v2_artwork_assignment_replacement_validate_trigger"]]),
  ]);
  const tableSet = new Set(foundTables.rows.map((r) => r.table_name)), constraintSet = new Set(foundConstraints.rows.map((r) => r.conname)), indexSet = new Set(foundIndexes.rows.map((r) => r.indexname)), triggerSet = new Set(foundTriggers.rows.map((r) => r.tgname));
  return [
    ...tables.map((id) => ({ id: `table:${id}`, passed: tableSet.has(id), detail: "required Artwork table" })),
    ...constraints.map((id) => ({ id: `constraint:${id}`, passed: constraintSet.has(id), detail: "required Artwork integrity constraint" })),
    ...indexes.map((id) => ({ id: `index:${id}`, passed: indexSet.has(id), detail: "required bounded Artwork index" })),
    { id: "trigger:v2_artwork_file_lineage_validate_trigger", passed: triggerSet.has("v2_artwork_file_lineage_validate_trigger"), detail: "lineage cycles are physically rejected" },
    { id: "trigger:v2_artwork_assignment_replacement_validate_trigger", passed: triggerSet.has("v2_artwork_assignment_replacement_validate_trigger"), detail: "replacement preserves immutable workflow provenance" },
  ];
}

export async function assertV2ArtworkPhysicalPostconditions(client: TransactionalClient): Promise<void> {
  const failed = (await checkV2ArtworkPhysicalPostconditions(client)).filter((finding) => !finding.passed);
  if (failed.length) throw new Error(`V2 Artwork physical postconditions failed: ${failed.map((f) => f.id).join(", ")}`);
}
