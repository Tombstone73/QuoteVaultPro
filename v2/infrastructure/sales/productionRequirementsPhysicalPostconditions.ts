import type { TransactionalClient } from "../persistence/types.js";
export async function assertV2ProductionRequirementsPhysicalPostconditions(client:TransactionalClient):Promise<void>{
  const [table,constraints,trigger]=await Promise.all([
    client.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='v2_sales_line_production_requirements'"),
    client.query<{conname:string}>("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])",[["v2_sales_line_production_requirements_identity_uidx","v2_sales_line_production_requirements_line_tenant_fk","v2_sales_document_lines_production_requirement_state_chk","v2_sales_document_lines_production_requirement_count_chk"]]),
    client.query<{tgname:string}>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])",[["v2_sales_production_requirement_history_validate_trigger","v2_sales_production_requirement_count_line_validate","v2_sales_production_requirement_count_rows_validate"]]),
  ]);
  if(!table.rows.length||constraints.rows.length!==4||trigger.rows.length!==3)throw Error("V2 production requirement physical postconditions failed.");
}
