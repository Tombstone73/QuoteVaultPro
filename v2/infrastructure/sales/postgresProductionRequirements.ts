import type { PoolClient } from "pg";
import type { SalesLineSnapshot } from "../../src/modules/sales/contracts.js";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";
import { productionRequirementSnapshot, type ProductionRequirementSnapshot, type ProductionUnitRequirement } from "../../src/modules/shared/productionRequirements.js";

const snapshot=(line:SalesLineSnapshot):ProductionRequirementSnapshot=>productionRequirementSnapshot(line.resolvedConfiguration.productionRequirements);
/** Sales persists Product/PBV2-resolved evidence; it never derives requirements from Artwork. */
export async function synchronizeProductionRequirements(client:PoolClient,organizationId:OrganizationId,documentId:string,line:SalesLineSnapshot):Promise<void>{
  const frozen=snapshot(line), fingerprint=frozen.state==="configured"?frozen.specificationFingerprint:null;
  const count=frozen.state==="configured"?frozen.units.length:0;
  const changed=await client.query("UPDATE v2_sales_document_lines SET production_requirement_state=$4,production_requirement_fingerprint=$5,production_requirement_count=$6 WHERE organization_id=$1 AND document_id=$2 AND id=$3 AND (production_requirement_state IS DISTINCT FROM $4 OR production_requirement_fingerprint IS DISTINCT FROM $5 OR production_requirement_count IS DISTINCT FROM $6)",[organizationId,documentId,line.lineId,frozen.state,fingerprint,count]);
  if(changed.rowCount===0)return;
  await client.query("DELETE FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND document_id=$2 AND order_line_id=$3",[organizationId,documentId,line.lineId]);
  if(frozen.state!=="configured")return;
  for(const requirement of frozen.units as readonly ProductionUnitRequirement[])await client.query("INSERT INTO v2_sales_line_production_requirements(organization_id,document_id,order_line_id,requirement_key,side,source_page_index,layer_key,layer_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[organizationId,documentId,line.lineId,requirement.key,requirement.side??null,requirement.sourcePageIndex??null,requirement.layerKey??null,requirement.layerOrder??null]);
}
export async function removeProductionRequirementsForAbsentLines(client:PoolClient,organizationId:OrganizationId,documentId:string,retainedLineIds:readonly string[]):Promise<void>{
  if(retainedLineIds.length)await client.query("DELETE FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND document_id=$2 AND order_line_id <> ALL($3::text[])",[organizationId,documentId,retainedLineIds]);
  else await client.query("DELETE FROM v2_sales_line_production_requirements WHERE organization_id=$1 AND document_id=$2",[organizationId,documentId]);
}
