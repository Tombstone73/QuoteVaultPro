import { afterAll, beforeEach, expect, jest, test } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '@shared/schema';
import { db, pool } from '../db';
import { InboundOrdersRepository } from '../storage/inboundOrders.repo';
import { InboundEmailImportRepository } from '../storage/inboundEmailImport.repo';
import { InboundEmailIngestionService, inboundGmailDiscoveryOptions, type InboundEmailProviderAdapter, type InboundEmailProviderMessage } from '../services/inboundEmailIngestionService';
import { InboundEmailProcessingWorker } from '../services/inboundOrders/InboundEmailProcessingWorker';
import { InboundOrderService } from '../services/inboundOrders/InboundOrderService';
import { InboundOrderParsingService } from '../services/inboundOrders/InboundOrderParsingService';
import { inboundOrderParsedDraftSchema } from '@shared/inboundOrdersApi';
import { inboundImportContext } from '../services/inboundOrders/inboundEmailImportContext';

const secondPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const second = drizzle(secondPool, { schema });
let org: string, user: string, mailbox: schema.InboundEmailMailbox, message: InboundEmailProviderMessage;
let imports: InboundEmailImportRepository, records: InboundOrdersRepository;
const envKeys = ['WORKER_INBOUND_EMAIL_IMPORTS_ENABLED','INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS','WORKERS_ENABLED','WORKER_INBOUND_EMAIL_DRAFTS_ENABLED',
  'WORKER_INBOUND_EMAIL_DISCOVERY_ENABLED','INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS'];
const original = Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
beforeEach(async()=>{
  org=`import-test-${randomUUID()}`;user=randomUUID();
  process.env.WORKER_INBOUND_EMAIL_IMPORTS_ENABLED='true';process.env.INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS=org;
  delete process.env.WORKERS_ENABLED;delete process.env.WORKER_INBOUND_EMAIL_DRAFTS_ENABLED;
  delete process.env.WORKER_INBOUND_EMAIL_DISCOVERY_ENABLED; delete process.env.INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS;
  await db.insert(schema.organizations).values({id:org,name:'Isolated import customer',slug:org});
  await db.insert(schema.users).values({id:user,email:`${user}@example.invalid`,role:'owner'});
  [mailbox]=await db.insert(schema.inboundEmailMailboxes).values({organizationId:org,name:'Synthetic Gmail',emailAddress:'orders@shop.invalid',provider:'gmail',createdByUserId:user}).returning();
  imports=new InboundEmailImportRepository(db);records=new InboundOrdersRepository(db);
  await records.createEmailTrustRule({organizationId:org,ruleType:'sender_email_exact',ruleValue:'buyer@customer.invalid',createdByUserId:user,enabled:true});
  message={provider:'gmail',messageId:randomUUID(),threadId:null,senderName:'Synthetic Buyer',senderEmail:'buyer@customer.invalid',
    subject:'Synthetic PO',receivedAt:new Date(),bodyText:'Please review the attached order.',bodyHtml:null,attachments:[]};
});
afterAll(async()=>{for(const key of envKeys)if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];await secondPool.end();await pool.end();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};}
const jobs=()=>db.select().from(schema.inboundEmailImportJobs).where(and(eq(schema.inboundEmailImportJobs.organizationId,org),eq(schema.inboundEmailImportJobs.workKind,'message')));
const inbound=()=>db.select().from(schema.inboundOrderRecords).where(eq(schema.inboundOrderRecords.organizationId,org));
const aiJobs=()=>db.select().from(schema.inboundEmailProcessingJobs).where(eq(schema.inboundEmailProcessingJobs.organizationId,org));
const discover=()=>imports.discover(mailbox,user,[{messageId:message.messageId,threadId:message.threadId}]);
const expire=(job:any)=>db.update(schema.inboundEmailImportJobs).set({claimExpiresAt:new Date(0)}).where(eq(schema.inboundEmailImportJobs.id,job.id));
const due=()=>db.update(schema.inboundEmailImportJobs).set({nextAttemptAt:new Date(0)}).where(eq(schema.inboundEmailImportJobs.organizationId,org));
const attachment=(id:string)=>({filename:`PO-${id}.pdf`,mimeType:'application/pdf',size:4,attachmentId:id});
function provider(overrides:Partial<InboundEmailProviderAdapter>={}):InboundEmailProviderAdapter{
  return {listRecentMessages:async(_mailbox,_limit,onPage)=>{await onPage?.([{messageId:message.messageId,threadId:message.threadId}]);return[message];},
    getMessage:async()=>message,downloadAttachment:async()=>({buffer:Buffer.from('test'),mimeType:'application/pdf',sizeBytes:4}),...overrides};
}
function service(adapter=provider(),database:any=db){
  // Stub physical object I/O only. File records and the canonical persistLink
  // callback use real PostgreSQL transactions (including claim/evidence locks).
  const storage={finalizeUpload:async(input:any)=>database.transaction(async(tx:any)=>{
    const [fileRecord]=await tx.insert(schema.fileRecords).values({organizationId:org,originalFilename:input.source.originalFilename,
      mimeType:input.source.mimeType,sizeBytes:input.source.buffer.length,checksum:createHash('sha256').update(input.source.buffer).digest('hex')}).returning();
    const linkedRecord=await input.persistLink(tx,{fileRecord,storedObject:{storageTarget:'isolated-stub'}});
    return {fileRecord,linkedRecord};
  })};
  return new InboundEmailIngestionService(database,{gmail:adapter},new InboundOrdersRepository(database),storage as any,new InboundEmailImportRepository(database));
}
const pull=(s:InboundEmailIngestionService)=>s.pullLatestEmails({organizationId:org,actorUserId:user});

