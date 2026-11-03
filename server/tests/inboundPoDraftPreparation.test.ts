import { beforeEach, expect, jest, test } from '@jest/globals';
import { offsetHouseParsedFixture } from './helpers/offsetHousePoRegression';
import { scoreProductKnowledgeCandidates } from '../storage/inboundProductKnowledgeMatcher';
import type { InboundOrderRecord, InboundOrderReviewSnapshot } from '@shared/schema';
import { InboundOrdersRepository } from '../storage/inboundOrders.repo';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

jest.unstable_mockModule('../services/pricing/PricingService',()=>({priceLineItem:jest.fn()}));
const {InboundOrderService}=await import('../services/inboundOrders/InboundOrderService');

function harness(parsed=offsetHouseParsedFixture(),ambiguous=false){
 const record={id:'inbound_1',organizationId:'org_1',sourceType:'manual',status:'needs_review',receivedAt:new Date('2026-11-02'),createdAt:new Date('2026-11-02'),updatedAt:new Date('2026-11-02'),rawPayloadJson:{},normalizedPayloadJson:{}} as InboundOrderRecord;
 const attempt={id:'attempt_1',parsedDraft:parsed,status:'success',createdAt:new Date('2026-11-02')};
 const snapshots:InboundOrderReviewSnapshot[]=[];
 const tree={schemaVersion:2,rootNodeIds:[],nodes:{}};
 const candidates=scoreProductKnowledgeCandidates({productName:parsed.lineItems[0].productName,sourceText:parsed.lineItems[0].sourceText,materialText:parsed.lineItems[0].materialText},[
  {id:'stickers',name:'All Sport Hard Hat Stickers',description:'White permanent adhesive vinyl, contour cut',category:'Stickers',aiParsingDescription:null},
  ...(ambiguous?[{id:'removable',name:'All Sport Hard Hat Stickers Removable',description:'Removable adhesive version',category:'Stickers',aiParsingDescription:null}]:[]),
 ],5);
 const repo={
  getRecord:async()=>record,getSource:async()=>null,getLatestParseAttempt:async()=>attempt,listParseAttempts:async()=>[attempt],listFiles:async()=>[],
  getLatestReviewSnapshot:async()=>snapshots[0]??null,listReviewSnapshots:async()=>snapshots,
  searchCustomers:async()=>[],searchCustomerContacts:async()=>[],listCustomerHistoricalContext:async()=>[],
  getCustomer:async()=>null,getContact:async()=>null,
  searchProductCandidates:async()=>candidates,
  getProduct:async(_org:string,id:string)=>({id,name:'All Sport Hard Hat Stickers',isActive:true,measurementMode:'dimensions_required'}),
  getProductActivePbv2Tree:async(_org:string,id:string)=>({product:{id,name:id==='stickers'?'All Sport Hard Hat Stickers':'All Sport Hard Hat Stickers Removable',pbv2ActiveTreeVersionId:'tree-'+id,measurementMode:'dimensions_required'},activeTree:{id:'tree-'+id,treeJson:tree}}),
  createReviewSnapshotWithEvent:jest.fn(async({snapshot,event}:{snapshot:InboundOrderReviewSnapshot;event:unknown})=>{const created={...snapshot,id:'snapshot_'+(snapshots.length+1),createdAt:new Date()};snapshots.unshift(created);return {snapshot:created,event};}),
  updateRecordWithEvent:async({patch}:{patch:Partial<InboundOrderRecord>})=>{Object.assign(record,patch);return {record,event:{id:'event'}};},
 };
 const pricing=jest.fn<(...args:unknown[])=>Promise<unknown>>(async()=>({lineTotalCents:80000,pbv2TreeVersionId:'tree-stickers',breakdown:{totalCents:80000}}));
 const service=new InboundOrderService(repo as never,undefined,pricing as never);
 return {repo,service,pricing};
}
const args={organizationId:'org_1',inboundRecordId:'inbound_1',actorUserId:'staff'};
beforeEach(()=>{jest.clearAllMocks();});

