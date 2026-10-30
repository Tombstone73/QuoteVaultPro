import { afterAll, beforeEach, expect, jest, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { GMAIL_MODIFY_SCOPE } from '@shared/inboundGmailAcknowledgement';
import { db, pool } from '../db';
import { InboundOrdersRepository } from '../storage/inboundOrders.repo';
import { InboundGmailAcknowledgementRepository, acknowledgementSourceSnapshot } from '../storage/inboundGmailAcknowledgement.repo';
import { InboundGmailAcknowledgementWorker } from '../services/inboundOrders/InboundGmailAcknowledgementWorker';
import { QuotesRepository } from '../storage/quotes.repo';
import { OrdersRepository } from '../storage/orders.repo';
import { InboundEmailMailboxSettingsService } from '../services/inboundEmailMailboxSettingsService';

const secondPool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const second=drizzle(secondPool,{schema});
let org:string,user:string,id:string,mailbox:schema.InboundEmailMailbox,repo:InboundOrdersRepository,queue:InboundGmailAcknowledgementRepository;
const keys=['WORKERS_ENABLED','WORKER_INBOUND_GMAIL_ACK_ENABLED','INBOUND_GMAIL_ACK_ORGANIZATION_IDS'];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
beforeEach(async()=>{
  org='ack-test-'+randomUUID();user=randomUUID();id=randomUUID();
  delete process.env.WORKERS_ENABLED;process.env.WORKER_INBOUND_GMAIL_ACK_ENABLED='true';process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS=org;
  await db.insert(schema.organizations).values({id:org,name:'Isolated Gmail acknowledgement',slug:org});
  await db.insert(schema.users).values({id:user,email:user+'@example.invalid',role:'owner'});
  [mailbox]=await db.insert(schema.inboundEmailMailboxes).values({organizationId:org,provider:'gmail',name:'Synthetic Gmail',emailAddress:'synthetic@example.invalid',enabled:true,
    settingsJson:{gmailAcknowledgementEnabled:true},authJson:{scope:GMAIL_MODIFY_SCOPE,refreshToken:'synthetic-token',connectedEmail:'synthetic@example.invalid'}}).returning();
  await db.insert(schema.inboundOrderRecords).values({id,organizationId:org,sourceType:'email',sourceMessageId:'covered-1',status:'needs_review',rawPayloadJson:{provider:'gmail',mailbox:{id:mailbox.id,emailAddress:mailbox.emailAddress},messageId:'covered-1',subject:'Synthetic PO',bodyText:'Reviewed order',thread:{messages:[{messageId:'covered-1',bodyText:'First'},{messageId:'covered-2',bodyText:'Second'}]}}});
  repo=new InboundOrdersRepository(db);queue=new InboundGmailAcknowledgementRepository(db);
});
afterAll(async()=>{for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];await secondPool.end();await pool.end();});
const jobs=()=>db.select().from(schema.inboundGmailAcknowledgements).where(eq(schema.inboundGmailAcknowledgements.organizationId,org));
const record=()=>repo.getRecord(org,id);
const state=()=>repo.getEvidenceState(org,id);
const orderRows=()=>db.select().from(schema.orders).where(eq(schema.orders.organizationId,org));
const expire=(j:any)=>db.update(schema.inboundGmailAcknowledgements).set({claimExpiresAt:new Date(0)}).where(eq(schema.inboundGmailAcknowledgements.id,j.id));
const due=()=>db.update(schema.inboundGmailAcknowledgements).set({nextAttemptAt:new Date(0)}).where(eq(schema.inboundGmailAcknowledgements.organizationId,org));
const worker=(provider:any,q=queue)=>new InboundGmailAcknowledgementWorker(q,provider);
async function quote(link=true){
  const customerId=randomUUID(),productId=randomUUID();
  await db.insert(schema.customers).values({id:customerId,organizationId:org,companyName:'Synthetic QA customer',creditLimit:'1000000',creditLimitConfiguredAt:new Date()});
  await db.insert(schema.products).values({id:productId,organizationId:org,name:'Synthetic test item',description:'Isolated test',requiresProductionJob:false,requiresProofApproval:false});
  const result=await new QuotesRepository(db).createQuote(org,{userId:user,customerId,customerName:'Synthetic QA customer',source:'internal',status:'draft',subtotal:10,taxAmount:0,taxableSubtotal:10,totalPrice:10,
    lineItems:[{productId,productName:'Synthetic test item',quantity:1,width:12,height:18,selectedOptions:[],linePrice:10,priceBreakdown:{basePrice:10,optionsPrice:0,total:10,formula:'test'},pbv2SnapshotJson:{},taxAmount:0,isTaxableSnapshot:true,requiresDesign:false,requiresPrepress:false}]} as any);
  if(link){const current=await state(),fp=current.fingerprint;await db.update(schema.inboundOrderRecords).set({createdQuoteId:result.id,normalizedPayloadJson:{...current.record.normalizedPayloadJson,evidenceFingerprint:fp,quoteEvidenceFingerprint:fp}}).where(eq(schema.inboundOrderRecords.id,id));}
  return result;
}
const convert=(quoteId:string,database:any=db)=>new OrdersRepository(database).convertQuoteToOrder(org,quoteId,user,{productionIntakePolicy:'deferred'});
async function entered(){const q=await quote();return convert(q.id);}
async function change(){const r=(await record())!;return repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,patch:{rawPayloadJson:{...r.rawPayloadJson,bodyText:'New unresolved reply',thread:{messages:[...(r.rawPayloadJson as any).thread.messages,{messageId:'new-unprocessed',bodyText:'Revision'}]}}},event:{actorType:'system',eventType:'email.updated'}});}