async function enrollDiscovery() {
  process.env.WORKER_INBOUND_EMAIL_DISCOVERY_ENABLED = 'true';
  process.env.INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS = mailbox.id;
  await db.insert(schema.userOrganizations).values({organizationId:org,userId:user,role:'admin'});
}
const discoveryJobs = () => db.select().from(schema.inboundEmailImportJobs).where(and(
  eq(schema.inboundEmailImportJobs.organizationId, org), eq(schema.inboundEmailImportJobs.workKind, 'discovery')));

test('scheduled discovery is disabled by default and requires both recovery and explicit mailbox enrollment', async () => {
  const s = service();
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  await enrollDiscovery();
  delete process.env.WORKER_INBOUND_EMAIL_IMPORTS_ENABLED;
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  process.env.WORKER_INBOUND_EMAIL_IMPORTS_ENABLED = 'true';
  process.env.INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS = '*';
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  process.env.INBOUND_EMAIL_DISCOVERY_MAILBOX_IDS = mailbox.id;
  process.env.WORKERS_ENABLED = 'false';
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  expect(await discoveryJobs()).toHaveLength(0);
});

test('competing scheduled ticks persist one discovery window, then recovery imports without a manual pull', async () => {
  await enrollDiscovery();
  expect((await Promise.all([service().scheduleAutomaticDiscovery(),service(provider(),second).scheduleAutomaticDiscovery()]))
    .reduce((sum,n)=>sum+n,0)).toBe(1);
  expect(await discoveryJobs()).toHaveLength(1);
  await service().recoverInterruptedImports(3);
  expect(await inbound()).toHaveLength(1);
  expect(await aiJobs()).toHaveLength(1);
  expect(await service().scheduleAutomaticDiscovery()).toBe(0);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toHaveLength(0);
});

