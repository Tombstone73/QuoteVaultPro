import type { ReconciliationStageDefinition } from "./types.js";

/**
 * M0185/M0186 are historically content-divergent. This stage must not replay
 * either file. It validates the already-established permission foundation and
 * the current V2 authority required by artwork/proof; incompatible identity
 * or template authority fails closed.
 */
export const r0268Permissions: ReconciliationStageDefinition = {
  id: "R0268",
  label: "Permission reconciliation and current V2 authority validation",
  migrationFiles: [],
  legacyDataPolicy:
    "Validation only. Do not replay M0185 or M0186, rewrite permission history, alter organization-customized sets, change staff/portal assignments, or infer authority from V1 roles. Existing template-derived grants are checked against the current V2 authority contract; any required repair requires an explicitly reviewed forward seed, never a blind overwrite.",
  postconditions: [
    { kind: "table", name: "v2_permission_capabilities" },
    { kind: "table", name: "v2_permission_set_templates" },
    { kind: "table", name: "v2_permission_sets" },
    { kind: "constraint", name: "v2_permission_sets_id_org_uidx", table: "v2_permission_sets" },
    { kind: "constraint", name: "v2_permission_set_capabilities_pkey", table: "v2_permission_set_capabilities" },
    {
      kind: "query",
      name: "required-artwork-proof-capability-identities",
      sql: "SELECT count(*) = 6 FROM v2_permission_capabilities WHERE (id,module,label) IN (('artwork.view','artwork','View artwork metadata and usages'),('artwork.adopt','artwork','Adopt stored artwork for OrderLine work'),('artwork.assign','artwork','Assign existing artwork to OrderLine work'),('proof.view','proofing','View proof work and proof history'),('proof.prepare','proofing','Start proof work and create proof versions'),('proof.issue','proofing','Issue proof versions for response'))",
    },
    {
      kind: "query",
      name: "no-incompatible-artwork-proof-capability-identities",
      sql: "SELECT NOT EXISTS (SELECT 1 FROM v2_permission_capabilities WHERE id IN ('artwork.view','artwork.adopt','artwork.assign','proof.view','proof.prepare','proof.issue') AND (id,module,label) NOT IN (('artwork.view','artwork','View artwork metadata and usages'),('artwork.adopt','artwork','Adopt stored artwork for OrderLine work'),('artwork.assign','artwork','Assign existing artwork to OrderLine work'),('proof.view','proofing','View proof work and proof history'),('proof.prepare','proofing','Start proof work and create proof versions'),('proof.issue','proofing','Issue proof versions for response')))",
    },
    {
      kind: "query",
      name: "required-staff-template-grants",
      sql: "SELECT NOT EXISTS (SELECT 1 FROM (VALUES ('owner','artwork.view'),('owner','artwork.adopt'),('owner','artwork.assign'),('owner','proof.view'),('owner','proof.prepare'),('owner','proof.issue'),('owner','proof.respond'),('administrator','artwork.view'),('administrator','artwork.adopt'),('administrator','artwork.assign'),('administrator','proof.view'),('administrator','proof.prepare'),('administrator','proof.issue'),('administrator','proof.respond'),('sales','artwork.view'),('sales','artwork.adopt'),('sales','artwork.assign'),('sales','proof.view'),('sales','proof.prepare'),('sales','proof.issue'),('sales','proof.respond')) required(template_key,capability_id) LEFT JOIN v2_permission_set_templates template ON template.template_key=required.template_key LEFT JOIN v2_permission_set_template_capabilities grant ON grant.template_id=template.id AND grant.capability_id=required.capability_id WHERE grant.template_id IS NULL)",
    },
    {
      kind: "query",
      name: "no-duplicate-permission-identities",
      sql: "SELECT NOT EXISTS (SELECT 1 FROM v2_permission_sets GROUP BY organization_id, normalized_name HAVING count(*) > 1) AND NOT EXISTS (SELECT 1 FROM v2_permission_set_capabilities GROUP BY organization_id, permission_set_id, capability_id HAVING count(*) > 1)",
    },
  ],
};
