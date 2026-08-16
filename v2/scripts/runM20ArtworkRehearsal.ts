import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { PostgresArtworkTransactionRunner } from "../infrastructure/artwork/postgresArtworkTransaction.js";
import { assertV2ArtworkPhysicalPostconditions } from "../infrastructure/artwork/artworkPhysicalPostconditions.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { ArtworkApplicationService } from "../src/modules/artwork/artworkApplication.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";
import type { Capability } from "../src/authorization/capabilities.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const context = (organizationId: string, userId: string, id: string, capabilities: readonly Capability[] = ["artwork.view", "artwork.adopt", "artwork.assign"]) => ({
  organizationId, operationId: `m20:${id}`, businessRequest: { id, payloadFingerprint: "context" },
  principal: { kind: "staff" as const, organizationId, userId, authority: { membershipId: `m20-membership-${userId}`, capabilities } },
});
const usage = (orderId: string, lineId: string, purpose: "customer_supplied" | "production" = "production", more: object = {}) => ({ orderId: brandedId<"OrderId">(orderId), orderLineId: brandedId<"OrderLineId">(lineId), purpose, side: "front" as const, ...more });
const input = (request: string, objectKey: string, orderId: string, lineId: string, more: object = {}) => ({ businessRequestId: request, objectReference: { storageProvider: "clone", objectKey }, originalFilename: "sign.pdf", contentType: "application/pdf", byteSize: 100, source: "customer_upload" as const, usage: usage(orderId,lineId), ...more });