test('scheduling enforces tenant, mailbox eligibility, active organization and current administrator membership', async () => {
  await enrollDiscovery(); const s=service();
  process.env.INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS='another-tenant';
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  process.env.INBOUND_EMAIL_IMPORT_ORGANIZATION_IDS=org;
  await db.update(schema.inboundEmailMailboxes).set({enabled:false}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  await db.update(schema.inboundEmailMailboxes).set({enabled:true}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  await db.update(schema.organizations).set({isArchived:true}).where(eq(schema.organizations.id,org));
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  await db.update(schema.organizations).set({isArchived:false}).where(eq(schema.organizations.id,org));
  await db.update(schema.userOrganizations).set({role:'member'}).where(eq(schema.userOrganizations.userId,user));
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  expect(await discoveryJobs()).toHaveLength(0);
});

test('paused intake prevents scheduling and scheduled imports retain the canonical blacklist', async () => {
  await enrollDiscovery(); const s=service();
  await db.update(schema.organizations).set({settings:{preferences:{inboundEmail:{inboundEmailPullPaused:true}}} as any}).where(eq(schema.organizations.id,org));
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  await db.update(schema.organizations).set({settings:{preferences:{inboundEmail:{inboundEmailPullPaused:false}}} as any}).where(eq(schema.organizations.id,org));
  await records.createEmailIgnoreRule({organizationId:org,ruleType:'sender_email_exact',ruleValue:message.senderEmail!,createdByUserId:user,enabled:true});
  expect(await s.scheduleAutomaticDiscovery()).toBe(1);
  await s.recoverInterruptedImports(3);
  expect(await inbound()).toHaveLength(0); expect(await aiJobs()).toHaveLength(0);
  expect((await jobs())[0].status).toBe('skipped');
});

test('scheduled pagination checkpoints the entire bounded window without dropping messages beyond one claim budget', async () => {
  const options={...inboundGmailDiscoveryOptions(mailbox,2,new Date()),drainWindow:true,scheduledThrough:Math.floor(Date.now()/1000)};
  await imports.beginDiscovery(mailbox,user,options);
  const first=(await imports.claim({organizationId:org,mailboxId:mailbox.id,workKind:'discovery'}))!;
  await imports.discoveryPage(first,mailbox,[{messageId:'one',threadId:null},{messageId:'two',threadId:null}],'next-page');
  expect((await discoveryJobs())[0]).toMatchObject({status:'waiting',attempts:0,discoveryJson:{processed:0,pageToken:'next-page',query:options.query}});
  const replacement=(await new InboundEmailImportRepository(second as any).claim({organizationId:org,mailboxId:mailbox.id,workKind:'discovery'}))!;
  await expect(imports.discoveryPage(first,mailbox,[{messageId:'stale',threadId:null}])).rejects.toThrow();
  await imports.discoveryPage(replacement,mailbox,[{messageId:'three',threadId:null}]);
  expect((await discoveryJobs())[0].status).toBe('complete');
  expect((await jobs()).map(j=>j.providerMessageId).sort()).toEqual(['one','three','two']);
});

test('completed scheduled windows retain the configured lookback; failures remain visible and block automatic replacement', async () => {
  await enrollDiscovery(); const s=service(); await s.scheduleAutomaticDiscovery();
  let [first]=await discoveryJobs();
  const claimed=(await imports.claim({organizationId:org,mailboxId:mailbox.id,workKind:'discovery'}))!;
  await imports.fail(claimed,'IMPORT_PROVIDER_UNAVAILABLE',true);
  expect(await s.scheduleAutomaticDiscovery()).toBe(0);
  await imports.retry(org,first.id,user);
  await s.recoverInterruptedImports(3);
  await db.update(schema.inboundEmailImportJobs).set({createdAt:new Date(Date.now()-600_000)}).where(eq(schema.inboundEmailImportJobs.id,first.id));
  expect(await s.scheduleAutomaticDiscovery()).toBe(1);
  const next=(await discoveryJobs()).find(job=>job.id!==first.id)!;
  expect(next.discoveryJson!.query).not.toContain(`after:${first.discoveryJson!.scheduledThrough!-120}`);
  const afterValues = [...next.discoveryJson!.query.matchAll(/after:(\d+)/g)].map(match=>Number(match[1]));
  expect(afterValues.length).toBeGreaterThan(0);
  expect(afterValues.every(value=>value<=Math.floor(Date.now()/1000)-13*86400)).toBe(true);
  expect(next.discoveryJson!.query).toMatch(/before:\d+/);
  await s.recoverInterruptedImports(3);
  expect(await inbound()).toHaveLength(1); expect(await aiJobs()).toHaveLength(1);
  expect(await jobs()).toHaveLength(1);
});

test('scheduled queries retain read mail and bound custom queries even without a date restriction', async () => {
  await enrollDiscovery();
  await db.update(schema.inboundEmailMailboxes).set({settingsJson:{gmailQuery:'is:unread subject:synthetic',labelIds:['UNREAD','QA'],lookbackDays:1}})
    .where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  expect(await service().scheduleAutomaticDiscovery()).toBe(1);
  const [job]=await discoveryJobs();
  expect(job.discoveryJson!.labelIds).toEqual(['QA']);
  expect(job.discoveryJson!.query).toContain('{is:read is:unread}');
  expect(job.discoveryJson!.query).toMatch(/after:\d+/);
  expect(job.discoveryJson!.query).toMatch(/before:\d+/);
});

test('discovered IDs survive detail failure and a later empty discovery window',async()=>{
  const s=service(provider({getMessage:async()=>{throw new Error('private provider error');},listRecentMessages:async(_m,_l,onPage)=>{await onPage!([{messageId:message.messageId,threadId:null}]);throw new Error('private provider error');}}));
  expect((await pull(s)).summary.failed).toBeGreaterThanOrEqual(1);expect(await jobs()).toHaveLength(1);expect(await inbound()).toHaveLength(0);
  await db.update(schema.inboundEmailMailboxes).set({lastPulledAt:new Date('2099-01-01'),settingsJson:{lookbackDays:1}}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  const list=jest.fn(async()=>[]);const resumed=service(provider({listRecentMessages:list}));
  await due();await resumed.recoverInterruptedImports(1);
  expect(list).not.toHaveBeenCalled();expect(await inbound()).toHaveLength(1);expect((await jobs())[0].status).toBe('complete');
  expect(await aiJobs()).toHaveLength(1);
});
test('saved discovery query survives interruption before a page commits and a moved lookback',async()=>{
  const options=inboundGmailDiscoveryOptions(mailbox,2,new Date('2026-01-15T12:00:00Z'));
  await imports.beginDiscovery(mailbox,user,options);const seen:string[]=[];let fail=true;
  const adapter=provider({listRecentMessages:async(_m,_limit,onPage,checkpoint)=>{
    seen.push(checkpoint!.query);if(fail)throw new Error('Simulated interruption before page persistence');
    await onPage!([{messageId:message.messageId,threadId:null}]);return[];
  }});
  await service(adapter).recoverInterruptedImports(1);expect(await jobs()).toHaveLength(0);
  await db.update(schema.inboundEmailMailboxes).set({settingsJson:{gmailQuery:'newer_than:1d'},lastPulledAt:new Date('2099-01-01')}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  fail=false;await due();await service(adapter).recoverInterruptedImports(2);
  expect(seen).toEqual([options.query,options.query]);expect(options.query).not.toContain('newer_than:');
  expect(await inbound()).toHaveLength(1);expect((await jobs())[0].status).toBe('complete');
});
test('provider IDs and next page checkpoint commit together; recovery starts at the saved cursor',async()=>{
  const options=inboundGmailDiscoveryOptions(mailbox,2,new Date());await imports.beginDiscovery(mailbox,user,options);
  let first=true;const tokens:Array<string|undefined>=[];const secondId=randomUUID();
  const s=service(provider({listRecentMessages:async(_m,_l,onPage,checkpoint)=>{
    tokens.push(checkpoint?.pageToken);
    if(first){first=false;await onPage!([{messageId:message.messageId,threadId:null}],'page-two');throw new Error('Interrupted after page commit');}
    await onPage!([{messageId:secondId,threadId:null}]);return[];
  },getMessage:async(_m,id)=>({...message,messageId:id})}));
  await s.recoverInterruptedImports(1);expect(await jobs()).toHaveLength(1);
  const [checkpoint]=await db.select().from(schema.inboundEmailImportJobs).where(and(eq(schema.inboundEmailImportJobs.organizationId,org),eq(schema.inboundEmailImportJobs.workKind,'discovery')));
  expect(checkpoint.discoveryJson).toMatchObject({processed:1,pageToken:'page-two'});
  await due();await s.recoverInterruptedImports(3);
  expect(tokens).toEqual([undefined,'page-two']);expect(await inbound()).toHaveLength(2);expect(await jobs()).toHaveLength(2);
});
test('an invalid saved page token retries the same bounded absolute window without losing existing IDs',async()=>{
  const options={...inboundGmailDiscoveryOptions(mailbox,2,new Date()),pageToken:'expired-token',processed:1};
  await imports.beginDiscovery(mailbox,user,options);let fail=true;const seen:Array<any>=[];
  const s=service(provider({listRecentMessages:async(_m,_l,onPage,checkpoint)=>{
    seen.push(checkpoint);if(fail)throw Object.assign(new Error('Invalid cursor'),{status:400});await onPage!([{messageId:message.messageId,threadId:null}]);return[];
  }}));
  await s.recoverInterruptedImports(1);fail=false;await due();await s.recoverInterruptedImports(2);
  expect(seen[1]).toMatchObject({query:options.query,processed:0});expect(seen[1].pageToken).toBeUndefined();expect(await inbound()).toHaveLength(1);
});
test('inbound identity and incomplete manifest persist before attachment download; approval fails closed',async()=>{
  message.attachments=[attachment('first')];const entered=deferred(),release=deferred();
  const s=service(provider({downloadAttachment:async()=>{entered.resolve();await release.promise;return{buffer:Buffer.from('test'),mimeType:'application/pdf',sizeBytes:4};}}));
  const running=pull(s);
  try{
    await entered.promise;const [record]=await inbound();expect(record.normalizedPayloadJson.importIncomplete).toBe(true);
    expect((await jobs())[0].inboundRecordId).toBe(record.id);expect(await aiJobs()).toHaveLength(0);
    await expect(records.assertImportComplete(org,record.id)).rejects.toThrow('incomplete');
    await expect(records.updateRecordWithEvent({organizationId:org,inboundRecordId:record.id,patch:{status:'ready'},event:{actorType:'user',eventType:'review.status_updated'}})).rejects.toThrow();
  }finally{release.resolve();await running;}
  expect((await jobs())[0].status).toBe('complete');expect((await inbound())[0].normalizedPayloadJson.importIncomplete).toBe(false);
});
test('partial attachment import resumes failed bytes without duplicating the stored attachment or AI work',async()=>{
  message.attachments=[attachment('one'),attachment('two')];let fail=true;const downloads:string[]=[];
  const s=service(provider({downloadAttachment:async(_m,_message,a)=>{downloads.push(a.attachmentId!);if(fail&&a.attachmentId==='two')throw new Error('private OAuth token');return{buffer:Buffer.from('test'),mimeType:'application/pdf',sizeBytes:4};}}));
  await pull(s);const [record]=await inbound();
  expect((await jobs())[0].status).toBe('retrying');expect(await records.listFiles(org,record.id)).toHaveLength(2);expect(await aiJobs()).toHaveLength(0);
  const [pullState]=await db.select().from(schema.inboundEmailMailboxes).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));expect(pullState.lastPullStatus).toBe('failed');
  fail=false;await due();await s.recoverInterruptedImports(1);
  expect((await jobs())[0].status).toBe('complete');const files=await records.listFiles(org,record.id);
  expect(files).toHaveLength(2);expect(files.every(file=>file.status==='available'&&file.fileRecordId)).toBe(true);
  expect(downloads.filter(id=>id==='one')).toHaveLength(1);expect(downloads.filter(id=>id==='two')).toHaveLength(2);
  expect(await aiJobs()).toHaveLength(1);await pull(s);await s.recoverInterruptedImports();expect(await inbound()).toHaveLength(1);expect(await aiJobs()).toHaveLength(1);
});
test('failed completion rolls back AI scheduling and import completion together',async()=>{
  const original=InboundOrdersRepository.prototype.completeEmailImport;
  const fail=jest.spyOn(InboundOrdersRepository.prototype,'completeEmailImport').mockImplementation(async function(this:InboundOrdersRepository,...args){
    await original.apply(this,args);throw new Error('Synthetic completion interruption');
  });
  const s=service();try{await pull(s);}finally{fail.mockRestore();}
  expect((await jobs())[0].status).toBe('retrying');expect((await inbound())[0].normalizedPayloadJson.importIncomplete).toBe(true);expect(await aiJobs()).toHaveLength(0);
  await due();await s.recoverInterruptedImports(1);expect((await jobs())[0].status).toBe('complete');expect(await aiJobs()).toHaveLength(1);
});
test('competing recovery workers and repeated discovery have a single mailbox owner',async()=>{
  await Promise.all([discover(),discover()]);const entered=deferred(),release=deferred();let calls=0;
  const adapter=provider({getMessage:async()=>{calls++;entered.resolve();await release.promise;return message;}});
  const a=service(adapter),b=service(adapter,second);const running=a.recoverInterruptedImports(1);
  try{await entered.promise;expect(await b.recoverInterruptedImports(1)).toEqual({processed:0});expect(await imports.claim({organizationId:org,mailboxId:mailbox.id})).toBeNull();}
  finally{release.resolve();await running;}
  expect(calls).toBe(1);expect(await inbound()).toHaveLength(1);expect(await jobs()).toHaveLength(1);
});
test('an abandoned importer cannot persist after a replacement imports the same attachment',async()=>{
  message.attachments=[attachment('one')];await discover();const old=(await imports.claim({organizationId:org,mailboxId:mailbox.id}))!;
  const entered=deferred(),release=deferred();const first=service(provider({downloadAttachment:async()=>{entered.resolve();await release.promise;return{buffer:Buffer.from('test'),mimeType:'application/pdf',sizeBytes:4};}}));
  const running=(first as any).resumeImport(old);
  try{await entered.promise;await expire(old);await service().recoverInterruptedImports(1);expect((await jobs())[0]).toMatchObject({status:'complete',attempts:2});}
  finally{release.resolve();await running;}
  const [record]=await inbound();expect(await records.listFiles(org,record.id)).toHaveLength(1);
  expect(await db.select().from(schema.fileRecords).where(eq(schema.fileRecords.organizationId,org))).toHaveLength(1);
  expect(await aiJobs()).toHaveLength(1);
});
test('exhausted downloads have a staff retry path and safe diagnostics',async()=>{
  message.attachments=[attachment('one')];let fail=true;
  const s=service(provider({downloadAttachment:async()=>{if(fail)throw new Error('secret provider body');return{buffer:Buffer.from('test'),mimeType:'application/pdf',sizeBytes:4};}}));
  await pull(s);for(let n=0;n<2;n++){await due();await s.recoverInterruptedImports(1);}
  expect((await jobs())[0]).toMatchObject({status:'failed',attempts:3});expect(await s.recoverInterruptedImports()).toEqual({processed:0});
  expect(JSON.stringify(await jobs())).not.toContain('secret provider body');
  const job=(await jobs())[0];await imports.retry(org,job.id,user);await expect(imports.retry(org,job.id,user)).rejects.toThrow();
  fail=false;await s.recoverInterruptedImports(1);expect((await jobs())[0]).toMatchObject({status:'complete',attempts:1});
});
test('abandoned claims become terminal after three deaths and can be retried by staff',async()=>{
  await discover();for(let n=1;n<=3;n++){const job=(await imports.claim({organizationId:org,mailboxId:mailbox.id}))!;expect(job.attempts).toBe(n);await expire(job);}
  expect(await imports.claim({organizationId:org,mailboxId:mailbox.id})).toBeNull();expect((await jobs())[0]).toMatchObject({status:'failed',errorCode:'IMPORT_ABANDONED_LIMIT'});
  await imports.retry(org,(await jobs())[0].id,user);await service().recoverInterruptedImports(1);expect((await jobs())[0].status).toBe('complete');
});
test('terminated worker leaves a durable incomplete import which a new process can recover',async()=>{
  message.attachments=[attachment('crash')];await discover();
  const env:NodeJS.ProcessEnv={...process.env,INBOUND_IMPORT_CRASH_CHILD:'true',INBOUND_IMPORT_SYNTHETIC_MESSAGE:JSON.stringify(message)};
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','DIRECT_DATABASE_URL'])delete env[key];
  const child=spawn(process.execPath,['node_modules/jest/bin/jest.js','--config','jest.inbound-postgres.config.js','--runInBand',
    '--testMatch','**/inboundImportCrash.postgres.child.ts','--runTestsByPath','server/tests/helpers/inboundImportCrash.postgres.child.ts'],
    {cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));let entered=false,text='';let timeout:ReturnType<typeof setTimeout>;
  try{
    await new Promise<void>((resolve,reject)=>{
      timeout=setTimeout(()=>reject(new Error('Import worker did not reach its controlled download boundary')),20000);
      child.stdout.on('data',chunk=>{text+=String(chunk);if(text.includes('INBOUND_IMPORT_DOWNLOAD_ENTERED')){entered=true;resolve();}});
      child.stderr.resume();child.once('error',reject);child.once('exit',()=>{if(!entered)reject(new Error('Import worker exited before download'));});
    }).finally(()=>clearTimeout(timeout!));
    const job=(await jobs())[0];expect(job.inboundRecordId).toBeTruthy();expect((await inbound())[0].normalizedPayloadJson.importIncomplete).toBe(true);
    child.kill('SIGKILL');await closed;expect((await jobs())[0].status).toBe('importing');
    await expire(job);await service().recoverInterruptedImports(1);
    expect((await jobs())[0]).toMatchObject({status:'complete',attempts:2});expect(await inbound()).toHaveLength(1);
    expect(await records.listFiles(org,job.inboundRecordId!)).toHaveLength(1);expect(await aiJobs()).toHaveLength(1);
  }finally{child.kill('SIGKILL');await closed;}
},40000);
test('permanent provider failures retain identity without automatic retry',async()=>{
  await discover();await service(provider({getMessage:async()=>{throw Object.assign(new Error('private URL'),{response:{status:404}});}})).recoverInterruptedImports(1);
  expect((await jobs())[0]).toMatchObject({status:'failed',errorCode:'IMPORT_PROVIDER_UNAVAILABLE',attempts:1});expect(await inbound()).toHaveLength(0);
});
test('untrusted or unavailable attachments retain approval guard but schedule one partial AI draft after import settles',async()=>{
  message.senderEmail='untrusted@unknown.invalid';message.attachments=[attachment('PO')];const download=jest.fn(async()=>{throw new Error('Must not download');});
  await pull(service(provider({downloadAttachment:download})));
  const [record]=await inbound();expect((await jobs())[0].status).toBe('needs_attention');expect(download).not.toHaveBeenCalled();
  expect(record.normalizedPayloadJson.importIncomplete).toBe(true);
  expect(record.normalizedPayloadJson.partialDraftEligible).toBe(true);
  expect(await aiJobs()).toHaveLength(1);
  await pull(service(provider({downloadAttachment:download})));
  expect(await aiJobs()).toHaveLength(1);
  await expect(records.assertImportComplete(org,record.id)).rejects.toThrow();
});

test('stored quarantined ZIP is retained and partial draft work is queued once without approval',async()=>{
  message.bodyText='Please make 20 two-sided yard signs by Monday evening. Artwork is attached.';
  message.attachments=[{filename:'Archive.zip',mimeType:'application/zip',size:4,attachmentId:'archive'}];
  await pull(service(provider({downloadAttachment:async()=>({buffer:Buffer.from('PK\\u0003\\u0004'),mimeType:'application/zip',sizeBytes:4})})));
  const [record]=await inbound();const [file]=await records.listFiles(org,record.id);
  expect(file).toMatchObject({sourceFilename:'Archive.zip',status:'quarantined'});
  expect(file.fileRecordId).toBeTruthy();
  expect(record.normalizedPayloadJson).toMatchObject({importIncomplete:true,partialDraftEligible:true});
  expect((await aiJobs()).map(job=>job.status)).toEqual(['waiting']);
  const parsed=inboundOrderParsedDraftSchema.parse({customer:{sourceEmail:'buyer@customer.invalid'},order:{},
    lineItems:[{sourceText:'20 two-sided yard signs',productName:'Yard Signs',quantity:20,optionTexts:['two-sided']}],
    artwork:[],globalWarnings:[],missingDecisions:[]});
  const parser=new InboundOrderParsingService(records,()=>({generateJson:async()=>({provider:'stub',model:'synthetic',rawText:JSON.stringify(parsed),parsed})} as any),
    {buildEvidenceBundle:async()=>({items:[],conflicts:[]})} as any);
  const parsedResult=await parser.parseInboundOrderRecord({organizationId:org,inboundRecordId:record.id,actorUserId:user});
  expect(parsedResult.draft?.lineItems[0].quantity).toBe(20);
  expect(parsedResult.draft?.missingDecisions).toEqual(expect.arrayContaining([expect.objectContaining({field:'attachments',severity:'blocking'})]));
  const review=await new InboundOrderService(records).getReviewDraft({organizationId:org,inboundRecordId:record.id,actorUserId:user});
  expect(review.status).toBe('draft');
  expect(review.reviewedArtworkJson.status).toBe('missing');
  expect((await records.listReviewSnapshots(org,record.id))[0].payloadJson).toMatchObject({metadata:{evidenceCoverage:{
    coveredFingerprint:(await records.getEvidenceState(org,record.id)).fingerprint,importIncomplete:true,
    unresolvedAttachments:[{fileId:file.id,filename:'Archive.zip'}],
  }}});
  await expect(records.assertImportComplete(org,record.id)).rejects.toThrow();
  await expect(records.updateRecordWithEvent({organizationId:org,inboundRecordId:record.id,patch:{status:'ready'},event:{actorType:'user',eventType:'review.status_updated'}})).rejects.toThrow();
  await pull(service(provider({downloadAttachment:async()=>{throw new Error('Unchanged archive must not redownload');}})));
  expect(await aiJobs()).toHaveLength(1);
  expect((await records.listFiles(org,record.id))[0].fileRecordId).toBe(file.fileRecordId);
  await records.updateFile({organizationId:org,inboundRecordId:record.id,fileId:file.id,patch:{metadataJson:{...file.metadataJson,
    attachmentClassification:{classification:'OTHER',source:'manual_override',confidence:100,reasons:['Synthetic staff classification']}}}});
  await expect(records.assertImportComplete(org,record.id)).rejects.toThrow();
});
test('known unavailable legacy attachments cannot bypass evidence checks without an import job',async()=>{
  const [record]=await db.insert(schema.inboundOrderRecords).values({organizationId:org,sourceType:'email',status:'needs_review'}).returning();
  await records.createFile({organizationId:org,inboundRecordId:record.id,sourceFilename:'PO.pdf',status:'quarantined',metadataJson:{attachmentState:'download_failed'}});
  await expect(records.assertImportComplete(org,record.id)).rejects.toThrow('attachments are unavailable');
  await expect(records.updateRecordWithEvent({organizationId:org,inboundRecordId:record.id,patch:{status:'ready'},event:{actorType:'user',eventType:'review.status_updated'}})).rejects.toThrow();
  expect(await jobs()).toHaveLength(0);
});
test('deliberate staff attachment exclusions survive retries and reconcile completeness explicitly',async()=>{
  message.senderEmail='untrusted@unknown.invalid';message.attachments=[attachment('PO')];const download=jest.fn(async()=>{throw new Error('Must retain staff exclusion');});
  const s=service(provider({downloadAttachment:download}));await pull(s);const [record]=await inbound();const [file]=await records.listFiles(org,record.id);
  await records.updateFile({organizationId:org,inboundRecordId:record.id,fileId:file.id,patch:{role:'other',metadataJson:{...file.metadataJson,
    manualAttachmentClassification:true,attachmentClassification:{classification:'OTHER',source:'manual_override',confidence:100,reasons:['Deliberately excluded by staff']}}}});
  await imports.retry(org,(await jobs())[0].id,user);await s.recoverInterruptedImports(1);
  expect((await jobs())[0].status).toBe('complete');expect(download).not.toHaveBeenCalled();
  expect((await records.listFiles(org,record.id))[0].metadataJson.attachmentClassification).toMatchObject({classification:'OTHER',source:'manual_override'});
  expect((await records.getRecord(org,record.id))?.normalizedPayloadJson.importIncomplete).toBe(false);
});
test('blacklist rules still exclude recovered messages without business dismissal or downloads',async()=>{
  message.attachments=[attachment('one')];await discover();
  await records.createEmailIgnoreRule({organizationId:org,ruleType:'sender_email_exact',ruleValue:'buyer@customer.invalid',createdByUserId:user,enabled:true});
  const download=jest.fn(async()=>{throw new Error('Must not download');});await service(provider({downloadAttachment:download})).recoverInterruptedImports(1);
  expect((await jobs())[0].status).toBe('skipped');expect(await inbound()).toHaveLength(0);expect(download).not.toHaveBeenCalled();
});
test('tenant, provider account and mailbox eligibility boundaries are retained',async()=>{
  await discover();const job=(await jobs())[0];await expect(imports.retry('foreign',job.id,user)).rejects.toThrow();
  await expect(imports.beginDiscovery({...mailbox,organizationId:'foreign'},user,inboundGmailDiscoveryOptions(mailbox,1,new Date()))).rejects.toThrow();
  expect(await imports.list('foreign')).toEqual([]);await expect(imports.discover({...mailbox,organizationId:'foreign'},user,[{messageId:message.messageId,threadId:null}])).rejects.toThrow();
  await db.update(schema.inboundEmailMailboxes).set({enabled:false}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  expect(await service().recoverInterruptedImports(1)).toEqual({processed:0});
  await db.update(schema.inboundEmailMailboxes).set({enabled:true,emailAddress:'replacement@shop.invalid'}).where(eq(schema.inboundEmailMailboxes.id,mailbox.id));
  const get=jest.fn(async()=>message);await service(provider({getMessage:get})).recoverInterruptedImports(1);expect(get).not.toHaveBeenCalled();expect((await jobs())[0].status).toBe('failed');
});
test('rollout disabled retains work and never contacts the provider',async()=>{
  await discover();delete process.env.WORKER_INBOUND_EMAIL_IMPORTS_ENABLED;const get=jest.fn(async()=>message);
  expect(await service(provider({getMessage:get})).recoverInterruptedImports(1)).toEqual({processed:0});expect(get).not.toHaveBeenCalled();expect((await jobs())[0].status).toBe('waiting');
});
test('thread recovery preserves staff edits and prior dismissal history while new evidence reopens review',async()=>{
  message.threadId='synthetic-thread';const s=service(provider({getThreadMessages:async()=>[message]}));await pull(s);
  const [record]=await inbound();const state=await records.getEvidenceState(org,record.id);
  const attempt=await records.createParseAttempt({organizationId:org,inboundOrderRecordId:record.id,status:'success',rawResponse:{inboundEvidenceFingerprint:state.fingerprint}});
  const saved=await records.createReviewSnapshotWithEvent({snapshot:{organizationId:org,inboundRecordId:record.id,snapshotType:'approval',payloadJson:{reviewNotes:'Staff edit retained',metadata:{snapshotKind:'editable_review_draft'}}},
    evidenceSourceParseAttemptId:attempt.id,event:{actorType:'user',eventType:'review.saved'}});
  await records.updateRecordWithEvent({organizationId:org,inboundRecordId:record.id,expectedEvidenceFingerprint:state.fingerprint,patch:{status:'ignored',reviewOutcome:'ignored'},event:{actorType:'user',actorUserId:user,eventType:'review.ignored'}});
  const secondMessage={...message,messageId:randomUUID(),receivedAt:new Date(Date.now()+1000),bodyText:'A revised request'};
  await imports.discover(mailbox,user,[{messageId:secondMessage.messageId,threadId:message.threadId}]);
  const recovery=service(provider({getMessage:async()=>secondMessage,getThreadMessages:async()=>[message,secondMessage]}));await recovery.recoverInterruptedImports(1);
  expect(await inbound()).toHaveLength(1);expect(await records.getRecord(org,record.id)).toMatchObject({status:'needs_review'});
  expect((await records.listReviewSnapshots(org,record.id))[0].payloadJson).toEqual(saved.snapshot.payloadJson);
  expect((await records.listEvents(org,record.id)).some(event=>event.eventType==='review.ignored')).toBe(true);
});

test('unchanged discovery after bulk removal keeps the email dismissed and its source intact', async () => {
  const ingestion = service();
  await pull(ingestion);
  const [record] = await inbound();
  const fingerprint = (await records.getEvidenceState(org, record.id)).fingerprint;
  const outcome = await new InboundOrderService(records).applyBulkQueueAction({
    organizationId: org, actorUserId: user, recordIds: [record.id], action: 'delete',
    expectedEvidenceFingerprints: { [record.id]: fingerprint },
  });
  expect(outcome).toMatchObject({ updatedIds: [record.id], emailsProcessed: 1, emailsSkipped: 0 });
  await discover();
  await ingestion.recoverInterruptedImports(1);
  expect(await inbound()).toHaveLength(1);
  expect(await records.getRecord(org, record.id)).toMatchObject({ status: 'terminal', reviewOutcome: 'deleted', sourceMessageId: message.messageId });
  expect((await records.listEvents(org, record.id)).filter(event => event.eventType === 'review.queue_deleted')).toHaveLength(1);
});
test('new evidence on an Order-linked thread reopens review without modifying or duplicating the Order',async()=>{
  message.threadId='order-linked-thread';await pull(service(provider({getThreadMessages:async()=>[message]})));
  const [record]=await inbound();const [order]=await db.insert(schema.orders).values({organizationId:org,orderNumber:'TEST-ORDER',createdByUserId:user}).returning();
  const state=await records.getEvidenceState(org,record.id);
  await records.updateRecordWithEvent({organizationId:org,inboundRecordId:record.id,expectedEvidenceFingerprint:state.fingerprint,
    patch:{status:'ignored',reviewOutcome:'attached_to_order',normalizedPayloadJson:{attachedOrderId:order.id}},event:{actorType:'user',actorUserId:user,eventType:'order.attached'}});
  const next={...message,messageId:randomUUID(),receivedAt:new Date(Date.now()+1000),bodyText:'Replacement evidence on existing Order'};
  await imports.discover(mailbox,user,[{messageId:next.messageId,threadId:next.threadId}]);
  await service(provider({getMessage:async()=>next,getThreadMessages:async()=>[message,next]})).recoverInterruptedImports(1);
  expect(await inbound()).toHaveLength(1);expect(await records.getRecord(org,record.id)).toMatchObject({status:'needs_review',normalizedPayloadJson:{attachedOrderId:order.id}});
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toEqual([order]);
  expect((await records.listEvents(org,record.id)).some(event=>event.eventType==='order.attached')).toBe(true);
  expect(await records.listReviewSnapshots(org,record.id)).toHaveLength(0);
});
test('quote linkage survives recovery and remains pending without automatic Order creation',async()=>{
  message.threadId='quote-linked-thread';await pull(service(provider({getThreadMessages:async()=>[message]})));
  const [record]=await inbound();const [quote]=await db.insert(schema.quotes).values({organizationId:org,userId:user,status:'draft'}).returning();
  await db.update(schema.inboundOrderRecords).set({createdQuoteId:quote.id,status:'waiting_on_customer'}).where(eq(schema.inboundOrderRecords.id,record.id));
  const next={...message,messageId:randomUUID(),receivedAt:new Date(Date.now()+1000),bodyText:'New details for pending Quote'};
  await imports.discover(mailbox,user,[{messageId:next.messageId,threadId:next.threadId}]);
  await service(provider({getMessage:async()=>next,getThreadMessages:async()=>[message,next]})).recoverInterruptedImports(1);
  expect(await records.getRecord(org,record.id)).toMatchObject({createdQuoteId:quote.id,status:'needs_review'});
  expect(await db.select().from(schema.quotes).where(eq(schema.quotes.organizationId,org))).toEqual([quote]);
  expect(await db.select().from(schema.orders).where(eq(schema.orders.organizationId,org))).toHaveLength(0);
});