test('PO fields survive hydration; $718.25 remains separate from $800 canonical pricing and override',async()=>{
 const {repo,service,pricing}=harness();const draft=await service.getReviewDraft(args);
 expect(draft.reviewedCustomerJson.companyName).toBe('Offset House');
 expect(draft.reviewedOrderJson).toMatchObject({poNumber:'26-109691',dueDate:'2026-11-10',fulfillmentType:'pickup',shipMethod:'Customer pickup',internalNotes:expect.stringContaining('END OF DAY')});
 expect(draft.reviewedOrderJson.internalNotes).toContain('$718.25');expect(draft.reviewedLineItemsJson).toHaveLength(1);
 expect(draft.reviewedLineItemsJson[0]).toMatchObject({selectedProductId:'stickers',productName:'All Sport Hard Hat Stickers',quantity:5300,width:4,height:1.5,materialText:'White permanent adhesive vinyl',printSpecs:['4/0'],finishingTexts:['Contour cut','Shrink-wrap in 100s'],pricingReviewJson:{poTotalPriceCents:71825,systemPriceCents:80000,priceOverrideMode:null,priceOverrideValueCents:null,status:'mismatch'}});
 expect(pricing).toHaveBeenCalledWith(expect.objectContaining({quantity:5300,widthIn:4,heightIn:1.5}));
 expect(repo.createReviewSnapshotWithEvent).toHaveBeenCalledTimes(1);
 expect((await service.getReviewDraft(args)).reviewedLineItemsJson).toEqual(draft.reviewedLineItemsJson);
});
test('materially different strong product candidates require confirmation despite a score gap',async()=>{
 const {service}=harness(offsetHouseParsedFixture(),true);const draft=await service.getReviewDraft(args);
 expect(draft.reviewedLineItemsJson[0]).toMatchObject({selectedProductId:null,productUnresolved:true,productName:'All Sport Hard Hat Stickers',quantity:5300});
});
test('document total is retained but not distributed across multiple review lines',async()=>{
 const parsed=offsetHouseParsedFixture();parsed.lineItems.push({...parsed.lineItems[0],productName:'Second job',quantity:100});
 const {service}=harness(parsed);const draft=await service.getReviewDraft(args);
 expect(draft.reviewedLineItemsJson.every(line=>line.pricingReviewJson?.poTotalPriceCents==null)).toBe(true);expect(draft.reviewedOrderJson.internalNotes).toContain('$718.25');
});
test('ordinary name, synonym and specification searches do not require AI descriptions',()=>{
 const inputs=[{productName:'Hard Hat Stickers'},{productName:'Helmet labels'},{sourceText:'white permanent adhesive vinyl contour cut'}];
 for(const input of inputs){
  const results=scoreProductKnowledgeCandidates(input,[{id:'active',name:'Hard Hat Stickers',description:'White permanent adhesive vinyl contour cut',aiParsingDescription:null,category:'Stickers',metadataText:JSON.stringify({synonyms:['Helmet labels']})}],5);
  expect(results[0]?.id).toBe('active');expect(results[0]?.metadata.matchBreakdown.aiParsingScore).toBe(0);
 }
});
test('canonical catalog query scopes active PBV2 versions and searches names, descriptions and option synonyms',async()=>{
 const conditions:Array<{sql:string;params:unknown[]}>=[],dialect=new PgDialect();
 const chain={from:(_table:unknown)=>chain,innerJoin:(_table:unknown,on:SQL)=>{conditions.push(dialect.sqlToQuery(on));return chain;},
  leftJoin:(_table:unknown,on:SQL)=>{conditions.push(dialect.sqlToQuery(on));return chain;},where:(on:SQL)=>{conditions.push(dialect.sqlToQuery(on));return chain;},orderBy:()=>chain,
  limit:async()=>[{id:'active',name:'Hard Hat Stickers',category:'Stickers',description:'White permanent adhesive vinyl',aiParsingDescription:null,activeTreeJson:{synonyms:['Helmet labels']}}]};
 const repository=new InboundOrdersRepository({select:()=>chain} as never);
 const result=await repository.searchProductCandidates({organizationId:'tenant-catalog',productName:'Helmet labels',limit:5});
 expect(result[0].id).toBe('active');
 const sql=conditions.map(condition=>condition.sql).join('\n');
 expect(sql).toContain('"pbv2_tree_versions"."product_id"');expect(sql).toContain('"pbv2_tree_versions"."tree_json"::text ilike');expect(sql).toContain('"products"."is_active"');
 expect(conditions.flatMap(condition=>condition.params)).toEqual(expect.arrayContaining(['ACTIVE','tenant-catalog',true]));
 expect(sql).toContain('"products"."name" ilike');expect(sql).toContain('"products"."description" ilike');
});
