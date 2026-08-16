import type { TransactionalClient } from "../persistence/types.js";

const tables=["v2_prepress_units"] as const;
const constraints=["v2_prepress_units_assignment_uidx","v2_prepress_units_order_line_tenant_fk","v2_prepress_units_assignment_file_tenant_fk"] as const;
const triggers=["v2_prepress_unit_validate_trigger"] as const;
export async function assertV2PrepressPhysicalPostconditions(client:TransactionalClient):Promise<void>{
  const [found,con,tg]=await Promise.all([
    client.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])",[tables]),
    client.query<{conname:string}>("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])",[constraints]),
    client.query<{tgname:string}>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])",[triggers]),
  ]);
  const missing=[...tables.filter((x)=>!found.rows.some((r)=>r.table_name===x)),...constraints.filter((x)=>!con.rows.some((r)=>r.conname===x)),...triggers.filter((x)=>!tg.rows.some((r)=>r.tgname===x))];
  if(missing.length)throw Error(`V2 Prepress physical postconditions failed: ${missing.join(", ")}`);
}
