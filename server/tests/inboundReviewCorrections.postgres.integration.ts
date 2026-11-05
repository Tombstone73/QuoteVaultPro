import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, test } from '@jest/globals';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { db, pool } from '../db';
import * as schema from '@shared/schema';
import { inboundOrderParsedDraftSchema, inboundOrderReviewDraftSaveSchema, inboundOrderArtworkLinkSchema } from '@shared/inboundOrdersApi';
import { projectInboundReviewIssues } from '@shared/inboundReviewIssues';
import { InboundOrdersRepository } from '../storage/inboundOrders.repo';
import { InboundOrderService } from '../services/inboundOrders/InboundOrderService';
import { InboundEmailIntakeSettingsService } from '../services/inboundEmailIntakeSettingsService';
import { registerInboundOrderRoutes } from '../routes/inboundOrders.routes';
import { registerOrganizationRoutes } from '../routes/organization.routes';
import { priceLineItem } from '../services/pricing/PricingService';
import { storageApplicationService } from '../services/storage/StorageApplicationService';
import { PDFDocument } from 'pdf-lib';
import { deleteFile } from '../utils/fileStorage';
import { afterEach } from '@jest/globals';

let org: string, user: string, id: string;
const repo = new InboundOrdersRepository(db), service = new InboundOrderService(repo);
const identity = () => ({ organizationId:org, inboundRecordId:id, actorUserId:user });
beforeEach(async () => {
  org = randomUUID(); user = randomUUID(); id = randomUUID();
  await db.insert(schema.organizations).values({ id:org, name:'Isolated inbound review', slug:org });
  await db.insert(schema.users).values({ id:user, email:`${user}@example.invalid`, role:'owner' });
  await db.insert(schema.inboundOrderRecords).values({ id, organizationId:org, sourceType:'email', status:'needs_review',
    rawPayloadJson:{ subject:'Please Quote: Vinyl for Vehicle Trailer',bodyText:'Quantity 3, finished size 24 x 18 inches. Quote only.' } });
  await repo.completeEmailImport(org,id,user);
});
afterAll(async () => pool.end());
afterEach(async () => {
  const placements=await db.select({path:schema.storagePlacements.localPathRef}).from(schema.storagePlacements).innerJoin(schema.fileRecords,eq(schema.fileRecords.id,schema.storagePlacements.fileRecordId)).where(eq(schema.fileRecords.organizationId,org));
  for(const placement of placements)if(placement.path)await deleteFile(placement.path);
});
function app(role='staff', tenant=org) {
  const app = express(); app.use(express.json());
  const auth = (req:any,_res:any,next:()=>void) => { req.user={ id:user,role };req.organizationId=tenant;req.actorOrgRole=role;req.orgRole=role;next(); };
  registerInboundOrderRoutes(app,{ isAuthenticated:auth,tenantContext:auth,assertInternalUser:()=>true,inboundOrderService:service });
  registerOrganizationRoutes(app,{ isAuthenticated:auth,tenantContext:auth,requireOrgOwnerAdmin:(_req:any,_res:any,next:()=>void)=>next() });
  return app;
}
async function fixture(sourceQuantity=5) {
  const [customer] = await db.insert(schema.customers).values({ organizationId:org,companyName:'Elite Printing Inc.' }).returning();
  const [product] = await db.insert(schema.products).values({ organizationId:org,name:'Vehicle trailer vinyl',description:'Synthetic vehicle application vinyl',isActive:true,
    measurementMode:'dimensions_required',pricingMode:'area',pricingProfileKey:'default' }).returning();
  const [version] = await db.insert(schema.pbv2TreeVersions).values({ organizationId:org,productId:product.id,status:'ACTIVE',schemaVersion:2,
    treeJson:{ schemaVersion:2,meta:{ pricingV2:{ tierBasis:'line_item_quantity',base:{ perSqftCents:400,minimumChargeCents:1200 },qtyTiers:[] } },rootNodeIds:[],nodes:{} } }).returning();
  await db.update(schema.products).set({pbv2ActiveTreeVersionId:version.id}).where(eq(schema.products.id,product.id));
  const parsed = inboundOrderParsedDraftSchema.parse({ customer:{companyName:customer.companyName},order:{intent:'quote',jobLabel:'Vehicle Trailer Vinyl'},
    lineItems:[{ productName:product.name,quantity:3,width:24,height:18,dimensionsUnit:'in', candidateProductIds:[product.id],productCandidates:[{id:product.id,label:product.name,confidence:99}] }],
    missingDecisions:[{field:'lineItems.0.quantity',label:'Confirm source quantity',reason:'Quantity differs from source evidence.',severity:'blocking'}],
    evidence:{reconciliation:{ quantity:{value:sourceQuantity,status:'confirmed',sources:[{sourceType:'EMAIL_BODY',label:'Email',sourceText:`Quantity ${sourceQuantity}`}]},product:{},dimensions:{},material:{},dueDate:{},rushStatus:{},artworkStatus:{},pricingStatus:{} } } });
  const fingerprint = (await repo.getEvidenceState(org,id)).fingerprint;
  await repo.createParseAttempt({ organizationId:org,inboundOrderRecordId:id,status:'success',parsedDraft:parsed,rawResponse:{inboundEvidenceFingerprint:fingerprint} });
  const initialized = await service.getReviewDraft(identity());
  const input = inboundOrderReviewDraftSaveSchema.parse({ ...initialized,expectedSnapshotId:initialized.snapshotId,expectedEvidenceFingerprint:fingerprint,
    reviewedCustomerJson:{...initialized.reviewedCustomerJson,selectedCustomerId:customer.id,selectedCustomerSource:'staff_selected',unresolvedCustomer:false},
    reviewedOrderJson:{...initialized.reviewedOrderJson,intent:'quote',jobLabel:'Vehicle Trailer Vinyl',internalNotes:'Keep customer request; quote only.'},
    reviewedLineItemsJson:[{...initialized.reviewedLineItemsJson[0],selectedProductId:product.id,selectedProductSource:'staff_selected',productUnresolved:false,pbv2TreeVersionId:version.id,quantity:3,width:24,height:18,dimensionsUnit:'in'}],
    reviewedArtworkJson:{...initialized.reviewedArtworkJson,status:'missing'} });
  return { parsed,input,fingerprint,customer,product,version,initialized };
}
async function confirm(f:Awaited<ReturnType<typeof fixture>>, reason?:string) {
  const issue = projectInboundReviewIssues(inboundOrderReviewDraftSaveSchema.parse(f.input),f.parsed).find(issue=>issue.field==='lineItems.0.quantity')!;
  return service.saveReviewDraft({...identity(),draft:{...f.input,reviewAction:{issueId:issue.id,action:'confirm_current',reason}}});
}
test('actual route records actor/evidence/value history and fresh database readback without an Order', async()=>{
  const f=await fixture(); const issue=projectInboundReviewIssues(f.input,f.parsed)[0];
  const response=await request(app()).put(`/api/inbound-orders/${id}/review-draft`).send({...f.input,reviewAction:{issueId:issue.id,action:'confirm_current'}});
  expect(response.status).toBe(200);expect(response.body.data.reviewResolutionsJson[0]).toMatchObject({actorUserId:user,confirmedValue:3,originalInterpretation:3,evidenceFingerprint:f.fingerprint,reason:null});
  const readback=await new InboundOrderService(new InboundOrdersRepository(db)).getReviewDraft(identity());
  expect(readback.reviewResolutionsJson).toEqual(response.body.data.reviewResolutionsJson);
  expect(readback.reviewedLineItemsJson[0]).toMatchObject({quantity:3,width:24,height:18});
  expect(projectInboundReviewIssues(readback,readback.reviewInterpretation??null)[0].status).toBe('resolved');
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toEqual([]);
  expect((await repo.listEvents(org,id)).some(event=>event.eventType==='review_draft.saved'&&event.actorUserId===user)).toBe(true);
});
test('source 3 and AI 3 do not leave a stale conflict or require artwork to create a canonical Draft Quote', async()=>{
  const f=await fixture(3); const saved=await service.saveReviewDraft({...identity(),draft:f.input});
  const preview=await service.getQuoteDraftPreview(identity());expect(preview.blockingReasons).toEqual([]);
  const result=await service.createQuoteDraftFromInbound(identity());
  const quote=(await db.select().from(schema.quotes).where(eq(schema.quotes.id,result.quote.id)))[0];
  const lines=await db.select().from(schema.quoteLineItems).where(eq(schema.quoteLineItems.quoteId,quote.id));
  expect(quote).toMatchObject({status:'draft',customerId:f.customer.id,label:'Vehicle Trailer Vinyl'});
  expect(lines[0]).toMatchObject({productId:f.product.id,quantity:3,width:'24.00',height:'18.00'}); expect(Number(quote.totalPrice)).toBeGreaterThan(0);
  expect((await service.createQuoteDraftFromInbound(identity())).quote.id).toBe(quote.id);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toEqual([]);
  expect((await repo.listEvents(org,id)).find(event=>event.eventType==='review.quote_created')?.metadataJson).toMatchObject({snapshotId:saved.snapshotId});
});
test('required reason is backend-enforced; accepting source is allowed; prior resolutions remain valid', async()=>{
  const f=await fixture();await new InboundEmailIntakeSettingsService().updateSettings(org,{requireAiReviewCorrectionReason:true},{userId:user});
  await expect(confirm(f)).rejects.toThrow('reason required');
  expect((await service.getReviewDraft(identity())).snapshotId).toBe(f.initialized.snapshotId);
  const confirmed=await confirm(f,'Customer confirmed quantity three');
  expect(confirmed.reviewResolutionsJson?.[0].reason).toBe('Customer confirmed quantity three');
  await new InboundEmailIntakeSettingsService().updateSettings(org,{requireAiReviewCorrectionReason:false},{userId:user});
  expect((await service.getReviewDraft(identity())).reviewResolutionsJson).toEqual(confirmed.reviewResolutionsJson);
});
test('unauthorized organization policy change and cross-tenant review save are rejected',async()=>{
  const f=await fixture();const forbidden=await request(app('staff')).patch('/api/organization/preferences/inbound-email-intake').send({requireAiReviewCorrectionReason:true});expect(forbidden.status).toBe(403);
  expect((await new InboundEmailIntakeSettingsService().getSettings(org)).requireAiReviewCorrectionReason).toBe(false);
  const foreign=randomUUID();await db.insert(schema.organizations).values({id:foreign,name:'Foreign tenant',slug:foreign});
  expect((await request(app('owner',foreign)).put(`/api/inbound-orders/${id}/review-draft`).send(f.input)).status).toBe(404);
});
test('stale draft/evidence confirmations roll back and cannot replace staff edits',async()=>{
  const f=await fixture();const saved=await confirm(f);
  await expect(confirm(f)).rejects.toThrow('Saved draft changed');
  await repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,patch:{rawPayloadJson:{subject:'Updated source',bodyText:'Quantity 7'}},event:{actorType:'system',eventType:'test.new_evidence'}});
  const issue=projectInboundReviewIssues(saved,f.parsed)[0];
  await expect(service.saveReviewDraft({...identity(),draft:{...saved,status:'draft',expectedSnapshotId:saved.snapshotId,expectedEvidenceFingerprint:f.fingerprint,reviewAction:{issueId:issue.id,action:'confirm_current'}}})).rejects.toThrow();
  expect((await service.getReviewDraft(identity())).reviewedLineItemsJson[0].quantity).toBe(3);
  await expect(service.createQuoteDraftFromInbound(identity())).rejects.toThrow();
  expect(await db.select().from(schema.quotes).where(eq(schema.quotes.organizationId,org))).toEqual([]);
});
test('reparse and explicit reconciliation preserve staff values; only changed field evidence reopens review',async()=>{
  const f=await fixture();const saved=await confirm(f);const updated=structuredClone(f.parsed);updated.order.requestedDueDate='2026-11-10';
  await repo.createParseAttempt({organizationId:org,inboundOrderRecordId:id,status:'success',parsedDraft:updated,rawResponse:{inboundEvidenceFingerprint:f.fingerprint}});
  const background=await service.getReviewDraft(identity());expect(background.reviewedLineItemsJson[0].quantity).toBe(3);
  expect(projectInboundReviewIssues(background,background.reviewInterpretation??null)[0].status).toBe('resolved');
  const refreshed=await service.refreshReviewDraftFromLatestParse({...identity(),expectedSnapshotId:saved.snapshotId});
  expect(refreshed.reviewedLineItemsJson[0].quantity).toBe(3);expect(projectInboundReviewIssues(refreshed,refreshed.reviewInterpretation??null)[0].status).toBe('resolved');
  updated.evidence.reconciliation!.quantity.value=7;updated.evidence.reconciliation!.quantity.sources[0].sourceText='Quantity 7';
  await repo.createParseAttempt({organizationId:org,inboundOrderRecordId:id,status:'success',parsedDraft:updated,rawResponse:{inboundEvidenceFingerprint:f.fingerprint}});
  const relevant=await service.refreshReviewDraftFromLatestParse({...identity(),expectedSnapshotId:refreshed.snapshotId});
  expect(relevant.reviewedLineItemsJson[0].quantity).toBe(3);expect(projectInboundReviewIssues(relevant,relevant.reviewInterpretation??null)[0].status).toBe('open');
});
test('failed canonical pricing and ambiguous products remain blocked, incomplete Save Draft remains available',async()=>{
  const f=await fixture(3);const incomplete=await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedLineItemsJson:[{...f.input.reviewedLineItemsJson[0],selectedProductId:null,productUnresolved:true,quantity:null,width:null}]}});
  expect(incomplete.reviewedLineItemsJson[0].quantity).toBeNull();await expect(service.createQuoteDraftFromInbound(identity())).rejects.toThrow();
  expect(await db.select().from(schema.quotes).where(eq(schema.quotes.organizationId,org))).toEqual([]);
});
test('existing Order-to-Prepress path still requires deliberate artwork bypass and keeps source identity',async()=>{
  await db.insert(schema.stations).values({id:randomUUID(),organizationId:org,key:'prepress',name:'Prepress',active:true});
  const f=await fixture(3);const saved=await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedOrderJson:{...f.input.reviewedOrderJson,intent:'order'},reviewedArtworkJson:{...f.input.reviewedArtworkJson,status:'to_follow',notes:'Artwork Required; prepare in Prepress'}}});
  const result=await service.createOrderFromReviewDraft({...identity(),draft:{...saved,status:'draft',expectedSnapshotId:saved.snapshotId}});
  expect(result.order.id).toBeTruthy();expect((await repo.getRecord(org,id))?.createdOrderId).toBe(result.order.id);
  const lines=await db.select().from(schema.orderLineItems).where(eq(schema.orderLineItems.orderId,result.order.id));
  expect(lines[0].quantity).toBe(3);expect(lines[0].productionNotes).toContain('Artwork Required');
});