async function main() {
  const pool = new Pool({ connectionString: requireV2M0CloneDatabaseUrl(), max: 4, application_name: "m20-artwork-rehearsal" });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    const client = await pool.connect();
    try {
      await assertV2ArtworkPhysicalPostconditions(client);
      const x=randomUUID(), org=`m20-org-${x}`, other=`m20-other-${x}`, user=`m20-user-${x}`, order=`m20-order-${x}`, line=`m20-line-${x}`, otherOrder=`m20-order-other-${x}`, otherLine=`m20-line-other-${x}`, quote=`m20-quote-${x}`, quoteLine=`m20-quote-line-${x}`, product=`m20-product-${x}`, otherProduct=`m20-product-other-${x}`, type=`m20-type-${x}`, otherType=`m20-type-other-${x}`, customer=`m20-customer-${x}`, otherCustomer=`m20-customer-other-${x}`, routeTemplate=`m20-template-${x}`, routeInstance=`m20-route-${x}`, routeStep=`m20-route-step-${x}`;
      await client.query("BEGIN");
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M20',$2),($3,'M20 Other',$4)",[org,`m20-${x}`,other,`m20-other-${x}`]);
      await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
      await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'M20','M20',true,'active'),($3,$4,'M20 Other','M20 Other',true,'active')",[customer,org,otherCustomer,other]);
      await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'M20','no_route'),($3,$4,'M20 Other','no_route')",[type,org,otherType,other]);
      await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'M20','M20',true,'quantity_only',$3),($4,$5,'M20 Other','M20 Other',true,'quantity_only',$6)",[product,org,type,otherProduct,other,otherType]);
      for (const [organizationId,orderId,lineId,customerId,productId] of [[org,order,line,customer,product],[other,otherOrder,otherLine,otherCustomer,otherProduct]] as const) {
        await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'order',1,$3,$4,'USD','{}'::jsonb)",[orderId,organizationId,`ORD-${orderId}`,customerId]);
        await client.query("INSERT INTO v2_sales_order_details(document_id,organization_id) VALUES($1,$2)",[orderId,organizationId]);
        await client.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision) VALUES($1,$2,$3,0,$4,'M20 line',1,'USD',100,100,100,100,'m20-pricing','sha256:m20','{}'::jsonb,'{}'::jsonb,'{}'::jsonb)",[lineId,organizationId,orderId,productId]);
      }
      await client.query("INSERT INTO v2_sales_documents(id,organization_id,document_kind,business_number,display_number,customer_id,currency,terms_json) VALUES($1,$2,'quote',2,$3,$4,'USD','{}'::jsonb)",[quote,org,`QUO-${quote}`,customer]);
      await client.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)",[quote,org]);
      await client.query("INSERT INTO v2_sales_document_lines(id,organization_id,document_id,position,product_id,description,quantity,currency,calculated_unit_cents,calculated_line_cents,selling_unit_cents,selling_line_cents,pricing_result_id,pricing_evidence_fingerprint,resolved_configuration,pricing_result,selling_price_decision) VALUES($1,$2,$3,0,$4,'M20 quote line',1,'USD',100,100,100,100,'m20-quote-pricing','sha256:m20-quote','{}'::jsonb,'{}'::jsonb,'{}'::jsonb)",[quoteLine,org,quote,product]);
      await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'M20 frozen route','m20-frozen-route','sha256:m20-route')",[routeTemplate,org]);
      await client.query("INSERT INTO v2_route_instances(id,organization_id,order_document_id,order_line_id,source_template_id,source_template_revision,source_template_fingerprint,route_state,current_step_id) VALUES($1,$2,$3,$4,$5,1,'sha256:m20-route','pending',$6)",[routeInstance,org,order,line,routeTemplate,routeStep]);
      await client.query("INSERT INTO v2_route_instance_steps(id,organization_id,route_instance_id,position,step_kind) VALUES($1,$2,$3,0,'prepress')",[routeStep,org,routeInstance]);
      await client.query("COMMIT");
      const service=new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool));
      const routeBefore=await client.query("SELECT id,revision,route_state,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND id=$2",[org,routeInstance]);
      const adopted=await service.adopt(context(org,user,"adopt"),input("adopt","objects/a",order,line,{pageCount:2,usage:usage(order,line,"customer_supplied")})); assert(adopted.ok,"customer artwork adoption failed"); if(!adopted.ok)return;
      const production=await service.assign(context(org,user,"production"),{businessRequestId:"production",artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line)});assert(production.ok,"same file production assignment failed");
      const back=await service.assign(context(org,user,"back"),{businessRequestId:"back",artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line,"production",{side:"back",sourcePageIndex:1})});assert(back.ok,"same file back assignment failed");
      const layerWhite=await service.assign(context(org,user,"layer-white"),{businessRequestId:"layer-white",artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line,"production",{layerKey:"white",layerOrder:0})});assert(layerWhite.ok,"layer assignment failed");
      const derived=await service.derive(context(org,user,"derive"),{...input("derive","objects/b",order,line,{source:"prepress_derived",usage:usage(order,line,"production",{side:"back"})}),derivedFromArtworkFileId:adopted.value.artworkFile.id});assert(derived.ok && derived.value.artworkFile.derivedFromArtworkFileId===adopted.value.artworkFile.id,"derived Artwork lineage failed");
      const usageRead=await service.listForOrderLine(context(org,user,"read"),line);assert(usageRead.ok && usageRead.value.length===5,"bounded OrderLine Artwork projection mismatch");
      const replay=await service.assign(context(org,user,"production"),{businessRequestId:"production",artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line)});assert(replay.ok && replay.value.assignment.id===production.value?.assignment.id,"assignment replay diverged");
      const duplicate=await service.assign(context(org,user,"duplicate-semantic"),{businessRequestId:"duplicate-semantic",artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line)});assert(duplicate.ok && duplicate.value.assignment.id===production.value?.assignment.id,"duplicate semantic assignment did not converge");
      const concurrentId="concurrent";const concurrentInput={businessRequestId:concurrentId,artworkFileId:adopted.value.artworkFile.id,usage:usage(order,line,"production",{layerKey:"ink",layerOrder:1})};const concurrent=await Promise.all([service.assign(context(org,user,concurrentId),concurrentInput),service.assign(context(org,user,concurrentId),concurrentInput)]);assert(concurrent.every((v)=>v.ok)&&concurrent[0]?.ok&&concurrent[1]?.ok&&concurrent[0].value.assignment.id===concurrent[1].value.assignment.id,"concurrent idempotent assignment did not converge");
      const foreignRead=await service.readFile(context(other,user,"foreign-read"),adopted.value.artworkFile.id);assert(!foreignRead.ok&&foreignRead.error.code==="NOT_FOUND","cross-tenant Artwork read leaked");
      const foreignAssign=await service.assign(context(other,user,"foreign-assign"),{businessRequestId:"foreign-assign",artworkFileId:adopted.value.artworkFile.id,usage:usage(otherOrder,otherLine)});assert(!foreignAssign.ok&&foreignAssign.error.code==="NOT_FOUND","cross-tenant assignment was accepted");
      const denied=await service.adopt(context(org,user,"denied",[]),input("denied","objects/denied",order,line));assert(!denied.ok&&denied.error.code==="FORBIDDEN","permission denial was accepted");
      const audit=await client.query<{count:string}>("SELECT count(*) FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",[org,adopted.value.artworkFile.id]);assert(Number(audit.rows[0]?.count)>=2,"Artwork Audit rows missing");
      const attribution=await client.query<{count:string}>("SELECT count(*) FROM v2_principal_attributions WHERE organization_id=$1 AND resource_id=$2",[org,adopted.value.artworkFile.id]);assert(Number(attribution.rows[0]?.count)>=2,"Artwork attribution rows missing");
      const concurrentRequest=await client.query<{status:string;result_resource_id:string}>("SELECT status,result_resource_id FROM v2_operation_requests WHERE organization_id=$1 AND operation='artwork.assign.v1' AND business_request_id=$2",[org,concurrentId]);assert(concurrentRequest.rows.length===1 && concurrentRequest.rows[0]?.status==="succeeded" && concurrentRequest.rows[0]?.result_resource_id===adopted.value.artworkFile.id,"concurrent M0 result was inconsistent");
      await assert.rejects(client.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind,derived_from_artwork_file_id) VALUES($1,$2,'clone','objects/cross','x','x','application/pdf',1,'prepress_derived',$3)",[randomUUID(),other,adopted.value.artworkFile.id]),/foreign key/i,"cross-org lineage physical FK failed");
      // The recursive trigger may reject this before the row-local CHECK; both
      // paths are valid physical enforcement of prohibited self lineage.
      await assert.rejects(client.query("INSERT INTO v2_artwork_files(id,organization_id,storage_provider,object_key,original_filename,display_filename,content_type,byte_size,source_kind,derived_from_artwork_file_id) VALUES($1,$2,'clone','objects/self','x','x','application/pdf',1,'prepress_derived',$1)",["m20-self",org]),/self|cycle|check/i,"self lineage physical check failed");
      assert(derived.ok,"derived fixture missing");
      await assert.rejects(client.query("UPDATE v2_artwork_files SET derived_from_artwork_file_id=$1 WHERE organization_id=$2 AND id=$3",[derived.value.artworkFile.id,org,adopted.value.artworkFile.id]),/cycle/i,"derived lineage cycle was accepted");
      await assert.rejects(client.query("INSERT INTO v2_artwork_assignments(organization_id,artwork_file_id,order_document_id,order_line_id,purpose,identity_fingerprint) VALUES($1,$2,$3,$4,'production','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')",[other,adopted.value.artworkFile.id,otherOrder,otherLine]),/foreign key/i,"cross-org OrderLine assignment physical FK failed");
      await assert.rejects(client.query("INSERT INTO v2_artwork_assignments(organization_id,artwork_file_id,order_document_id,order_line_id,purpose,identity_fingerprint) VALUES($1,$2,$3,$4,'production','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')",[org,adopted.value.artworkFile.id,quote,quoteLine]),/foreign key/i,"Quote-line attachment was accepted");
      await assert.rejects(client.query("DELETE FROM v2_artwork_files WHERE organization_id=$1 AND id=$2",[org,adopted.value.artworkFile.id]),/foreign key/i,"restricted Artwork deletion was accepted");
      const routeAfter=await client.query("SELECT id,revision,route_state,current_step_id FROM v2_route_instances WHERE organization_id=$1 AND id=$2",[org,routeInstance]);assert.deepEqual(routeAfter.rows,routeBefore.rows,"Artwork attachment mutated frozen Routing identity");
      const before=await client.query<{files:string;assignments:string;operations:string;audits:string;attributions:string}>("SELECT (SELECT count(*) FROM v2_artwork_files WHERE organization_id=$1) files,(SELECT count(*) FROM v2_artwork_assignments WHERE organization_id=$1) assignments,(SELECT count(*) FROM v2_operation_requests WHERE organization_id=$1) operations,(SELECT count(*) FROM v2_audit_events WHERE organization_id=$1) audits,(SELECT count(*) FROM v2_principal_attributions WHERE organization_id=$1) attributions",[org]);const failed=await new ArtworkApplicationService(new PostgresArtworkTransactionRunner(pool,{afterFile:async()=>{throw Error("injected rollback");}})).adopt(context(org,user,"rollback"),input("rollback","objects/rollback",order,line));const after=await client.query<{files:string;assignments:string;operations:string;audits:string;attributions:string}>("SELECT (SELECT count(*) FROM v2_artwork_files WHERE organization_id=$1) files,(SELECT count(*) FROM v2_artwork_assignments WHERE organization_id=$1) assignments,(SELECT count(*) FROM v2_operation_requests WHERE organization_id=$1) operations,(SELECT count(*) FROM v2_audit_events WHERE organization_id=$1) audits,(SELECT count(*) FROM v2_principal_attributions WHERE organization_id=$1) attributions",[org]);assert(!failed.ok&&JSON.stringify(before.rows)===JSON.stringify(after.rows),"rollback left Artwork, Audit, attribution, or operation residue");
      console.log("[m2.0] Artwork PostgreSQL clone rehearsal passed.");
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((error)=>{console.error(`[m2.0] rehearsal failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);process.exitCode=1;});
