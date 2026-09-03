import type { TransactionalClient } from "../persistence/types.js";

const tables=["v2_proof_works","v2_proof_versions","v2_proof_version_artwork","v2_proof_responses","v2_proof_delivery_jobs"] as const;
const constraints=["v2_proof_works_order_line_uidx","v2_proof_works_order_line_tenant_fk","v2_proof_versions_work_sequence_uidx","v2_proof_version_artwork_assignment_file_tenant_fk","v2_proof_responses_version_uidx","v2_proof_responses_version_tenant_fk","v2_proof_delivery_version_uidx"] as const;
const triggers=["v2_proof_version_artwork_validate_trigger","v2_proof_version_immutable_validate_trigger","v2_proof_version_issuance_evidence_validate_trigger","v2_proof_response_immutable_validate_trigger"] as const;
export async function assertV2ProofingPhysicalPostconditions(client:TransactionalClient):Promise<void>{
  const [found,con,tg]=await Promise.all([
    client.query<{table_name:string}>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])",[tables]),
    client.query<{conname:string}>("SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])",[constraints]),
    client.query<{tgname:string}>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1::text[])",[triggers]),
  ]);
  const missing=[...tables.filter((x)=>!found.rows.some((r)=>r.table_name===x)),...constraints.filter((x)=>!con.rows.some((r)=>r.conname===x)),...triggers.filter((x)=>!tg.rows.some((r)=>r.tgname===x))];
  if(missing.length)throw Error(`V2 Proofing physical postconditions failed: ${missing.join(", ")}`);
}
