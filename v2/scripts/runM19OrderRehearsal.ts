import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolClient } from "pg";
import request from "supertest";
import { PassportSessionIdentitySource } from "../infrastructure/authentication/trustedHostPrincipalProvider.js";
import { composeAuthenticatedBillingRuntime } from "../infrastructure/billing/authenticatedBillingRuntime.js";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { assertV2M0PhysicalPostconditions, checkV2M0PhysicalPostconditions } from "../infrastructure/persistence/physicalPostconditions.js";
import { assertV2CommercialPhysicalPostconditions, checkV2CommercialPhysicalPostconditions } from "../infrastructure/sales/commercialPhysicalPostconditions.js";
import { assertV2BillingPhysicalPostconditions, checkV2BillingPhysicalPostconditions } from "../infrastructure/billing/billingPhysicalPostconditions.js";
import { assertV2RoutingPhysicalPostconditions, checkV2RoutingPhysicalPostconditions } from "../infrastructure/routing/routingPhysicalPostconditions.js";
import { PostgresOrderTransactionRunner } from "../infrastructure/sales/postgresOrderTransaction.js";
import { PostgresBillingReadRunner } from "../infrastructure/billing/postgresBillingRead.js";
import { PostgresBillingInvoiceTransactionRunner } from "../infrastructure/billing/postgresBillingInvoiceTransaction.js";
import { PostgresPermissionAuthorityReader } from "../infrastructure/authorization/postgresPermissionAuthorityRead.js";
import { PermissionSetPrincipalIssuer } from "../src/authorization/permissionSets.js";
import { OrderApplicationService } from "../src/modules/sales/orderApplication.js";
import { BillingApplicationService } from "../src/modules/billing/billingApplication.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";
import { loadV2RuntimeConfig } from "../src/config/runtimeConfig.js";
import { createV2HttpApp } from "../src/interfaces/http/app.js";

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/db/migrations_v2");
const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const context = (principal: Awaited<ReturnType<PermissionSetPrincipalIssuer["issue"]>>, org: string, id: string) => ({ principal, organizationId: org, operationId: `m19:${id}`, businessRequest: { id, payloadFingerprint: "operation-computes-canonical-fingerprint" } });

const committedCounts = async (client: PoolClient, organizationId: string): Promise<Readonly<Record<string, number>>> => {
  const result = await client.query<Record<string, number>>(
    `SELECT
      (SELECT count(*)::int FROM v2_operation_requests WHERE organization_id=$1) operation_requests,
      (SELECT count(*)::int FROM v2_principal_attributions WHERE organization_id=$1) attributions,
      (SELECT count(*)::int FROM v2_audit_events WHERE organization_id=$1) audit_events,
      (SELECT count(*)::int FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='order') orders,
      (SELECT count(*)::int FROM v2_sales_document_lines WHERE organization_id=$1) sales_lines,
      (SELECT count(*)::int FROM v2_billing_invoices WHERE organization_id=$1) invoices,
      (SELECT count(*)::int FROM v2_billing_invoice_lines WHERE organization_id=$1) invoice_lines,
      (SELECT count(*)::int FROM v2_route_instances WHERE organization_id=$1) routes,
      (SELECT count(*)::int FROM v2_route_instance_steps WHERE organization_id=$1) route_steps`,
    [organizationId],
  );
  return result.rows[0]!;
};

