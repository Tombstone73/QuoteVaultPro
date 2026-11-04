import { expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { extractMachineReadablePdfText, extractPurchaseOrderFields } from '../services/inboundOrders/InboundOrderEvidenceService';
import { renderAssistantPdfPages } from '../services/assistantPdfVision';
import { InboundOrderParsingService } from '../services/inboundOrders/InboundOrderParsingService';
import { inboundOrderEvidenceItemSchema } from '@shared/inboundOrdersApi';
import { scoreProductKnowledgeCandidates } from '../storage/inboundProductKnowledgeMatcher';
import { brainstormParsedFixture, brainstormPoText } from './helpers/brainstormPoRegression';
import type { InboundOrderRecord } from '@shared/schema';
import type { OptionTreeV2 } from '@shared/optionTreeV2';
const tree = {schemaVersion:2,rootNodeIds:[],nodes:{},meta:{fixedDimensions:{widthIn:24,heightIn:18,unit:'in'}}} as OptionTreeV2;
const catalog = [
 {id:'standard',name:'Yard Signs 24x18',category:'Coroplast / Yard Signs',description:'Double sided corrugated plastic yard signs',activeTreeJson:tree},
 {id:'custom',name:'Coroplast',category:'Coroplast / Yard Signs',description:'Custom size corrugated plastic yard signs',activeTreeJson:{schemaVersion:2,rootNodeIds:[],nodes:{}} as OptionTreeV2},
];
test('acceptance: actual PO layout recovers product, literal material and final approved amount without arithmetic or override',()=>{
 const summary=extractPurchaseOrderFields({text:brainstormPoText,receivedAt:'2026-11-04'});
 expect(summary).toMatchObject({poNumber:'152989',quantity:10,material:'4mil Coro',dueDate:'2026-11-05',productDescription:expect.stringContaining('Yard Signs'),pricing:{approvedPriceCents:8000,rushFeesCents:2500}});
 const item=inboundOrderEvidenceItemSchema.parse({type:'PDF_ATTACHMENT',label:'PO',sourceId:'source-po',rawText:brainstormPoText,documentType:'purchase_order',documentConfidence:99,poSummary:summary});
 const parsed=brainstormParsedFixture();const refined=new InboundOrderParsingService({} as never).refineParsedDraft({sourceType:'manual',receivedAt:new Date('2026-11-04'),rawPayloadJson:{bodyText:brainstormPoText}} as unknown as InboundOrderRecord,parsed,{items:[item],conflicts:[]});
 expect(refined.order).toMatchObject({jobLabel:'Titan Bassett Yard Signs',poTotalPriceCents:8000,requestedDeadline:{kind:'eod'}});
 expect(refined.lineItems[0]).toMatchObject({quantity:10,width:15.5,height:24,materialText:'4mil Coro',optionTexts:['Prints 4/4','Different images on each side'],finishingTexts:['Contour cut']});
});
test.each([{width:24,height:18},{width:18,height:24},{}])('acceptance: matching or unspecified size prefers configured yard-sign physical size %j',size=>{
 const matches=scoreProductKnowledgeCandidates({productName:'Yard Signs',...size},catalog,5);expect(matches.filter(match=>match.confidence>=72).map(match=>match.id)).toEqual(['standard']);
});
test('acceptance: custom size excludes fixed mismatch, keeps custom Coroplast and does not require AI descriptions',()=>{
 const matches=scoreProductKnowledgeCandidates({productName:'Yard Signs',materialText:'4mil Coro',width:15.5,height:24,dimensionsUnit:'in'},catalog,5);expect(matches.map(match=>match.id)).toEqual(['custom']);expect(matches[0].confidence).toBeGreaterThanOrEqual(72);
 const metric=scoreProductKnowledgeCandidates({productName:'Yard Signs',width:609.6,height:457.2,dimensionsUnit:'mm'},catalog,5);expect(metric[0].id).toBe('standard');
});
test('acceptance: two materially different compatible products remain ambiguous',()=>{
 const matches=scoreProductKnowledgeCandidates({productName:'Yard Signs',width:15.5,height:24},[...catalog,{...catalog[1],id:'other-custom',name:'Coroplast alternate'}],5);expect(matches.filter(match=>match.confidence>=72)).toHaveLength(2);
});
(process.env.BRAINSTORM_PO_PDF?test:test.skip)('acceptance: original Brainstorm PO text and page render through canonical PDF services',async()=>{
 const bytes=readFileSync(process.env.BRAINSTORM_PO_PDF!);const extracted=await extractMachineReadablePdfText(bytes);expect(extracted.pageCount).toBe(1);expect(extracted.text).toContain('DIFFERENT IMAGES ON EACH SIDE');
 expect(extractPurchaseOrderFields({text:extracted.text,receivedAt:'2026-11-04'})).toMatchObject({poNumber:'152989',quantity:10,material:'4mil Coro',productDescription:expect.stringContaining('Yard Signs'),pricing:{approvedPriceCents:8000,rushFeesCents:2500}});
 const images=await renderAssistantPdfPages(bytes,[1]);expect(Buffer.from(images[0].dataUrl.split(',')[1],'base64').length).toBeGreaterThan(20000);
});

test('acceptance: legacy manual classifications use the newest review rather than overwriting it with an older snapshot',async()=>{
 const {inboundOrderReviewDraftPayloadSchema}=await import('@shared/inboundOrdersApi');
 const payload=(classification:'PO'|'OTHER')=>({...inboundOrderReviewDraftPayloadSchema.parse({reviewedCustomerJson:{},reviewedOrderJson:{},reviewedArtworkJson:{unassignedAttachments:[{fileId:'reviewed-file',classification,classificationSource:'manual_override',manualOverride:true}]}}),metadata:{snapshotKind:'editable_review_draft'}});
 const repository={listReviewSnapshots:async()=>[{createdAt:new Date('2026-11-01'),payloadJson:payload('OTHER')},{createdAt:new Date('2026-11-04'),payloadJson:payload('PO')}]};
 let supplied:Map<string,{classification:string}>|undefined;const evidence={buildEvidenceBundle:async(args:{manualClassifications:Map<string,{classification:string}>})=>{supplied=args.manualClassifications;return {items:[],conflicts:[]};}};
 await new InboundOrderParsingService(repository as never,undefined,evidence as never).buildEvidenceBundle('tenant',{id:'inbound',sourceType:'manual'} as unknown as InboundOrderRecord,[]);
 expect(supplied?.get('file:reviewed-file')?.classification).toBe('PO');
});
