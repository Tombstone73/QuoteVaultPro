import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { PostgresPrepressTransaction } from "../../infrastructure/prepress/postgresPrepressTransaction.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const calls:{sql:string;values:readonly unknown[]|undefined}[]=[];
const client={query:async(sql:string,values?:readonly unknown[])=>{calls.push({sql,values});if(sql.includes("SELECT count(*) count"))return{rows:[{count:"0"}]};return{rows:[]};}} as unknown as PoolClient;
const queue=await new PostgresPrepressTransaction(client).listQueue(brandedId<"OrganizationId">("org-a"),{page:2,pageSize:50,search:"vinyl",requirementState:"configured",destination:"roll",readiness:"ready"});
assert.deepEqual(queue.pagination,{page:2,pageSize:50,totalCount:0,totalPages:0});
const count=calls.find((call)=>call.sql.includes("SELECT count(*) count"));
assert.ok(count);
assert.deepEqual(count.values,["org-a","vinyl","configured","roll","ready"],"filters are bound server-side before pagination");
assert.match(count.sql,/v2_order_line_material_requirements/u,"material search remains server owned");
assert.match(count.sql,/production_destination_station_key=\$4::text/u,"station filtering uses frozen route facts");
assert.match(count.sql,/\$5::text='ready'/u,"readiness filtering is evaluated by the query, not the browser");
console.log("Prepress queue filter SQL contract passed.");