async function main() {
  const url = requireV2M0CloneDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 4, application_name: "m19-order-rehearsal" });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder, migrationsTable: "__drizzle_migrations_v2", migrationsSchema: "public" });
    const client = await pool.connect();
    try {
      assertV2M0PhysicalPostconditions(await checkV2M0PhysicalPostconditions(client));
      assertV2CommercialPhysicalPostconditions(await checkV2CommercialPhysicalPostconditions(client));
      assertV2BillingPhysicalPostconditions(await checkV2BillingPhysicalPostconditions(client));
      assertV2RoutingPhysicalPostconditions(await checkV2RoutingPhysicalPostconditions(client));
      const x = randomUUID(), org = `m19-org-${x}`, other = `m19-other-${x}`, user = `m19-user-${x}`, limited = `m19-limited-${x}`;
      const set = `m19-set-${x}`, limitedSet = `m19-limited-set-${x}`, customer = `m19-customer-${x}`, contact = `m19-contact-${x}`;
      const foreignCustomer = `m19-foreign-customer-${x}`, foreignContact = `m19-foreign-contact-${x}`;
      const foreignType = `m19-foreign-type-${x}`, foreignProduct = `m19-foreign-product-${x}`, foreignTree = `m19-foreign-tree-${x}`;
      const types = { printed: `m19-type-printed-${x}`, static: `m19-type-static-${x}`, service: `m19-type-service-${x}`, unconfigured: `m19-type-unconfigured-${x}` };
      const products = { printed: `m19-product-printed-${x}`, static: `m19-product-static-${x}`, service: `m19-product-service-${x}`, unconfigured: `m19-product-unconfigured-${x}` };
      const printedTemplate = `m19-template-printed-${x}`, staticTemplate = `m19-template-static-${x}`;
      await client.query("BEGIN");
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1,'M19',$2),($3,'M19 Other',$4)", [org,`m19-${x}`,other,`m19-other-${x}`]);
      await client.query("INSERT INTO users(id,email,role) VALUES($1,$2,'owner'),($3,$4,'member')", [user,`${user}@test`,limited,`${limited}@test`]);
      await client.query("INSERT INTO user_organizations(user_id,organization_id,role,is_active) VALUES($1,$3,'owner',true),($2,$3,'member',true)", [user,limited,org]);
      await client.query("INSERT INTO v2_permission_organization_state(organization_id) VALUES($1)", [org]);
      await client.query("INSERT INTO v2_permission_sets(id,organization_id,name,normalized_name,principal_kind) VALUES($1,$3,'Order','order','staff'),($2,$3,'Limited','limited','staff')", [set,limitedSet,org]);
      for (const cap of ["order.view","order.create","order.edit","order.overridePrice","invoice.view","invoice.issue"]) await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[org,set,cap]);
      for (const cap of ["order.view","order.create","order.edit","invoice.view"]) await client.query("INSERT INTO v2_permission_set_capabilities(organization_id,permission_set_id,capability_id) VALUES($1,$2,$3)",[org,limitedSet,cap]);
      await client.query("INSERT INTO v2_staff_permission_set_assignments(organization_id,user_id,permission_set_id) VALUES($1,$2,$3),($1,$4,$5)",[org,user,set,limited,limitedSet]);
      await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'M19 Customer','M19 Customer',true,'active')",[customer,org]);
      await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'M19','Contact','active')",[contact,org]);
      await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')",[org,customer,contact]);
      await client.query("INSERT INTO v2_route_templates(id,organization_id,name,normalized_name,definition_fingerprint) VALUES($1,$3,'Printed','printed','sha256:printed'),($2,$3,'Static','static','sha256:static')",[printedTemplate,staticTemplate,org]);
      for (const [template,kinds] of [[printedTemplate,["proofing","prepress","production","fulfillment"]],[staticTemplate,["fulfillment"]]] as const)
        for (const [position,kind] of kinds.entries()) await client.query("INSERT INTO v2_route_template_steps(id,organization_id,route_template_id,position,step_kind) VALUES($1,$2,$3,$4,$5)",[randomUUID(),org,template,position,kind]);
      await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode,default_route_template_id) VALUES($1,$5,'Printed','route_required',$6),($2,$5,'Static','route_required',$7),($3,$5,'Service','no_route',NULL),($4,$5,'Unconfigured','unconfigured',NULL)",[types.printed,types.static,types.service,types.unconfigured,org,printedTemplate,staticTemplate]);
      const treeJson = (price: number) => JSON.stringify({ schemaVersion:2,rootNodeIds:["finish"],nodes:{finish:{id:"finish",kind:"question",label:"Finish",input:{type:"select",selectionKey:"finish",defaultValue:"standard"},choices:[{value:"standard",label:"Standard"},{value:"premium",label:"Premium",priceDeltaCents:100}]}},meta:{pricingV2:{base:{perPieceCents:price}}} });
      for (const [key,price] of [["printed",1000],["static",500],["service",250],["unconfigured",100]] as const) {
        const tree = `m19-tree-${key}-${x}`;
        await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,$3,$4,true,'quantity_only',$5)",[products[key],org,key,key,types[key]]);
        await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())",[tree,org,products[key],treeJson(price)]);
        await client.query("UPDATE products SET pbv2_active_tree_version_id=$1 WHERE id=$2 AND organization_id=$3",[tree,products[key],org]);
      }
      await client.query("INSERT INTO customers(id,organization_id,company_name,display_name,is_active,status) VALUES($1,$2,'Foreign Customer','Foreign Customer',true,'active')",[foreignCustomer,other]);
      await client.query("INSERT INTO customer_contacts(id,organization_id,first_name,last_name,status) VALUES($1,$2,'Foreign','Contact','active')",[foreignContact,other]);
      await client.query("INSERT INTO customer_contact_links(organization_id,customer_id,contact_id,status) VALUES($1,$2,$3,'active')",[other,foreignCustomer,foreignContact]);
      await client.query("INSERT INTO product_types(id,organization_id,name,routing_mode) VALUES($1,$2,'Foreign Service','no_route')",[foreignType,other]);
      await client.query("INSERT INTO products(id,organization_id,name,description,is_active,measurement_mode,product_type_id) VALUES($1,$2,'Foreign Product','Foreign Product',true,'quantity_only',$3)",[foreignProduct,other,foreignType]);
      await client.query("INSERT INTO pbv2_tree_versions(id,organization_id,product_id,status,schema_version,tree_json,published_at) VALUES($1,$2,$3,'ACTIVE',2,$4::jsonb,now())",[foreignTree,other,foreignProduct,treeJson(100)]);
      await client.query("UPDATE products SET pbv2_active_tree_version_id=$1 WHERE id=$2 AND organization_id=$3",[foreignTree,foreignProduct,other]);
      await client.query("COMMIT");

      const issuer = new PermissionSetPrincipalIssuer(new PostgresPermissionAuthorityReader(client));
      const staff = await issuer.issue({ subjectId:user, authenticatedAt:new Date(), authenticationMethod:"session" },{organizationId:org});
      const limitedPrincipal = await issuer.issue({ subjectId:limited, authenticatedAt:new Date(), authenticationMethod:"session" },{organizationId:org});
      const service = new OrderApplicationService(new PostgresOrderTransactionRunner(pool));
      const ref = { organizationId:brandedId<"OrganizationId">(org), customerId:brandedId<"CustomerId">(customer), contactId:brandedId<"ContactId">(contact) };
      const createId = `m19-create-${x}`;
      const created = await service.create(context(staff,org,createId),{ businessRequestId:createId, customerContact:ref, purchaseOrderNumber:"PO-1", lines:[{productId:products.printed,description:"Custom printed description",quantity:2},{productId:products.static,quantity:1},{productId:products.service,quantity:1}] });
      assert(created.ok,`mixed Order create failed: ${created.ok ? "unknown" : `${created.error.code} ${created.error.publicMessage}`}`);
      assert(created.value.order.order.lines.length===3,"mixed Order line count mismatch");
      assert(created.value.order.totals.calculated.cents===created.value.order.order.lines.reduce((total,line)=>total+line.calculatedLineAmount.cents,0) && created.value.order.totals.selling.cents===created.value.order.order.lines.reduce((total,line)=>total+line.sellingLineAmount.cents,0),"Order readback aggregate totals were incorrect");
      assert(created.value.order.draftInvoice?.invoiceId===created.value.draftInvoiceId && created.value.order.draftInvoice.lineCount===3 && created.value.order.draftInvoice.total.cents===created.value.order.totals.selling.cents,"Order readback Draft Invoice summary was incorrect");
      assert(created.value.routeInstances.length===2,"mixed Order route count mismatch");
      assert(created.value.order.routes.length===2,"Order readback did not expose both Route summaries");
      const mixedRouteSteps=await client.query<{order_line_id:string;steps:number}>("SELECT r.order_line_id,count(s.id)::int steps FROM v2_route_instances r JOIN v2_route_instance_steps s ON s.organization_id=r.organization_id AND s.route_instance_id=r.id WHERE r.organization_id=$1 AND r.order_document_id=$2 GROUP BY r.order_line_id ORDER BY steps",[org,created.value.order.order.orderId]);
      assert(mixedRouteSteps.rows.length===2 && mixedRouteSteps.rows[0]?.steps===1 && mixedRouteSteps.rows[1]?.steps===4,"mixed static/printed frozen routes were incorrect");
      const invoice = await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      assert(invoice?.lines.length===3,"Draft Invoice readback mismatch");
      assert(invoice.sourceOrderId===created.value.order.order.orderId && invoice.total.cents===created.value.order.order.lines.reduce((total,line)=>total+line.sellingLineAmount.cents,0),"Draft Invoice source/total diverged from Order");
      const createAudit=await client.query<{principal_kind:string;principal_subject:string;staff_actor_user_id:string|null}>("SELECT principal_kind,principal_subject,staff_actor_user_id FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='order_created'",[org,created.value.order.order.orderId]);
      assert(createAudit.rows.length===1 && createAudit.rows[0]?.principal_kind==="staff" && createAudit.rows[0]?.principal_subject===user && createAudit.rows[0]?.staff_actor_user_id===user,"Order Audit attribution was not truthful");
      const replay = await service.create(context(staff,org,createId),{ businessRequestId:createId, customerContact:ref, purchaseOrderNumber:"PO-1", lines:[{productId:products.printed,description:"Custom printed description",quantity:2},{productId:products.static,quantity:1},{productId:products.service,quantity:1}] });
      assert(replay.ok && replay.value.order.order.orderId===created.value.order.order.orderId,"create replay diverged");
      const concurrentId=`m19-concurrent-${x}`;
      const concurrentCommand={businessRequestId:concurrentId,customerContact:ref,purchaseOrderNumber:"PO-CONCURRENT",lines:[{productId:products.printed,quantity:1}]} as const;
      const concurrent=await Promise.all([service.create(context(staff,org,concurrentId),concurrentCommand),service.create(context(staff,org,concurrentId),concurrentCommand)]);
      assert(concurrent.every((result)=>result.ok) && concurrent[0]!.ok && concurrent[1]!.ok && concurrent[0].value.order.order.orderId===concurrent[1].value.order.order.orderId,"concurrent same-request create did not converge");
      const concurrentOrderId = concurrent[0]!.ok ? concurrent[0]!.value.order.order.orderId : "";
      const concurrentDedupe = await client.query<{ requests:number; invoices:number; invoice_lines:number; routes:number; route_steps:number; audits:number }>(
        `SELECT
          (SELECT count(*)::int FROM v2_operation_requests WHERE organization_id=$1 AND operation='sales.order.create.v1' AND business_request_id=$2) requests,
          (SELECT count(*)::int FROM v2_billing_invoices WHERE organization_id=$1 AND sales_order_document_id=$3) invoices,
          (SELECT count(*)::int FROM v2_billing_invoice_lines WHERE organization_id=$1 AND sales_order_document_id=$3) invoice_lines,
          (SELECT count(*)::int FROM v2_route_instances WHERE organization_id=$1 AND order_document_id=$3) routes,
          (SELECT count(*)::int FROM v2_route_instance_steps s JOIN v2_route_instances r ON r.organization_id=s.organization_id AND r.id=s.route_instance_id WHERE r.organization_id=$1 AND r.order_document_id=$3) route_steps,
          (SELECT count(*)::int FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$3 AND event_type='order_created') audits`,
        [org,concurrentId,concurrentOrderId],
      );
      assert(JSON.stringify(concurrentDedupe.rows[0])===JSON.stringify({requests:1,invoices:1,invoice_lines:1,routes:1,route_steps:4,audits:1}),"concurrent create duplicated durable commercial state");
      const distinct=await Promise.all(["a","b"].map((label)=>{const id=`m19-distinct-${label}-${x}`;return service.create(context(staff,org,id),{businessRequestId:id,customerContact:ref,purchaseOrderNumber:`PO-${label}`,lines:[{productId:products.service,quantity:1}]});}));
      assert(distinct.every((result)=>result.ok) && distinct[0]!.ok && distinct[1]!.ok && distinct[0].value.order.number.display!==distinct[1].value.order.number.display,"distinct concurrent Order numbering collided");
      assert(distinct[0]!.ok && distinct[1]!.ok && distinct[0]!.value.draftInvoiceId!==distinct[1]!.value.draftInvoiceId,"distinct concurrent Orders cross-linked Draft Invoices");
      for (const [point,hooks] of [
        ["sales",{afterSales:async()=>{throw new Error("m19 injected after Sales");}}],
        ["billing",{afterBilling:async()=>{throw new Error("m19 injected after Billing");}}],
        ["route",{afterRoute:async()=>{throw new Error("m19 injected after Route");}}],
        ["audit",{afterAudit:async()=>{throw new Error("m19 injected after Audit");}}],
      ] as const) {
        const id=`m19-rollback-${point}-${x}`, po=`PO-ROLLBACK-${point}`;
        const beforeFailure = await committedCounts(client, org);
        const failed=await new OrderApplicationService(new PostgresOrderTransactionRunner(pool,hooks)).create(context(staff,org,id),{businessRequestId:id,customerContact:ref,purchaseOrderNumber:po,lines:[{productId:products.printed,quantity:1}]});
        assert(!failed.ok,"failure injection unexpectedly committed");
        const afterFailure = await committedCounts(client, org);
        assert(JSON.stringify(afterFailure)===JSON.stringify(beforeFailure),`rollback after ${point} left partial committed state`);
        const retry=await service.create(context(staff,org,id),{businessRequestId:id,customerContact:ref,purchaseOrderNumber:po,lines:[{productId:products.printed,quantity:1}]});
        assert(retry.ok,`retry after ${point} rollback failed`);
      }

      const addFailureBaseId=`m19-add-failure-base-${x}`;
      const addFailureBase=await service.create(context(staff,org,addFailureBaseId),{businessRequestId:addFailureBaseId,customerContact:ref,purchaseOrderNumber:"PO-ADD-FAILURE",lines:[{productId:products.service,quantity:1}]});
      assert(addFailureBase.ok,"add-line failure fixture Order could not be created");
      const addFailureId=`m19-add-route-failure-${x}`;
      const beforeAddFailure=await committedCounts(client,org);
      const injectedAdd=await new OrderApplicationService(new PostgresOrderTransactionRunner(pool,{afterRoute:async()=>{throw new Error("m19 injected add-line Routing failure");}})).update(context(staff,org,addFailureId),{businessRequestId:addFailureId,orderId:addFailureBase.ok ? addFailureBase.value.order.order.orderId : brandedId<"OrderId">("missing"),expectedRevision:"1",patch:{},lineChanges:[{kind:"add",line:{productId:products.printed,quantity:1}}]});
      assert(!injectedAdd.ok && JSON.stringify(await committedCounts(client,org))===JSON.stringify(beforeAddFailure),"add-line Routing failure left partial Sales/Billing/Routing/Audit state");
      const addFailureRetry=await service.update(context(staff,org,addFailureId),{businessRequestId:addFailureId,orderId:addFailureBase.ok ? addFailureBase.value.order.order.orderId : brandedId<"OrderId">("missing"),expectedRevision:"1",patch:{},lineChanges:[{kind:"add",line:{productId:products.printed,quantity:1}}]});
      assert(addFailureRetry.ok && addFailureRetry.value.routeInstances.length===1 && addFailureRetry.value.order.order.lines.length===2,"add-line retry after Routing rollback failed");

      const first = created.value.order.order.lines[0]!, serviceLine = created.value.order.order.lines[2]!;
      const editId = `m19-edit-${x}`;
      const edited = await service.update(context(staff,org,editId),{ businessRequestId:editId,orderId:created.value.order.order.orderId,expectedRevision:created.value.order.revision,patch:{purchaseOrderNumber:"PO-2"},lineChanges:[{kind:"update",lineId:first.lineId,line:{productId:first.productId,quantity:3,selling:{kind:"unit_override",unitCents:900,reason:"approved"}}},{kind:"remove",lineId:serviceLine.lineId},{kind:"add",line:{productId:products.service,quantity:2}}] });
      assert(edited.ok,`Order commercial mutation failed: ${edited.ok ? "unknown" : `${edited.error.code} ${edited.error.publicMessage}`}`);
      assert(edited.value.order.order.lines.length===3,"add/remove result mismatch");
      assert(edited.value.order.order.lines.find((line)=>line.lineId===first.lineId)?.description==="Custom printed description","quantity-only edit silently replaced the Sales-owned description");
      assert(edited.value.routeInstances.length===0,"no-route addition created Routing");
      const synced = await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(edited.value.draftInvoiceId)));
      assert(synced?.synchronizationVersion==="2" && synced.lines.length===3,"Draft sync mismatch");
      assert(!synced.lines.some((line)=>line.sourceOrderLineId===serviceLine.lineId) && edited.value.order.order.lines.some((line)=>line.productId===products.service && line.lineId!==serviceLine.lineId),"safe no-route removal/addition did not synchronize source line identity");
      const editReplay = await service.update(context(staff,org,editId),{ businessRequestId:editId,orderId:created.value.order.order.orderId,expectedRevision:created.value.order.revision,patch:{purchaseOrderNumber:"PO-2"},lineChanges:[{kind:"update",lineId:first.lineId,line:{productId:first.productId,quantity:3,selling:{kind:"unit_override",unitCents:900,reason:"approved"}}},{kind:"remove",lineId:serviceLine.lineId},{kind:"add",line:{productId:products.service,quantity:2}}] });
      assert(editReplay.ok && editReplay.value.order.revision===edited.value.order.revision,"mutation replay advanced state");
      const editDedupe = await client.query<{requests:number;audits:number}>("SELECT (SELECT count(*)::int FROM v2_operation_requests WHERE organization_id=$1 AND operation='sales.order.edit.v1' AND business_request_id=$2) requests,(SELECT count(*)::int FROM v2_audit_events a JOIN v2_operation_requests r ON r.organization_id=a.organization_id AND r.id=a.operation_request_id WHERE r.organization_id=$1 AND r.business_request_id=$2) audits",[org,editId]);
      assert(editDedupe.rows[0]?.requests===1 && editDedupe.rows[0]?.audits===1,"mutation replay duplicated operation or Audit history");
      const routedRemoval = await service.update(context(staff,org,`m19-routed-remove-${x}`),{businessRequestId:`m19-routed-remove-${x}`,orderId:created.value.order.order.orderId,expectedRevision:edited.value.order.revision,patch:{},lineChanges:[{kind:"remove",lineId:first.lineId}]});
      assert(!routedRemoval.ok && routedRemoval.error.code==="CONFLICT","routed line removal was not rejected");
      const addRouteId=`m19-add-route-${x}`;
      const addedRoute=await service.update(context(staff,org,addRouteId),{businessRequestId:addRouteId,orderId:created.value.order.order.orderId,expectedRevision:edited.value.order.revision,patch:{},lineChanges:[{kind:"add",line:{productId:products.printed,quantity:1}}]});
      assert(addedRoute.ok && addedRoute.value.routeInstances.length===1 && addedRoute.value.order.routes.some((route)=>route.routeInstanceId===addedRoute.value.routeInstances[0]!.routeInstanceId),"route-required add line did not return authoritative Routing summary");
      const currentFirst = edited.value.order.order.lines.find((line)=>line.lineId===first.lineId)!;
      const configId=`m19-config-${x}`;
      const configured=await service.update(context(staff,org,configId),{businessRequestId:configId,orderId:created.value.order.order.orderId,expectedRevision:addedRoute.ok ? addedRoute.value.order.revision : edited.value.order.revision,patch:{},lineChanges:[{kind:"update",lineId:first.lineId,line:{productId:first.productId,quantity:currentFirst.quantity,selections:{finish:"premium"}}}]});
      assert(configured.ok && configured.value.order.order.lines.find((line)=>line.lineId===first.lineId)?.resolvedConfiguration.selections.finish==="premium","explicit configuration edit failed");
      assert(configured.ok && configured.value.order.order.lines.find((line)=>line.lineId===first.lineId)?.pricingResult.calculatedLineAmount.cents!==currentFirst.pricingResult.calculatedLineAmount.cents,"configuration edit did not produce authoritative repricing evidence");
      const configuredFirst=configured.ok ? configured.value.order.order.lines.find((line)=>line.lineId===first.lineId)! : currentFirst;
      const totalOverrideId=`m19-total-override-${x}`;
      const totalOverridden=await service.update(context(staff,org,totalOverrideId),{businessRequestId:totalOverrideId,orderId:created.value.order.order.orderId,expectedRevision:configured.ok ? configured.value.order.revision : edited.value.order.revision,patch:{},lineChanges:[{kind:"update",lineId:first.lineId,line:{productId:first.productId,quantity:configuredFirst.quantity,selling:{kind:"total_override",totalCents:2500,reason:"approved total"}}}]});
      assert(totalOverridden.ok && totalOverridden.value.order.order.lines.find((line)=>line.lineId===first.lineId)?.sellingPriceDecision.kind==="total_override" && totalOverridden.value.order.order.lines.find((line)=>line.lineId===first.lineId)?.sellingLineAmount.cents===2500,"authorized total override failed");
      const totalOverrideInvoice=await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      assert(totalOverrideInvoice?.lines.find((line)=>line.sourceOrderLineId===first.lineId)?.lineAmount.cents===2500,"Billing did not synchronize authorized total override");
      const routeIdentity=await client.query<{id:string}>("SELECT id FROM v2_route_instances WHERE organization_id=$1 AND order_document_id=$2 AND order_line_id=$3",[org,created.value.order.order.orderId,first.lineId]);
      assert(routeIdentity.rows[0]?.id===created.value.routeInstances[0]?.routeInstanceId,"commercial edit rebuilt Routing identity");
      const beforeStale = totalOverridden.ok ? totalOverridden.value.order : configured.ok ? configured.value.order : edited.value.order;
      const beforeStaleInvoice = await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      const beforeStaleAudit = await client.query<{count:number}>("SELECT count(*)::int count FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",[org,created.value.order.order.orderId]);
      const stale = await service.update(context(staff,org,`m19-stale-${x}`),{businessRequestId:`m19-stale-${x}`,orderId:created.value.order.order.orderId,expectedRevision:"1",patch:{purchaseOrderNumber:"STALE"}});
      assert(!stale.ok && stale.error.code==="STALE_STATE","stale edit was not rejected");
      const afterStale = await service.read(context(staff,org,`m19-after-stale-${x}`),created.value.order.order.orderId);
      const afterStaleInvoice = await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      const afterStaleAudit = await client.query<{count:number}>("SELECT count(*)::int count FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",[org,created.value.order.order.orderId]);
      assert(afterStale.ok && afterStale.value.revision===beforeStale.revision && afterStale.value.order.purchaseOrderNumber===beforeStale.order.purchaseOrderNumber,"stale rejection changed Order state");
      assert(afterStaleInvoice?.synchronizationVersion===beforeStaleInvoice?.synchronizationVersion && afterStaleAudit.rows[0]?.count===beforeStaleAudit.rows[0]?.count,"stale rejection changed Invoice or Audit state");
      assert(afterStale.ok && JSON.stringify(afterStale.value.routes)===JSON.stringify(beforeStale.routes),"stale rejection changed Routing state");
      const refreshedId=`m19-refreshed-${x}`;
      const refreshed=await service.update(context(staff,org,refreshedId),{businessRequestId:refreshedId,orderId:created.value.order.order.orderId,expectedRevision:beforeStale.revision,patch:{purchaseOrderNumber:"PO-REFRESHED"}});
      assert(refreshed.ok,"refreshed retry after stale rejection failed");
      const unauthorized = await service.update(context(limitedPrincipal,org,`m19-unauthorized-${x}`),{businessRequestId:`m19-unauthorized-${x}`,orderId:created.value.order.order.orderId,expectedRevision:refreshed.ok ? refreshed.value.order.revision : beforeStale.revision,patch:{},lineChanges:[{kind:"update",lineId:first.lineId,line:{productId:first.productId,quantity:3,selling:{kind:"total_override",totalCents:1,reason:"forged"}}}]});
      assert(!unauthorized.ok && unauthorized.error.code==="FORBIDDEN","unauthorized override succeeded");
      const unauthorizedHistory=await client.query<{count:number}>("SELECT count(*)::int count FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2",[org,`m19-unauthorized-${x}`]);
      assert(unauthorizedHistory.rows[0]?.count===0,"rejected override left successful operation history");
      assert((await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(other),brandedId<"InvoiceId">(created.value.draftInvoiceId))))===null,"foreign organization read Invoice");
      const foreignCustomerCreate=await service.create(context(staff,org,`m19-foreign-customer-${x}`),{businessRequestId:`m19-foreign-customer-${x}`,customerContact:{organizationId:brandedId<"OrganizationId">(other),customerId:brandedId<"CustomerId">(foreignCustomer),contactId:brandedId<"ContactId">(foreignContact)},lines:[{productId:products.service,quantity:1}]});
      assert(!foreignCustomerCreate.ok && ["NOT_FOUND","WRONG_TENANT"].includes(foreignCustomerCreate.error.code),"foreign Customer/Contact was accepted");
      const foreignProductCreate=await service.create(context(staff,org,`m19-foreign-product-${x}`),{businessRequestId:`m19-foreign-product-${x}`,customerContact:ref,lines:[{productId:foreignProduct,quantity:1}]});
      assert(!foreignProductCreate.ok && foreignProductCreate.error.code==="NOT_FOUND","foreign Product/Product Type was accepted");
      const foreignOrderRead=await service.read(context(staff,other,`m19-foreign-order-read-${x}`),created.value.order.order.orderId);
      assert(!foreignOrderRead.ok && ["WRONG_TENANT","NOT_FOUND"].includes(foreignOrderRead.error.code),"foreign Order read leaked data");
      const foreignOrderMutation=await service.update(context(staff,other,`m19-foreign-order-edit-${x}`),{businessRequestId:`m19-foreign-order-edit-${x}`,orderId:created.value.order.order.orderId,expectedRevision:refreshed.ok ? refreshed.value.order.revision : beforeStale.revision,patch:{purchaseOrderNumber:"FOREIGN"}});
      assert(!foreignOrderMutation.ok && ["WRONG_TENANT","NOT_FOUND"].includes(foreignOrderMutation.error.code),"foreign Order mutation was accepted");
      const foreignReplay=await service.create(context(staff,other,createId),{businessRequestId:createId,customerContact:ref,purchaseOrderNumber:"PO-1",lines:[{productId:products.printed,quantity:2},{productId:products.static,quantity:1},{productId:products.service,quantity:1}]});
      assert(!foreignReplay.ok && foreignReplay.error.code==="WRONG_TENANT","operation replay crossed tenant scope");

      const trustedSession: { v2CsrfToken?: string } = {};
      const billingRuntime=composeAuthenticatedBillingRuntime({pool,trustedHostIdentity:new PassportSessionIdentitySource(),trustedHostMiddleware:(req:any,_res:any,next:()=>void)=>{req.isAuthenticated=()=>true;req.user={id:user};req.sessionID=`m19-session-${x}`;req.session=trustedSession;next();}});
      const billingApp=createV2HttpApp(loadV2RuntimeConfig({NODE_ENV:"test",V2_SERVICE_NAME:"m19-billing-runtime"}),{log:()=>undefined},undefined,undefined,undefined,billingRuntime);
      const invoiceHttp=await request(billingApp).get(`/v2/organizations/${org}/invoices/${created.value.draftInvoiceId}`);
      assert(invoiceHttp.status===200 && invoiceHttp.body.data.sourceOrderId===created.value.order.order.orderId,"authenticated Billing HTTP read failed");
      const foreignInvoiceHttp=await request(billingApp).get(`/v2/organizations/${other}/invoices/${created.value.draftInvoiceId}`);
      assert([403,404].includes(foreignInvoiceHttp.status) && foreignInvoiceHttp.body?.data===undefined,"authenticated Billing HTTP leaked a foreign Invoice");
      const badId=`m19-unconfigured-${x}`;
      const beforeUnconfigured=await committedCounts(client,org);
      const bad=await service.create(context(staff,org,badId),{businessRequestId:badId,customerContact:ref,lines:[{productId:products.unconfigured,quantity:1}]});
      assert(!bad.ok && bad.error.code==="CONFLICT","unconfigured routing did not reject");
      assert(JSON.stringify(await committedCounts(client,org))===JSON.stringify(beforeUnconfigured),"unconfigured routing rejection left partial committed state");
      const competingRevision = refreshed.ok ? refreshed.value.order.revision : beforeStale.revision;
      const competing = await Promise.all(["A","B"].map((label)=>{const id=`m19-edit-race-${label}-${x}`;return service.update(context(staff,org,id),{businessRequestId:id,orderId:created.value.order.order.orderId,expectedRevision:competingRevision,patch:{purchaseOrderNumber:`PO-RACE-${label}`}});}));
      assert(competing.filter((result)=>result.ok).length===1 && competing.filter((result)=>!result.ok && result.error.code==="STALE_STATE").length===1,`concurrent edits did not produce one coherent winner: ${competing.map((result)=>result.ok ? "ok" : result.error.code).join(",")}`);
      const winner=competing.find((result)=>result.ok)!;
      assert(winner.ok,"concurrent edit winner missing");
      const coherentInvoice=await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      assert(coherentInvoice?.synchronizationVersion===winner.value.order.revision,"concurrent edit left hybrid Invoice revision");
      const beforeIssue = winner.value.order.revision;
      const purchaseOrderBeforeIssue = winner.value.order.order.purchaseOrderNumber;
      const routesBeforeIssue = JSON.stringify(winner.value.order.routes);
      const auditBeforeIssue = await client.query<{count:number}>("SELECT count(*)::int count FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",[org,created.value.order.order.orderId]);
      const issued=await new BillingApplicationService(new PostgresBillingReadRunner(pool),undefined,new PostgresBillingInvoiceTransactionRunner(pool)).issueInvoice(context(staff,org,`m19-issue-${x}`),{organizationId:brandedId<"OrganizationId">(org),invoiceId:brandedId<"InvoiceId">(created.value.draftInvoiceId),businessRequestId:brandedId<"BusinessRequestId">(`m19-issue-${x}`)});
      assert(issued.ok,"canonical Invoice issuance failed before non-Draft guard proof");
      const blocked=await service.update(context(staff,org,`m19-issued-${x}`),{businessRequestId:`m19-issued-${x}`,orderId:created.value.order.order.orderId,expectedRevision:beforeIssue,patch:{purchaseOrderNumber:"MUST-ROLLBACK"}});
      assert(!blocked.ok && blocked.error.code==="CONFLICT","non-Draft Invoice allowed Order divergence");
      const afterBlocked=await service.read(context(staff,org,`m19-read-${x}`),created.value.order.order.orderId);
      assert(afterBlocked.ok && afterBlocked.value.revision===beforeIssue && afterBlocked.value.order.purchaseOrderNumber===purchaseOrderBeforeIssue,"non-Draft failure mutated Order");
      const invoiceAfterBlocked=await new PostgresBillingReadRunner(pool).read((port)=>port.readInvoice(brandedId<"OrganizationId">(org),brandedId<"InvoiceId">(created.value.draftInvoiceId)));
      const auditAfterBlocked=await client.query<{count:number}>("SELECT count(*)::int count FROM v2_audit_events WHERE organization_id=$1 AND resource_id=$2",[org,created.value.order.order.orderId]);
      const blockedRequest=await client.query<{count:number}>("SELECT count(*)::int count FROM v2_operation_requests WHERE organization_id=$1 AND business_request_id=$2",[org,`m19-issued-${x}`]);
      assert(invoiceAfterBlocked?.lifecycle==="issued" && invoiceAfterBlocked.synchronizationVersion===coherentInvoice?.synchronizationVersion,"non-Draft failure changed Invoice state or projection");
      assert(afterBlocked.ok && JSON.stringify(afterBlocked.value.routes)===routesBeforeIssue && auditAfterBlocked.rows[0]?.count===auditBeforeIssue.rows[0]?.count && blockedRequest.rows[0]?.count===0,"non-Draft failure changed Routing, Audit, or operation result");
      console.log("[m1.9] full Order, Draft Invoice, Routing, concurrency, rollback, tenant, HTTP, and physical rehearsal passed.");
    } finally { client.release(); }
  } finally { await pool.end(); }
}
main().catch((error)=>{ console.error(`[m1.9] rehearsal failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); process.exitCode=1; });
