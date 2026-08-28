import assert from "node:assert/strict";
import { PostgresProductRoutingCompatibilityReader } from "../../infrastructure/products/postgresProductRoutingCompatibility.js";

const base={product_id:"product-a",product_name:"Physical",product_updated_at:new Date("2026-08-28T00:00:00.000Z"),workflow_intent:"standard_production" as const,requires_production_job:true,active_product_version_id:"version-a",product_type_id:"type-a",product_type_name:"Sheet",routing_mode:"route_required" as const,default_route_template_id:"route-a",version_mode:null,version_route:null,compatibility_route:"Standard"};
const client={query:async<T>(text:string,values?:readonly unknown[])=>{assert.equal(values?.[0],"org-a","every compatibility read is tenant-scoped");if(text.includes("FROM products p"))return{rows:[base]as T[]};if(text.includes("FROM product_types"))return{rows:[{id:"type-a",name:"Sheet",updated_at:new Date("2026-08-28T00:00:00.000Z"),route_id:"route-a",route_name:"Standard"}]as T[]};return{rows:[{id:"route-a",name:"Standard",steps:["production"]}]as T[]};},release:()=>undefined};
const reader=new PostgresProductRoutingCompatibilityReader({connect:async()=>client} as any);
const value=await reader.read("org-a","product-a");
assert.equal(value?.readiness,"ROUTABLE_COMPATIBILITY_ROUTE");
assert.equal(value?.compatibilityRouteName,"Standard");
const audit=await reader.audit("org-a");
assert.equal(audit.counts.routableByCompatibility,1);
assert.equal(audit.worklist.length,0);
(base as any).product_type_id=null;
(base as any).product_type_name=null;
(base as any).default_route_template_id=null;
(base as any).compatibility_route=null;
const debt=await reader.audit("org-a");
assert.deepEqual(debt.worklist.map((item)=>({readiness:item.readiness,reason:item.reason})),[{readiness:"UNROUTABLE_NO_PRODUCT_TYPE",reason:"No Product Type assigned."}]);
console.log("Product routing compatibility pure tests passed.");
