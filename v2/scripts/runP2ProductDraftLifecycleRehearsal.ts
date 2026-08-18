import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { requireV2M0CloneDatabaseUrl } from "../infrastructure/persistence/cloneSafety.js";
import { PostgresProductVersionLifecycleReader, PostgresProductVersionTransactionRunner } from "../infrastructure/products/postgresProductVersionLifecycle.js";
import { PostgresProductWorkspaceReads } from "../infrastructure/products/postgresProductWorkspaceReads.js";
import { PostgresProductsCompatibilityReader } from "../infrastructure/compatibility/postgresProductsRead.js";
import { ProductVersionLifecycleApplicationService } from "../src/modules/products/productVersionLifecycle.js";
import type { OperationContext } from "../src/application/operation.js";
import { brandedId } from "../src/modules/shared/commercialValues.js";

type Candidate={productId:string;displayName:string;activeId:string;activeUpdatedAt:Date;activeTree:unknown;draftCount:string;activePointer:string;organizationId:string};
const canonicalJson=(value:unknown):string=>{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(",")}]`;
  const record=value as Record<string,unknown>;
  return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};
const hash=(value:unknown)=>createHash("sha256").update(canonicalJson(value)).digest("hex");
const context=(organizationId:string,userId:string,request:string,caps:readonly any[]=["product.edit"]):OperationContext=>({organizationId,operationId:request,businessRequest:{id:request,payloadFingerprint:request},principal:{kind:"staff",organizationId,userId,authority:{membershipId:`rehearsal-${organizationId}`,capabilities:caps}}});
const request=(label:string)=>`p2-draft-${label}-${randomUUID()}`;
const product=async(pool:Pool,offset:number):Promise<Candidate>=>{const found=await pool.query<Candidate>(`SELECT p.id AS "productId",p.name AS "displayName",p.organization_id AS "organizationId",p.pbv2_active_tree_version_id AS "activePointer",a.id AS "activeId",a.updated_at AS "activeUpdatedAt",a.tree_json AS "activeTree",(SELECT count(*)::text FROM pbv2_tree_versions d WHERE d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT') AS "draftCount" FROM products p JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id AND a.organization_id=p.organization_id AND a.product_id=p.id AND a.status='ACTIVE' WHERE p.is_active=TRUE AND NOT EXISTS(SELECT 1 FROM pbv2_tree_versions d WHERE d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT') ORDER BY p.name,p.id OFFSET $1 LIMIT 1`,[offset]);if(!found.rows[0])throw new Error("The authorized clone needs two active Products without a current Draft for P2 rehearsal.");return found.rows[0];};
const draftCount=async(pool:Pool,c:Candidate)=>Number((await pool.query<{count:string}>("SELECT count(*)::text count FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND status='DRAFT'",[c.organizationId,c.productId])).rows[0]!.count);
const salesReferences=async(pool:Pool,c:Candidate)=>pool.query<{quoteLines:string;orderLines:string}>(`SELECT (SELECT count(*)::text FROM v2_sales_document_lines l JOIN v2_sales_documents d ON d.id=l.document_id AND d.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.product_id=$2 AND d.document_kind='quote') AS "quoteLines",(SELECT count(*)::text FROM v2_sales_document_lines l JOIN v2_sales_documents d ON d.id=l.document_id AND d.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.product_id=$2 AND d.document_kind='order') AS "orderLines"`,[c.organizationId,c.productId]);

async function main(){
  const url=requireV2M0CloneDatabaseUrl(); const target=new URL(url);
  console.log(`[p2] authorized clone ${target.protocol}//${target.hostname}/${target.pathname.slice(1)}`);
  const pool=new Pool({connectionString:url,max:5});
  try {
    await pool.query("SELECT 1");
    const [basic,concurrent]=await Promise.all([product(pool,0),product(pool,1)]);
    const actor=(await pool.query<{id:string}>("SELECT id FROM users ORDER BY id LIMIT 1")).rows[0]?.id;
    if(!actor)throw new Error("The authorized clone needs an attributed Staff user for P2 rehearsal.");
    const service=new ProductVersionLifecycleApplicationService(new PostgresProductVersionTransactionRunner(pool));
    const versions=new PostgresProductVersionLifecycleReader(pool);
    const workspace=new PostgresProductWorkspaceReads(pool);
    const beforeSales=(await salesReferences(pool,basic)).rows[0]!;
    const beforeHash=hash(basic.activeTree);
    const staleId=request("stale");
    const stale=await service.createDraft(context(basic.organizationId,actor,staleId),{productId:basic.productId,businessRequestId:staleId,expectedActiveVersionUpdatedAt:new Date(basic.activeUpdatedAt.getTime()-1).toISOString()});
    assert(!stale.ok&&stale.error.code==="STALE_STATE","stale Active state must fail before Draft creation");
    assert.equal(await draftCount(pool,basic),0,"stale request created a Draft");
    const basicId=request("basic");
    const created=await service.createDraft(context(basic.organizationId,actor,basicId),{productId:basic.productId,businessRequestId:basicId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});
    assert(created.ok,"basic Active-to-Draft creation failed");
    const after=await pool.query<{active_pointer:string;active_status:string;active_tree:unknown;draft_id:string;draft_status:string;draft_tree:unknown}>(`SELECT p.pbv2_active_tree_version_id active_pointer,a.status active_status,a.tree_json active_tree,d.id draft_id,d.status draft_status,d.tree_json draft_tree FROM products p JOIN pbv2_tree_versions a ON a.id=p.pbv2_active_tree_version_id AND a.organization_id=p.organization_id LEFT JOIN pbv2_tree_versions d ON d.organization_id=p.organization_id AND d.product_id=p.id AND d.status='DRAFT' WHERE p.organization_id=$1 AND p.id=$2`,[basic.organizationId,basic.productId]);
    const row=after.rows[0]!;assert.equal(await draftCount(pool,basic),1,"basic creation must leave exactly one Draft");assert.notEqual(row.draft_id,basic.activeId,"Draft reused the Active version");assert.equal(row.draft_status,"DRAFT");assert.equal(row.active_status,"ACTIVE");assert.equal(row.active_pointer,basic.activePointer,"Product Active pointer changed");assert.equal(hash(row.active_tree),beforeHash,"Active tree changed");assert.equal(hash(row.draft_tree),beforeHash,"Draft was not a structural copy of Active");
    const projection=await workspace.get(basic.organizationId,basic.productId);assert(projection?.versions.active&&projection.versions.draft&&!projection.versions.canCreateDraft,"Product version read did not show Active plus Draft");
    const sellable=new PostgresProductsCompatibilityReader(pool);const activeResolution=await sellable.getActivePricingConfiguration(brandedId<"OrganizationId">(basic.organizationId),brandedId<"ProductId">(basic.productId));assert.equal(activeResolution?.id,basic.activeId,"normal Product resolution did not remain on Active");
    const replay=await service.createDraft(context(basic.organizationId,actor,basicId),{productId:basic.productId,businessRequestId:basicId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});assert.deepEqual(replay,created,"same business request did not replay its durable result");assert.equal(await draftCount(pool,basic),1,"replay created another Draft");
    const secondId=request("second");const second=await service.createDraft(context(basic.organizationId,actor,secondId),{productId:basic.productId,businessRequestId:secondId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});assert(!second.ok&&second.error.code==="CONFLICT","different request did not conflict while Draft exists");assert.equal(await draftCount(pool,basic),1,"conflicted request created another Draft");
    const concurrentA=request("concurrent-a"),concurrentB=request("concurrent-b");
    const lock=await pool.connect();
    let locked=true;
    let firstPromise!:Promise<Awaited<ReturnType<typeof service.createDraft>>>;
    let competingPromise!:Promise<Awaited<ReturnType<typeof service.createDraft>>>;
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM products WHERE organization_id=$1 AND id=$2 FOR UPDATE",[concurrent.organizationId,concurrent.productId]);
      firstPromise=service.createDraft(context(concurrent.organizationId,actor,concurrentA),{productId:concurrent.productId,businessRequestId:concurrentA,expectedActiveVersionUpdatedAt:concurrent.activeUpdatedAt.toISOString()});
      await new Promise(resolve=>setTimeout(resolve,75));
      competingPromise=service.createDraft(context(concurrent.organizationId,actor,concurrentB),{productId:concurrent.productId,businessRequestId:concurrentB,expectedActiveVersionUpdatedAt:concurrent.activeUpdatedAt.toISOString()});
      await new Promise(resolve=>setTimeout(resolve,75));
      await lock.query("COMMIT");
      locked=false;
    } finally {
      if(locked)await lock.query("ROLLBACK");
      lock.release();
    }
    const [first,competing]=await Promise.all([firstPromise,competingPromise]);
    assert.equal([first,competing].filter(result=>result.ok).length,1,"concurrent requests did not produce exactly one successful Draft");
    const concurrentLoser=first.ok?competing:first;
    assert(!concurrentLoser.ok&&concurrentLoser.error.code==="CONFLICT","concurrent loser did not receive the safe Draft conflict");
    assert.equal(await draftCount(pool,concurrent),1,"concurrent requests created ambiguous Draft state");
    const forbiddenId=request("forbidden");const forbidden=await service.createDraft(context(basic.organizationId,actor,forbiddenId,["product.view"]),{productId:basic.productId,businessRequestId:forbiddenId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});assert(!forbidden.ok&&forbidden.error.code==="FORBIDDEN","Product View authorized Draft creation");
    const other=(await pool.query<{organization_id:string}>("SELECT id organization_id FROM organizations WHERE id<>$1 ORDER BY id LIMIT 1",[basic.organizationId])).rows[0]?.organization_id;if(!other)throw new Error("The authorized clone needs a second organization for tenant isolation rehearsal.");assert.equal(await versions.read(other,basic.productId),null,"foreign tenant read Product version history");const foreignId=request("foreign");const foreign=await service.createDraft(context(other,actor,foreignId),{productId:basic.productId,businessRequestId:foreignId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});assert(!foreign.ok&&foreign.error.code==="NOT_FOUND","foreign tenant created a Draft");const foreignReplay=await service.createDraft(context(other,actor,basicId),{productId:basic.productId,businessRequestId:basicId,expectedActiveVersionUpdatedAt:basic.activeUpdatedAt.toISOString()});assert(!foreignReplay.ok&&foreignReplay.error.code==="NOT_FOUND","foreign tenant replayed another tenant request");
    const afterSales=(await salesReferences(pool,basic)).rows[0]!;assert.deepEqual(afterSales,beforeSales,"Product Draft creation altered Quote or Order references");
    console.log(JSON.stringify({basicProduct:basic.displayName,basicProductId:basic.productId,activeVersion:basic.activeId,preExistingDrafts:basic.draftCount,basicDrafts:await draftCount(pool,basic),concurrentProduct:concurrent.displayName,concurrentDrafts:await draftCount(pool,concurrent),commercialReferences:afterSales},null,2));
    console.log("[p2] Product Draft lifecycle clone rehearsal passed.");
  } finally { await pool.end(); }
}
void main().catch(error=>{console.error(`[p2] ${error instanceof Error?error.message:String(error)}`);process.exitCode=1;});
