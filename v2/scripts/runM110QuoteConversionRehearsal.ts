import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { assertV2CommercialPhysicalPostconditions, checkV2CommercialPhysicalPostconditions } from "../infrastructure/sales/commercialPhysicalPostconditions.js";
import { PostgresQuoteTransactionRunner } from "../infrastructure/sales/postgresQuoteTransaction.js";
import { PostgresOrderTransactionRunner } from "../infrastructure/sales/postgresOrderTransaction.js";
import { PostgresQuoteConversionTransactionRunner } from "../infrastructure/sales/postgresQuoteConversionTransaction.js";
import { PostgresPermissionAuthorityReader } from "../infrastructure/authorization/postgresPermissionAuthorityRead.js";
import { PermissionSetPrincipalIssuer } from "../src/authorization/permissionSets.js";
import { QuoteApplicationService } from "../src/modules/sales/quoteApplication.js";
import { QuoteConversionApplicationService } from "../src/modules/sales/quoteConversionApplication.js";
import { OrderApplicationService } from "../src/modules/sales/orderApplication.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const ctx = (principal: any, organizationId: string, id: string) => ({ principal, organizationId, operationId: `m110:${id}`, businessRequest: { id, payloadFingerprint: "operation-computes-canonical-fingerprint" } });

async function fixture(client: PoolClient) {
  const x=randomUUID(), org=`m110-org-${x}`, other=`m110-other-${x}`, user=`m110-user-${x}`, customer=`m110-customer-${x}`, contact=`m110-contact-${x}`, type=`m110-type-${x}`, product=`m110-product-${x}`, template=`m110-template-${x}`, tree=`m110-tree-${x}`, set=`m110-set-${x}`;
  await client.query("BEGIN"); try {
    await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M110',$2),($3,'Other',$4)",[org,`m110-${x}`,other,`m110-other-${x}`]);
    await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner')",[user,`${user}@test`]);
    await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$2,'owner',true)",[user,org]);
    await client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES($1)",[org]);
    await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$2,'Conversion','conversion','staff')",[set,org]);
    for (const cap of ["quote.view","quote.create","quote.edit","quote.send","quote.convert","order.view","order.edit"]) await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[org,set,cap]);
    await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3)",[org,user,set]);
    await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Customer','Customer',true,'active')",[customer,org]);
    await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'C','One','active')",[contact,org]);
    await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')",[org,customer,contact]);
    await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$2,'Printed','printed','sha256:m110')",[template,org]);
    for (const [position,kind] of ["proofing","prepress","production","fulfillment"].entries()) await client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5)",[randomUUID(),org,template,position,kind]);
    await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode,default_route_template_id) VALUES($1,$2,'Printed','route_required',$3)",[type,org,template]);
    const treeJson={schemaVersion:2,rootNodeIds:["finish"],nodes:{finish:{id:"finish",kind:"question",label:"Finish",input:{type:"select",selectionKey:"finish",defaultValue:"standard"},choices:[{value:"standard",label:"Standard"},{value:"premium",label:"Premium",priceDeltaCents:100}]}},meta:{pricingV2:{base:{perPieceCents:1000}}}};
    await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Product','Product',true,'quantity_only',$3)",[product,org,type]);
    await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())",[tree,org,product,JSON.stringify(treeJson)]);
    await client.query("UPDATE products SET pbv2_active_tree_version_id=$1 WHERE id=$2 AND organization_id=$3",[tree,product,org]); await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  return {org,other,user,customer,contact,type,product,tree};
}
async function main() {
  const pool=new Pool({connectionString:requireV2M0CloneDatabaseUrl(),max:4,application_name:"m110-quote-conversion-rehearsal"});
  try { await migrate(drizzle({client:pool}),{migrationsFolder,migrationsTable:"__drizzle_migrations_v2",migrationsSchema:"public"}); const client=await pool.connect(); try {
    assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client)); assertV2CommercialPhysicalPostconditions(await checkV2CommercialPhysicalPostconditions(client));
    const f=await fixture(client), issuer=new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(client)), staff=await issuer.issue({subjectId:f.user,authenticatedAt:new Date(),authenticationMethod:"session"},{organizationId:f.org});
    const quote=new QuoteApplicationService(new PostgresQuoteTransactionRunner(pool)); const order=new OrderApplicationService(new PostgresOrderTransactionRunner(pool)); const conversion=new QuoteConversionApplicationService(new PostgresQuoteConversionTransactionRunner(pool),order);
    const ref={organizationId:brandedId<"OrganizationId">(f.org),customerId:brandedId<"CustomerId">(f.customer),contactId:brandedId<"ContactId">(f.contact)};
    const createId=`m110-create-${randomUUID()}`; const created=await quote.create(ctx(staff,f.org,createId),{businessRequestId:createId,customerContact:ref,purchaseOrderNumber:"PO-M110",lines:[{productId:f.product,quantity:2,selections:{finish:"premium"}}]}); assert(created.ok,"Quote create failed"); if(!created.ok)return;
    const sentId=`m110-send-${randomUUID()}`; const sent=await quote.send(ctx(staff,f.org,sentId),{businessRequestId:sentId,quoteId:created.value.quote.quote.quoteId,expectedRevision:created.value.quote.revision}); assert(sent.ok,"Quote send failed"); if(!sent.ok)return;
    const acceptId=`m110-accept-${randomUUID()}`; const accepted=await quote.accept(ctx(staff,f.org,acceptId),{businessRequestId:acceptId,quoteId:created.value.quote.quote.quoteId,expectedRevision:sent.value.quote.revision}); assert(accepted.ok && accepted.value.checkpointId,"Quote accept failed"); if(!accepted.ok||!accepted.value.checkpointId)return;
    const acceptedLine=accepted.value.quote.quote.lines[0]!;
    // Mutate current PBV2 defaults and price after acceptance; conversion must ignore both.
    await client.query("UPDATE pbv2_tree_versions SET tree_json=$1::jsonb WHERE organization_id=$2 AND id=$3",[JSON.stringify({schemaVersion:2,rootNodeIds:["finish"],nodes:{finish:{id:"finish",kind:"question",label:"Finish",input:{type:"select",selectionKey:"finish",defaultValue:"standard"},choices:[{value:"standard",label:"Standard"},{value:"premium",label:"Premium",priceDeltaCents:999}]}},meta:{pricingV2:{base:{perPieceCents:9999}}}}),f.org,f.tree]);
    const convertId=`m110-convert-${randomUUID()}`; const command={organizationId:brandedId<"OrganizationId">(f.org),quoteId:created.value.quote.quote.quoteId,sourceCheckpointId:accepted.value.checkpointId,businessRequestId:brandedId<"BusinessRequestId">(convertId),expectedStateToken:accepted.value.quote.revision};
    const result=await conversion.convert(ctx(staff,f.org,convertId),command); assert(result.ok,"Accepted Quote conversion failed"); if(!result.ok)return;
    const replay=await conversion.convert(ctx(staff,f.org,convertId),command); assert(replay.ok&&replay.value.orderId===result.value.orderId,"conversion replay diverged");
    const read=await order.read(ctx(staff,f.org,`m110-read-${randomUUID()}`),result.value.orderId); assert(read.ok,"converted Order unavailable"); if(!read.ok)return;
    const line=read.value.order.lines[0]!; assert(line.resolvedConfiguration.selections.finish==="premium" && line.pricingResult.calculatedLineAmount.cents===acceptedLine.pricingResult.calculatedLineAmount.cents && line.sellingLineAmount.cents===acceptedLine.sellingLineAmount.cents,"conversion repriced or replaced frozen commercial evidence");
    const db=await client.query<{conversions:number;checkpoints:number;invoices:number;routes:number;audits:number}>(`SELECT (SELECT count(*)::int FROM v2_sales_quote_conversions WHERE organization_id=$1 AND quote_document_id=$2) conversions,(SELECT count(*)::int FROM v2_sales_quote_checkpoints WHERE organization_id=$1 AND quote_document_id=$2 AND checkpoint_kind='quote_converted') checkpoints,(SELECT count(*)::int FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$3) invoices,(SELECT count(*)::int FROM v2_route_instances WHERE organization_id=$1 AND order_document_id=$3) routes,(SELECT count(*)::int FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='quote_converted') audits`,[f.org,created.value.quote.quote.quoteId,result.value.orderId]);
    assert(JSON.stringify(db.rows[0])===JSON.stringify({conversions:1,checkpoints:1,invoices:1,routes:1,audits:1}),"conversion durable readback mismatch");
    const postEditId=`m110-order-edit-${randomUUID()}`; const postEdit=await order.update(ctx(staff,f.org,postEditId),{businessRequestId:postEditId,orderId:result.value.orderId,expectedRevision:read.value.revision,patch:{purchaseOrderNumber:"PO-INDEPENDENT"}}); assert(postEdit.ok,"post-conversion Order mutation failed");
    const blockedId=`m110-quote-edit-${randomUUID()}`; const blocked=await quote.update(ctx(staff,f.org,blockedId),{businessRequestId:blockedId,quoteId:created.value.quote.quote.quoteId,expectedRevision:accepted.value.quote.revision,patch:{purchaseOrderNumber:"forbidden"}}); assert(!blocked.ok&&blocked.error.code==="CONFLICT","post-conversion Quote mutation was not safely rejected");
    console.log("[m1.10] happy path, frozen configuration/pricing, replay, lineage, Order independence, and Quote safety passed.");
  } finally {client.release();}} finally {await pool.end();}}
main().catch((error)=>{console.error(`[m1.10] rehearsal failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);process.exitCode=1;});