test('source 5 / AI 3 correction to 5 is confirmed, persisted and preserved during reparse',async()=>{
  const f=await fixture();const issue=projectInboundReviewIssues(f.input,f.parsed)[0];
  const saved=await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedLineItemsJson:[{...f.input.reviewedLineItemsJson[0],quantity:5,quantitySource:'staff_selected'}],reviewAction:{issueId:issue.id,action:'confirm_current'}}});
  expect(saved.reviewResolutionsJson?.[0]).toMatchObject({originalInterpretation:3,confirmedValue:5,actorUserId:user});
  expect((await service.getReviewDraft(identity())).reviewedLineItemsJson[0].quantity).toBe(5);
  expect(projectInboundReviewIssues(saved,saved.reviewInterpretation??null)[0].status).toBe('resolved');
});
test('accepting an AI/source disagreement requires the configured reason, but an agreeing AI/source value does not',async()=>{
  const f=await fixture();await new InboundEmailIntakeSettingsService().updateSettings(org,{requireAiReviewCorrectionReason:true},{userId:user});
  const issue=projectInboundReviewIssues(f.input,f.parsed)[0];
  await expect(service.saveReviewDraft({...identity(),draft:{...f.input,reviewAction:{issueId:issue.id,action:'accept_source'}}})).rejects.toThrow('reason required');
  const saved=await service.saveReviewDraft({...identity(),draft:{...f.input,reviewAction:{issueId:issue.id,action:'accept_source',reason:'PO quantity reviewed'}}});
  expect(saved.reviewedLineItemsJson[0].quantity).toBe(5);
});
test('a concurrent staff save during pricing rejects Quote creation with no partial Quote writes',async()=>{
  const f=await fixture(3);const saved=await service.saveReviewDraft({...identity(),draft:f.input});let raced=false;
  const racing=new InboundOrderService(repo,undefined,async input=>{
    const result=await priceLineItem(input);
    if(!raced){raced=true;await service.saveReviewDraft({...identity(),draft:{...saved,status:'draft',expectedSnapshotId:saved.snapshotId,reviewNotes:'Concurrent staff edit retained'}});}
    return result;
  });
  await expect(racing.createQuoteDraftFromInbound({...identity(),expectedSnapshotId:saved.snapshotId})).rejects.toThrow('Saved draft changed');
  expect((await service.getReviewDraft(identity())).reviewNotes).toBe('Concurrent staff edit retained');
  expect(await db.select().from(schema.quotes).where(eq(schema.quotes.organizationId,org))).toEqual([]);
});
test('concurrent Quote submissions return one canonical Quote without duplicate attachments or Orders',async()=>{
  const f=await fixture(3);await service.saveReviewDraft({...identity(),draft:f.input});
  const results=await Promise.all([service.createQuoteDraftFromInbound(identity()),service.createQuoteDraftFromInbound(identity())]);
  expect(results[0].quote.id).toBe(results[1].quote.id);
  expect(await db.select().from(schema.quotes).where(eq(schema.quotes.organizationId,org))).toHaveLength(1);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toEqual([]);
});
test('canonical stored artwork and source-document provenance survive Quote conversion and retries',async()=>{
  const configs=await db.insert(schema.storageProviderConfigs).values((['canonical','intake'] as const).map(role=>({organizationId:org,providerType:'local_filesystem' as const,role,status:'validated' as const,displayName:'Isolated review storage',configJson:{}}))).returning();
  await db.insert(schema.organizationStorageProfiles).values({organizationId:org,mode:'byos_local',status:'active',primaryProviderConfigId:configs[0].id,intakeProviderConfigId:configs[1].id});
  const pdf=await PDFDocument.create();pdf.addPage([24*72,18*72]);const bytes=Buffer.from(await pdf.save());
  const stored=await storageApplicationService.finalizeUpload({organizationId:org,createdByUserId:user,resource:{organizationId:org,resourceType:'inbound_order',resourceId:id},
    source:{kind:'buffer',buffer:bytes,originalFilename:'Elite-synthetic-art.pdf',mimeType:'application/pdf'},persistLink:async(tx,result)=>{
      const [file]=await tx.insert(schema.inboundOrderFiles).values({organizationId:org,inboundRecordId:id,fileRecordId:result.fileRecord.id,sourceFilename:'Elite-synthetic-art.pdf',role:'artwork',mimeType:'application/pdf',sizeBytes:bytes.length,status:'available',checksum:result.fileRecord.checksum,providerMessageId:'synthetic-message',providerAttachmentId:'synthetic-art',metadataJson:{attachmentClassification:{classification:'ARTWORK',source:'manual_override',confidence:100}}}).returning();return file;
    }});
  const file=stored.linkedRecord;const f=await fixture(3);
  await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedLineItemsJson:[{...f.input.reviewedLineItemsJson[0],artworkLinks:[inboundOrderArtworkLinkSchema.parse({fileId:file.id,fileRecordId:file.fileRecordId,filename:file.sourceFilename,role:'artwork',source:'staff_selected',assignmentSide:'both',classification:'ARTWORK'})]}]}});
  const created=await service.createQuoteDraftFromInbound(identity());await service.createQuoteDraftFromInbound(identity());
  const attachments=await db.select().from(schema.quoteAttachments).where(eq(schema.quoteAttachments.quoteId,created.quote.id));expect(attachments).toHaveLength(1);expect(attachments[0].fileRecordId).toBe(file.fileRecordId);
  expect(await repo.getFile(org,id,file.id)).toMatchObject({fileRecordId:file.fileRecordId,checksum:file.checksum,providerMessageId:'synthetic-message',providerAttachmentId:'synthetic-art',status:'available'});
});
test('confirmed contact, pickup and requested EOD survive canonical Quote persistence instead of stale record matches',async()=>{
  const f=await fixture(3);
  const contacts=await db.insert(schema.customerContacts).values([
    {organizationId:org,firstName:'Old',lastName:'Contact',email:'old@example.invalid'},
    {organizationId:org,firstName:'Staff',lastName:'Selected',email:'selected@example.invalid'},
  ]).returning();
  await db.insert(schema.customerContactLinks).values(contacts.map(contact=>({organizationId:org,customerId:f.customer.id,contactId:contact.id})));
  await db.update(schema.inboundOrderRecords).set({matchedCustomerId:f.customer.id,matchedContactId:contacts[0].id}).where(eq(schema.inboundOrderRecords.id,id));
  const deadline={date:'2026-11-10',kind:'eod' as const,localTime:null,timezone:null,instant:null,sourceText:'Requested November 10 EOD'};
  await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedCustomerJson:{...f.input.reviewedCustomerJson,selectedContactId:contacts[1].id,selectedContactSource:'staff_selected'},reviewedOrderJson:{...f.input.reviewedOrderJson,dueDate:deadline.date,deadlineJson:{requested:deadline,accepted:null},fulfillmentType:'pickup'}}});
  const result=await service.createQuoteDraftFromInbound(identity());
  const [quote]=await db.select().from(schema.quotes).where(eq(schema.quotes.id,result.quote.id));
  expect(quote).toMatchObject({customerId:f.customer.id,contactId:contacts[1].id,billToName:'Staff Selected',billToEmail:'selected@example.invalid',shippingMethod:'pickup',deadlineJson:{requested:deadline,accepted:null}});
  expect(quote.requestedDueDate).toContain('2026-11-10');
  expect((await repo.listEvents(org,id)).find(event=>event.eventType==='review.quote_created')?.metadataJson).toMatchObject({conversionMetadata:{reviewedOrder:{internalNotes:'Keep customer request; quote only.'}}});
});
test('a deliberately cleared contact does not return from the old inbound customer match during Quote conversion',async()=>{
  const f=await fixture(3);
  const [contact]=await db.insert(schema.customerContacts).values({organizationId:org,firstName:'Old',lastName:'Match',email:'old@example.invalid'}).returning();
  await db.insert(schema.customerContactLinks).values({organizationId:org,customerId:f.customer.id,contactId:contact.id});
  await db.update(schema.inboundOrderRecords).set({matchedCustomerId:f.customer.id,matchedContactId:contact.id}).where(eq(schema.inboundOrderRecords.id,id));
  await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedCustomerJson:{...f.input.reviewedCustomerJson,selectedContactId:null,selectedContactSource:'staff_selected'}}});
  const result=await service.createQuoteDraftFromInbound(identity());
  const [quote]=await db.select().from(schema.quotes).where(eq(schema.quotes.id,result.quote.id));
  expect(quote.customerId).toBe(f.customer.id);expect(quote.contactId).toBeNull();
});

test('intake Quote classification hydrates legacy unknown intent, while a deliberate staff choice remains authoritative',async()=>{
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{inboundIntent:'QUOTE_REQUEST'}}).where(eq(schema.inboundOrderRecords.id,id));
  const f=await fixture(3);expect(f.initialized.reviewedOrderJson.intent).toBe('quote');
  const saved=await service.saveReviewDraft({...identity(),draft:{...f.input,reviewedOrderJson:{...f.input.reviewedOrderJson,intent:'unknown',intentSource:'staff_selected'}}});
  expect(saved.reviewedOrderJson.intent).toBe('unknown');expect((await service.getReviewDraft(identity())).reviewedOrderJson.intent).toBe('unknown');
  await expect(service.createOrderFromReviewDraft({...identity(),draft:{...f.input,expectedSnapshotId:saved.snapshotId}})).rejects.toThrow('Quote request');
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toEqual([]);
});
