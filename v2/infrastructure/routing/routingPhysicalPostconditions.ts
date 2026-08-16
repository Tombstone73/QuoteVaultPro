import type { TransactionalClient } from "../persistence/types.js";

export type RoutingPhysicalPostcondition = Readonly<{ id: string; passed: boolean; detail: string }>;

const tables = ["v2_route_templates", "v2_route_template_steps", "v2_route_instances", "v2_route_instance_steps"] as const;
const constraints = [
  "v2_route_templates_revision_chk", "v2_route_templates_fingerprint_chk",
  "v2_route_template_steps_position_chk", "v2_route_template_steps_kind_chk", "v2_route_template_steps_template_tenant_fk",
  "product_types_routing_mode_chk", "product_types_routing_policy_chk", "product_types_default_route_template_tenant_fk",
  "v2_route_instances_work_kind_chk", "v2_route_instances_state_chk", "v2_route_instances_current_position_chk", "v2_route_instances_source_template_tenant_fk", "v2_route_instances_current_step_instance_fk",
  "v2_route_instances_order_tenant_fk", "v2_route_instances_order_line_tenant_fk",
  "v2_route_instance_steps_position_chk", "v2_route_instance_steps_kind_chk", "v2_route_instance_steps_instance_tenant_fk",
] as const;
const indexes = [
  "v2_route_templates_org_name_uidx", "v2_route_template_steps_template_position_uidx",
  "v2_route_instances_org_work_uidx", "v2_route_instance_steps_instance_position_uidx",
  "v2_route_templates_org_active_idx", "v2_route_instances_org_state_idx",
] as const;

export async function checkV2RoutingPhysicalPostconditions(client: TransactionalClient): Promise<RoutingPhysicalPostcondition[]> {
  const [foundTables, foundConstraints, foundIndexes, columns] = await Promise.all([
    client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [tables]),
    client.query<{ conname: string }>("SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])", [constraints]),
    client.query<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[])", [indexes]),
    client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('v2_route_instances','current_step_id'),('v2_route_instances','source_template_revision'),('v2_route_instance_steps','step_kind'),('v2_route_instance_steps','source_template_step_id'))"),
  ]);
  const tableSet = new Set(foundTables.rows.map((row) => row.table_name));
  const constraintSet = new Set(foundConstraints.rows.map((row) => row.conname));
  const indexMap = new Map(foundIndexes.rows.map((row) => [row.indexname, row.indexdef]));
  const columnMap = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  return [
    ...tables.map((id) => ({ id: `table:${id}`, passed: tableSet.has(id), detail: "required Routing identity table" })),
    ...constraints.map((id) => ({ id: `constraint:${id}`, passed: constraintSet.has(id), detail: "required Routing integrity constraint" })),
    ...indexes.map((id) => ({ id: `index:${id}`, passed: indexMap.has(id), detail: "required Routing index" })),
    ...["v2_route_templates_org_name_uidx", "v2_route_template_steps_template_position_uidx", "v2_route_instances_org_work_uidx", "v2_route_instance_steps_instance_position_uidx"].map((id) => ({ id: `unique-index:${id}`, passed: /\bUNIQUE\b/i.test(indexMap.get(id) ?? ""), detail: "physical uniqueness protection" })),
    { id: "column:v2_route_instances.current_step_id", passed: columnMap.get("v2_route_instances.current_step_id")?.data_type === "character varying" && columnMap.get("v2_route_instances.current_step_id")?.is_nullable === "YES", detail: "current position uses a nullable durable step identity for completion" },
    { id: "column:v2_route_instances.source_template_revision", passed: columnMap.get("v2_route_instances.source_template_revision")?.data_type === "bigint", detail: "frozen template revision is numeric" },
    { id: "column:v2_route_instance_steps.step_kind", passed: columnMap.get("v2_route_instance_steps.step_kind")?.data_type === "character varying", detail: "frozen step kind persists" },
    { id: "column-absent:v2_route_instance_steps.source_template_step_id", passed: !columnMap.has("v2_route_instance_steps.source_template_step_id"), detail: "frozen steps do not retain unstable mutable-template-step pointers" },
  ];
}

export function assertV2RoutingPhysicalPostconditions(findings: readonly RoutingPhysicalPostcondition[]): void {
  const failed = findings.filter((finding) => !finding.passed);
  if (failed.length) throw new Error(`V2 Routing physical postconditions failed: ${failed.map((finding) => finding.id).join(", ")}`);
}