test('canonical competing Quote conversions create one Order and one immutable acknowledgement outbox',async()=>{
  const q=await quote();expect(await jobs()).toHaveLength(0);
  const [a,b]=await Promise.all([convert(q.id),convert(q.id,second)]);expect(a.id).toBe(b.id);
  expect(await jobs()).toHaveLength(1);expect((await jobs())[0]).toMatchObject({orderId:a.id,messageIds:['covered-1','covered-2'],status:'waiting'});
});
test('drafts, approval, quote status and dismissal alone schedule no Entered update',async()=>{
  const fp=(await state()).fingerprint;
  const attempt=await repo.createParseAttempt({organizationId:org,inboundOrderRecordId:id,status:'success',rawResponse:{inboundEvidenceFingerprint:fp}});
  const snapshot=await repo.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:id,snapshotType:'approval',payloadJson:{metadata:{snapshotKind:'editable_review_draft'}}},evidenceSourceParseAttemptId:attempt.id,event:{actorType:'user',eventType:'test.draft'}});
  await repo.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:id,snapshotType:'approval',payloadJson:{...snapshot.snapshot.payloadJson,status:'ready_to_convert'}},evidenceSourceSnapshotId:snapshot.snapshot.id,recordPatch:{status:'ready'},event:{actorType:'user',eventType:'test.approve'}});
  const q=await quote();await repo.markLinkedQuoteCompleted({organizationId:org,quoteId:q.id,quoteStatus:'active',completionSource:'quote_status'});
  await repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,expectedEvidenceFingerprint:fp,patch:{status:'ignored'},event:{actorType:'user',actorUserId:user,eventType:'review.ignored'}});
  expect(await jobs()).toHaveLength(0);
});
test('failure after canonical linkage rolls back Order, evidence resolution and acknowledgement together',async()=>{
  const q=await quote();const before=await record();
  const original=InboundOrdersRepository.prototype.markLinkedQuoteOrderConverted;
  const fault=jest.spyOn(InboundOrdersRepository.prototype,'markLinkedQuoteOrderConverted').mockImplementation(async function(this:InboundOrdersRepository,args){await original.call(this,args);expect(await new InboundGmailAcknowledgementRepository(second as any).list(org)).toHaveLength(0);throw new Error('Synthetic post-link failure');});
  try{await expect(convert(q.id)).rejects.toThrow('Synthetic post-link failure');}finally{fault.mockRestore();}
  expect(await orderRows()).toHaveLength(0);expect(await jobs()).toHaveLength(0);expect(await record()).toEqual(before);
});
test('explicit current-evidence Order attachment enqueues once without duplicating the job',async()=>{
  const q=await quote(false),order=await convert(q.id);const fp=(await state()).fingerprint;
  const attach=()=>repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,expectedEvidenceFingerprint:fp,patch:{status:'submitted',normalizedPayloadJson:{attachedOrderId:order.id}},event:{actorType:'user',actorUserId:user,eventType:'order.attached'}});
  await Promise.all([attach(),attach()]);expect(await jobs()).toHaveLength(1);expect(await orderRows()).toHaveLength(1);
});
test('new evidence during delayed acknowledgement remains unresolved and its message is never modified',async()=>{
  const order=await entered();let release!:()=>void,enteredProvider!:()=>void;
  const barrier=new Promise<void>(r=>{enteredProvider=r;}),resume=new Promise<void>(r=>{release=r;});
  const modified:string[][]=[];
  const running=worker({acknowledge:async(_m:any,ids:string[],guard:any)=>{enteredProvider();await resume;await guard();modified.push(ids);}}).runOnce(1);
  try{await barrier;await change();}finally{release();await running;}
  expect(modified).toEqual([['covered-1','covered-2']]);expect(await record()).toMatchObject({createdOrderId:order.id,status:'needs_review'});
  expect((await jobs())[0].status).toBe('succeeded');expect(await orderRows()).toHaveLength(1);
});
test('claims use separate real connections and fence a replaced worker before a Gmail write',async()=>{
  await entered();const other=new InboundGmailAcknowledgementRepository(second as any);
  const holder=await pool.connect();
  try{await holder.query('begin');await holder.query('select id from inbound_email_mailboxes where id=$1 for update',[mailbox.id]);
    expect(await Promise.all([queue.claim(),other.claim()])).toEqual([null,null]);
  }finally{await holder.query('rollback');holder.release();}
  const claims=await Promise.all([queue.claim(),other.claim()]);expect(claims.filter(Boolean)).toHaveLength(1);
  const first=claims.find(Boolean)!;await expire(first);const replacement=(await other.claim())!;
  expect(replacement.claimToken).not.toBe(first.claimToken);await expect(queue.guard(first)).rejects.toThrow();
  expect(await queue.heartbeat(first)).toBe(false);expect(await queue.finish(first)).toBe(false);expect(await other.finish(replacement)).toBe(true);
});
test('provider transient failures back off, exhaust, and staff retry only Gmail without recreating Orders',async()=>{
  await entered();const provider={acknowledge:jest.fn(async()=>{throw Object.assign(new Error('private-token-body'),{status:503});})};
  for(let n=1;n<=3;n++){await worker(provider).runOnce(1);expect((await jobs())[0].status).toBe(n===3?'failed':'retrying');expect(await queue.claim()).toBeNull();await due();}
  const [job]=await jobs();await queue.retry(org,job.id,user);await expect(queue.retry(org,job.id,user)).rejects.toThrow();
  await worker({acknowledge:async()=>undefined}).runOnce(1);expect((await jobs())[0].status).toBe('succeeded');expect(await orderRows()).toHaveLength(1);
  expect(JSON.stringify(await jobs())).not.toContain('private-token-body');
});
test('remote success followed by local audit failure rolls back completion and safely retries the same messages',async()=>{
  await entered();const provider={acknowledge:jest.fn<(...args:any[])=>Promise<void>>(async()=>{})};
  await pool.query(`create function public.qa_reject_ack_event() returns trigger language plpgsql as $$ begin if new.event_type='email.acknowledged' then raise exception 'Synthetic acknowledgement audit failure'; end if; return new; end $$`);
  await pool.query(`create trigger qa_reject_ack_event before insert on inbound_order_events for each row execute function public.qa_reject_ack_event()`);
  try{await worker(provider).runOnce(1);expect((await jobs())[0].status).toBe('retrying');expect((await repo.listEvents(org,id)).some(e=>e.eventType==='email.acknowledged')).toBe(false);}
  finally{await pool.query('drop trigger qa_reject_ack_event on inbound_order_events');await pool.query('drop function public.qa_reject_ack_event()');}
  await due();await worker(provider).runOnce(1);expect((await jobs())[0].status).toBe('succeeded');expect(provider.acknowledge).toHaveBeenCalledTimes(2);
  expect(provider.acknowledge.mock.calls[0][1]).toEqual(provider.acknowledge.mock.calls[1][1]);expect(await orderRows()).toHaveLength(1);
});
test('readonly mailbox remains import-compatible and requires deliberate reconnect/retry for acknowledgement',async()=>{
  await db.update(schema.inboundEmailMailboxes).set({authJson:{scope:'https://www.googleapis.com/auth/gmail.readonly',refreshToken:'retained'}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  await entered();expect((await jobs())[0].status).toBe('reconnect_required');const provider={acknowledge:jest.fn()};await worker(provider as any).runOnce();expect(provider.acknowledge).not.toHaveBeenCalled();
  await queue.retry(org,(await jobs())[0].id,user);await worker(provider as any).runOnce();expect((await jobs())[0].status).toBe('reconnect_required');expect(provider.acknowledge).not.toHaveBeenCalled();
});
test.each([401,403,404])('provider %s is visible and does not undo Order resolution',async status=>{
  await entered();await worker({acknowledge:async()=>{throw Object.assign(new Error('secret'),{status});}}).runOnce(1);
  expect((await jobs())[0].status).toBe(status===404?'needs_attention':'reconnect_required');expect((await record())?.status).toBe('submitted');expect(await orderRows()).toHaveLength(1);
});
test('rate limit 403 is retryable and distinct from insufficient permission',async()=>{
  await entered();await worker({acknowledge:async()=>{throw {response:{status:403,data:{error:{errors:[{reason:'rateLimitExceeded'}]}}}};}}).runOnce(1);
  expect((await jobs())[0].status).toBe('retrying');
});
test('global, tenant and mailbox rollout controls prevent all Gmail calls',async()=>{
  await entered();const provider={acknowledge:jest.fn()};delete process.env.WORKER_INBOUND_GMAIL_ACK_ENABLED;await worker(provider as any).runOnce();
  process.env.WORKER_INBOUND_GMAIL_ACK_ENABLED='true';process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS='foreign';await worker(provider as any).runOnce();
  process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS=org;await db.update(schema.inboundEmailMailboxes).set({settingsJson:{gmailAcknowledgementEnabled:false}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));await worker(provider as any).runOnce();
  await db.update(schema.inboundEmailMailboxes).set({settingsJson:{gmailAcknowledgementEnabled:'true'}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));await worker(provider as any).runOnce();
  expect(provider.acknowledge).not.toHaveBeenCalled();expect((await jobs())[0].attempts).toBe(0);
});
test('mailboxes are not enrolled or backfilled automatically on later activation',async()=>{
  await db.update(schema.inboundEmailMailboxes).set({settingsJson:{}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));const q=await quote();await convert(q.id);expect(await jobs()).toHaveLength(0);
  await db.update(schema.inboundEmailMailboxes).set({settingsJson:{gmailAcknowledgementEnabled:true}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));await convert(q.id);expect(await jobs()).toHaveLength(0);
});
test('foreign tenant cannot inspect/retry and a mailbox account change prevents provider calls',async()=>{
  await entered();const [job]=await jobs();expect(await queue.list('foreign')).toHaveLength(0);await expect(queue.retry('foreign',job.id,user)).rejects.toThrow();
  await db.update(schema.inboundEmailMailboxes).set({emailAddress:'different@example.invalid'}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));const provider={acknowledge:jest.fn()};await worker(provider as any).runOnce();expect(provider.acknowledge).not.toHaveBeenCalled();expect((await jobs())[0].status).toBe('needs_attention');
});
test('a foreign mailbox reference cannot schedule or modify that tenant mailbox',async()=>{
  const foreign='foreign-'+randomUUID();await db.insert(schema.organizations).values({id:foreign,name:'Other synthetic tenant',slug:foreign});
  const [foreignMailbox]=await db.insert(schema.inboundEmailMailboxes).values({organizationId:foreign,provider:'gmail',name:'Foreign synthetic mailbox',emailAddress:mailbox.emailAddress,settingsJson:{gmailAcknowledgementEnabled:true}}).returning();
  const r=(await record())!;await db.update(schema.inboundOrderRecords).set({rawPayloadJson:{...r.rawPayloadJson,mailbox:{id:foreignMailbox.id,emailAddress:mailbox.emailAddress}}}).where(eq(schema.inboundOrderRecords.id,id));
  await entered();expect(await jobs()).toHaveLength(0);expect(await queue.list(foreign)).toHaveLength(0);
});
test('stale Quote coverage creates the actual Order without acknowledging newer evidence',async()=>{
  const q=await quote();await change();await convert(q.id);expect(await orderRows()).toHaveLength(1);expect(await jobs()).toHaveLength(0);expect((await record())?.status).toBe('needs_review');
});
test('a frozen reviewed Quote manifest acknowledges earlier evidence after conversion while a newer reply stays pending',async()=>{
  const q=await quote(),r=(await record())!;
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{...r.normalizedPayloadJson,quoteGmailAcknowledgementSources:acknowledgementSourceSnapshot(r)}}).where(eq(schema.inboundOrderRecords.id,id));
  await change();await convert(q.id);const provider={acknowledge:jest.fn(async()=>{})};await worker(provider).runOnce(1);
  expect(provider.acknowledge).toHaveBeenCalledWith(expect.anything(),['covered-1','covered-2'],expect.any(Function));expect((await record())?.status).toBe('needs_review');expect(await orderRows()).toHaveLength(1);
});
test('a prior dismissal is not silently overridden by frozen Quote acknowledgement when later evidence reopens the record',async()=>{
  const q=await quote(),r=(await record())!,fp=(await state()).fingerprint;
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{...r.normalizedPayloadJson,quoteGmailAcknowledgementSources:acknowledgementSourceSnapshot(r)}}).where(eq(schema.inboundOrderRecords.id,id));
  await repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,expectedEvidenceFingerprint:fp,patch:{status:'ignored'},event:{actorType:'user',actorUserId:user,eventType:'review.ignored'}});
  await change();await convert(q.id);expect(await jobs()).toHaveLength(0);expect((await record())?.status).toBe('needs_review');expect(await orderRows()).toHaveLength(1);
});
test('three abandoned claims exhaust and an authorized retry recovers a fresh lease',async()=>{
  await entered();for(let i=0;i<3;i++){const j=(await queue.claim())!;await expire(j);}expect(await queue.claim()).toBeNull();expect((await jobs())[0].status).toBe('failed');await queue.retry(org,(await jobs())[0].id,user);expect((await queue.claim())?.attempts).toBe(1);
});
test('same-account reconnect preserves real stored refresh credentials and mailbox enrollment',async()=>{
  const result=await new InboundEmailMailboxSettingsService(db).connectGmailMailbox({organizationId:org,emailAddress:mailbox.emailAddress,reconnectMailboxId:mailbox.id,actorUserId:user,scopes:GMAIL_MODIFY_SCOPE});
  const [persisted]=await db.select().from(schema.inboundEmailMailboxes).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  expect((persisted.authJson as any).refreshToken).toBe('synthetic-token');expect(result.acknowledgementPermission).toBe('available');expect((persisted.settingsJson as any).gmailAcknowledgementEnabled).toBe(true);
});
test('missing replacement credentials for a different account rolls back and preserves the valid connection',async()=>{
  const [before]=await db.select().from(schema.inboundEmailMailboxes).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  await expect(new InboundEmailMailboxSettingsService(db).connectGmailMailbox({organizationId:org,emailAddress:'other@example.invalid',reconnectMailboxId:mailbox.id,actorUserId:user,scopes:GMAIL_MODIFY_SCOPE})).rejects.toThrow('No reusable');
  const [after]=await db.select().from(schema.inboundEmailMailboxes).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));expect(after).toEqual(before);
});
test('incomplete evidence cannot be attached/resolved or acknowledged through a direct request',async()=>{
  const q=await quote(false),order=await convert(q.id);await repo.createFile({organizationId:org,inboundRecordId:id,sourceFilename:'missing-po.pdf',status:'uploaded'});
  await expect(repo.updateRecordWithEvent({organizationId:org,inboundRecordId:id,expectedEvidenceFingerprint:(await state()).fingerprint,patch:{status:'submitted',normalizedPayloadJson:{attachedOrderId:order.id}},event:{actorType:'user',actorUserId:user,eventType:'order.attached'}})).rejects.toThrow('unavailable');
  expect(await jobs()).toHaveLength(0);expect((await record())?.normalizedPayloadJson?.attachedOrderId).toBeUndefined();
});
test('direct approved inbound-to-Order completion schedules in the canonical resolution transaction',async()=>{
  const q=await quote(false),order=await convert(q.id),fp=(await state()).fingerprint;
  const attempt=await repo.createParseAttempt({organizationId:org,inboundOrderRecordId:id,status:'success',rawResponse:{inboundEvidenceFingerprint:fp}});
  const saved=await repo.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:id,snapshotType:'approval',payloadJson:{metadata:{snapshotKind:'editable_review_draft'}}},evidenceSourceParseAttemptId:attempt.id,event:{actorType:'user',eventType:'test.draft'}});
  const approved=await repo.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:id,snapshotType:'approval',payloadJson:{...saved.snapshot.payloadJson,status:'ready_to_convert'}},evidenceSourceSnapshotId:saved.snapshot.id,recordPatch:{status:'ready'},event:{actorType:'user',eventType:'test.approve'}});
  await repo.transaction(async(_tx,r)=>{
    await r.claimInboundOrderForOrderConversion({organizationId:org,inboundRecordId:id,actorUserId:user,snapshotId:approved.snapshot.id});
    await r.markInboundOrderConvertedToOrder({organizationId:org,inboundRecordId:id,actorUserId:user,orderId:order.id,lineItemLinks:[]});
  });
  await repo.markInboundOrderConvertedToOrder({organizationId:org,inboundRecordId:id,actorUserId:user,orderId:order.id,lineItemLinks:[]});expect(await jobs()).toHaveLength(1);
});
test('new combined-source manifests acknowledge frozen covered IDs, never later child replies',async()=>{
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{combinedSources:[{recordId:'synthetic-child',sourceType:'email',messageManifest:{mailboxId:mailbox.id,providerAccount:mailbox.emailAddress,messageIds:['child-reviewed']},evidence:{bodyText:'Reviewed child request'}}]}}).where(eq(schema.inboundOrderRecords.id,id));
  await entered();expect((await jobs())[0].messageIds).toEqual(['child-reviewed','covered-1','covered-2']);
});
test('legacy combined evidence without a frozen child manifest requires reconciliation and cannot be retried into writes',async()=>{
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{combinedSources:[{recordId:'legacy-child',sourceType:'email',sourceMessageId:'untracked',evidence:{bodyText:'Legacy text only'}}]}}).where(eq(schema.inboundOrderRecords.id,id));
  await entered();const [job]=await jobs();expect(job.status).toBe('needs_attention');expect((await queue.list(org))[0].canRetry).toBe(false);await expect(queue.retry(org,job.id,user)).rejects.toThrow();
  const provider={acknowledge:jest.fn()};await worker(provider as any).runOnce();expect(provider.acknowledge).not.toHaveBeenCalled();
});
test('ambiguous combined accounts retain the committed Order but cannot be retried into the wrong mailbox',async()=>{
  await db.update(schema.inboundOrderRecords).set({normalizedPayloadJson:{combinedSources:[{recordId:'different-account-child',sourceType:'email',messageManifest:{mailboxId:mailbox.id,providerAccount:'old-account@example.invalid',messageIds:['other-account-message']},evidence:{bodyText:'Reviewed combined source'}}]}}).where(eq(schema.inboundOrderRecords.id,id));
  await entered();const [job]=await jobs();expect(job.errorCode).toBe('AMBIGUOUS_SOURCE_ACCOUNT');expect((await queue.list(org))[0].canRetry).toBe(false);await expect(queue.retry(org,job.id,user)).rejects.toThrow();expect(await orderRows()).toHaveLength(1);
});
test('succeeded remote stub followed by killed process recovers the same IDs and never another Order',async()=>{
  await entered();const childEnv={...process.env,INBOUND_ACK_CRASH_CHILD:'true'};
  for(const k of ['DATABASE_URL','MIGRATION_DATABASE_URL','DIRECT_DATABASE_URL'])delete (childEnv as any)[k];
  const child=spawn(process.execPath,['node_modules/jest/bin/jest.js','--config','jest.inbound-postgres.config.js','--runInBand','--testMatch','**/inboundAckCrash.postgres.child.ts','--runTestsByPath','server/tests/helpers/inboundAckCrash.postgres.child.ts'],{cwd:process.cwd(),env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',enteredChild=false;const closed=new Promise<void>(r=>child.once('close',()=>r()));
  try{
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Child did not reach remote-success boundary')),20000);child.stdout.on('data',c=>{output+=String(c);if(output.includes('ACK_REMOTE_APPLIED')){enteredChild=true;clearTimeout(timer);resolve();}});child.stderr.resume();child.once('error',reject);child.once('exit',()=>{if(!enteredChild){clearTimeout(timer);reject(new Error('Child exited early'));}});});
    const [abandoned]=await jobs();child.kill('SIGKILL');await closed;expect((await jobs())[0].status).toBe('processing');await expire(abandoned);
    const provider={acknowledge:jest.fn(async()=>undefined)};await worker(provider).runOnce(1);
    expect(provider.acknowledge).toHaveBeenCalledWith(expect.objectContaining({id:mailbox.id}),['covered-1','covered-2'],expect.any(Function));
    expect((await jobs())[0].status).toBe('succeeded');expect(await orderRows()).toHaveLength(1);
  }finally{if(!child.killed)child.kill('SIGKILL');await closed;}
});
