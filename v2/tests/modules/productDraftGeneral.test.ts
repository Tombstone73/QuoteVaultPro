import { describe, expect, test } from "@jest/globals";
import { ProductVersionLifecycleApplicationService, type ProductDraftGeneral, type ProductDraftGeneralRead, type ProductVersionTransactionRunner } from "../../src/modules/products/productVersionLifecycle";
import { V2ApplicationError } from "../../src/errors/applicationError";
import type { OperationContext } from "../../src/application/operation";

const baseline: ProductDraftGeneral={displayName:"Banner",category:"Banners",description:"Original",storefrontVisible:false,measurementMode:"dimensions_required",workflowIntent:"standard_production",requiresProofApproval:false,requiresProductionJob:true};
const edited: ProductDraftGeneral={...baseline,displayName:"Banner Draft",category:"Signs",description:"Staged only",storefrontVisible:true};
const context=(id:string,caps:readonly any[]=["product.edit"]):OperationContext=>({organizationId:"org-a",operationId:id,businessRequest:{id,payloadFingerprint:id},principal:{kind:"staff",organizationId:"org-a",userId:"staff-a",authority:{membershipId:"member-a",capabilities:caps}}});
class Runner implements ProductVersionTransactionRunner {
  readonly activeTree={schemaVersion:2,nodes:{size:{kind:"question"}},meta:{pricingV2:{base:{perPieceCents:500}}}};
  readonly draftTree=structuredClone(this.activeTree) as any;
  readonly requests=new Map<string,ProductDraftGeneralRead>();
  updatedAt="2026-08-18T12:00:00.000Z";
  async transaction<T>(action:any):Promise<T>{return action({
    reserve:async(input:any)=>this.requests.has(input.businessRequestId)?{kind:"replay",request:{id:input.businessRequestId,resultJson:this.requests.get(input.businessRequestId)}}:{kind:"new",request:{id:input.businessRequestId,resultJson:null}},
    updateDraftGeneral:async(input:any)=>{if(input.draftVersionId!=="draft-a")throw new V2ApplicationError("CONFLICT","Only the current Draft can be edited.");if(input.expectedDraftUpdatedAt!==this.updatedAt)throw new V2ApplicationError("STALE_STATE","This Draft changed elsewhere. Refresh and try again.");this.draftTree.meta={...this.draftTree.meta,general:input.general};this.updatedAt="2026-08-18T12:01:00.000Z";return {productId:"product-a",draftVersionId:"draft-a",draftUpdatedAt:this.updatedAt,lifecycle:"draft" as const,general:input.general};},
    succeed:async(_org:string,id:string,_resource:string,result:ProductDraftGeneralRead)=>{this.requests.set(id,result);},attribute:async()=>undefined,audit:async()=>undefined,auditDraftGeneral:async()=>undefined,
  });}
}
describe("P3 Product Draft General command",()=>{
  test("updates only the Draft General section, replays safely, and rejects stale writes",async()=>{const runner=new Runner(),service=new ProductVersionLifecycleApplicationService(runner);const before=structuredClone(runner.activeTree);const first=await service.updateDraftGeneral(context("save-a"),{productId:"product-a",draftVersionId:"draft-a",expectedDraftUpdatedAt:"2026-08-18T12:00:00.000Z",businessRequestId:"save-a",general:edited});expect(first).toMatchObject({ok:true,value:{general:edited,draftUpdatedAt:"2026-08-18T12:01:00.000Z"}});expect(runner.activeTree).toEqual(before);expect(runner.draftTree.meta.pricingV2).toEqual(before.meta.pricingV2);const replay=await service.updateDraftGeneral(context("save-a"),{productId:"product-a",draftVersionId:"draft-a",expectedDraftUpdatedAt:"2026-08-18T12:00:00.000Z",businessRequestId:"save-a",general:edited});expect(replay).toEqual(first);const stale=await service.updateDraftGeneral(context("save-b"),{productId:"product-a",draftVersionId:"draft-a",expectedDraftUpdatedAt:"2026-08-18T12:00:00.000Z",businessRequestId:"save-b",general:baseline});expect(stale).toMatchObject({ok:false,error:{code:"STALE_STATE"}});});
  test("requires a current Draft and Product edit authority",async()=>{const service=new ProductVersionLifecycleApplicationService(new Runner());const input={productId:"product-a",draftVersionId:"draft-a",expectedDraftUpdatedAt:"2026-08-18T12:00:00.000Z",businessRequestId:"save-c",general:baseline};await expect(service.updateDraftGeneral(context("save-c",["product.view"]),input)).resolves.toMatchObject({ok:false,error:{code:"FORBIDDEN"}});await expect(service.updateDraftGeneral(context("save-d"),{...input,businessRequestId:"save-d",draftVersionId:"active-a"})).resolves.toMatchObject({ok:false,error:{code:"CONFLICT"}});});
});
