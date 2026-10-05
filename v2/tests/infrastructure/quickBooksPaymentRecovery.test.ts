import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import { randomUUID, createCipheriv, createHash } from "node:crypto";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import ts from "typescript";
import { matchQuickBooksPayment, type QuickBooksPaymentRecoveryContext } from "../../infrastructure/accounting/quickBooksPaymentRecovery.js";
import * as recovery from "../../infrastructure/accounting/quickBooksPaymentRecovery.js";
import { exportOrRecoverQuickBooksPayment } from "../../infrastructure/accounting/quickBooksPaymentExport.js";
import * as exporter from "../../infrastructure/accounting/quickBooksPaymentExport.js";
import { PostgresQuickBooksPaymentReadTransport, type QuickBooksPaymentReadPort } from "../../infrastructure/accounting/quickBooksPaymentReadTransport.js";
import * as transport from "../../infrastructure/accounting/quickBooksPaymentReadTransport.js";
import * as policy from "../../infrastructure/accounting/quickBooksQueuePolicy.js";
import * as projection from "../../infrastructure/accounting/quickBooksLiveInvoiceProjection.js";
import * as reference from "../../infrastructure/accounting/quickBooksPaymentReference.js";
import * as publications from "../../infrastructure/accounting/quickBooksProviderPublication.js";
import express from "express";
import request from "supertest";
import { createQuickBooksIntegrationRouter } from "../../src/interfaces/http/quickBooksIntegrationRoutes.js";
import { PGlite } from "@electric-sql/pglite";

const context: QuickBooksPaymentRecoveryContext = {schemaVersion:1,organizationId:"org-a",jobId:"job-a",paymentId:"pay-a",realmId:"1234",environment:"sandbox",reference:"PMT-1000",customerId:"100",amountCents:300,currency:"USD",allocations:[{invoiceId:"10",amountCents:100},{invoiceId:"20",amountCents:200}]};
const payment = () => ({Id:"300",PaymentRefNum:"PMT-1000",PrivateNote:"PrintersHero V2 payment pay-a",CustomerRef:{value:"100"},CurrencyRef:{value:"USD"},TotalAmt:3,UnappliedAmt:0,Line:[{Amount:1,LinkedTxn:[{TxnType:"Invoice",TxnId:"10"}]},{Amount:2,LinkedTxn:[{TxnType:"Invoice",TxnId:"20"}]}]});
const read = (payments: unknown[], overrides = {}) => ({organizationId:"org-a",realmId:"1234",environment:"sandbox" as const,complete:true,payments,...overrides});
const reader = (getPayments: () => unknown[]): QuickBooksPaymentReadPort => ({connection:async()=>({organizationId:"org-a",realmId:"1234",environment:"sandbox"}),payments:async(_connection,_reference,id)=>read(getPayments().filter(p=>!id||(p as {Id:string}).Id===id))});
const referenceRows = () => [
  {entity_kind:"customer",entity_id:"local-customer",provider_id:"100"},
  {entity_kind:"invoice",entity_id:"local-1",provider_id:"10"},
  {entity_kind:"invoice",entity_id:"local-2",provider_id:"20"},
].map(row=>({...row,provider_identity:{organizationId:"org-a",entityKind:row.entity_kind,entityId:row.entity_id,providerId:row.provider_id,realmId:"1234",environment:"sandbox"}}));

describe("actual Invoice transition builder and exact canonical representation",()=>{
  const connection={organizationId:"org-a",realmId:"1234",environment:"sandbox" as const};
  const project=(cents:number,quantity=1)=>({displayNumber:"INV-1",currency:"USD",postedAt:"2026-01-01T00:00:00.000Z",customerId:"customer-a",lines:[{description:"Canonical item",quantity,unitAmountCents:cents,lineAmountCents:cents}]});
  test("repeated financial A in a new approved version has a distinct request identity",()=>{
    const first=publications.invoicePublicationIntent(connection,"invoice-a","100",project(100),"1"),third=publications.invoicePublicationIntent(connection,"invoice-a","100",project(100),"3");
    expect(third.requestId).not.toBe(first.requestId);expect(publications.invoicePublicationIntent(connection,"invoice-a","100",project(100),"3")).toEqual(third);
  });
  test.each([9007199254740991,9007199254740901])("builder rejects safe integer cents %s if the decimal wire value loses precision",amount=>{
    expect(()=>publications.invoicePublicationIntent(connection,"invoice-a","100",project(amount),"1")).toThrow("round-trip exactly");
  });
  test("exact decimal cents and quantities are retained, and the matcher rejects changed provider financials",()=>{
    const intent=publications.invoicePublicationIntent(connection,"invoice-a","100",project(29,3),"1");const value={...intent.payload,Id:"10",TotalAmt:0.29,TxnTaxDetail:{TotalTax:0}};
    expect((intent.payload.Line as any[])[0].SalesItemLineDetail).toEqual({Qty:3,UnitPrice:0.29});expect(publications.publicationMatches(intent,value)).toBe(true);
    expect(publications.publicationMatches(intent,{...value,TotalAmt:0.30})).toBe(false);
    const changed=JSON.parse(JSON.stringify(value));changed.Line[0].SalesItemLineDetail.Qty=4;expect(publications.publicationMatches(intent,changed)).toBe(false);
    expect(()=>publications.invoicePublicationIntent(connection,"invoice-a","100",project(29,1.5),"1")).toThrow("round-trip exactly");
  });
});

describe("PAY-22 unique financial identity, not reference/display/date matching", () => {
  test("adopts a unique complete identity and checks the external ID", () => {
    expect(matchQuickBooksPayment(context,read([payment()]),"300")).toEqual({state:"matched",providerId:"300"});
    expect(matchQuickBooksPayment(context,read([payment()]),"999")).toEqual({state:"mismatch"});
    expect(matchQuickBooksPayment(context,read([{...payment(),Line:[...payment().Line].reverse()}]))).toEqual({state:"matched",providerId:"300"});
  });
  test.each([
    ["customer",{CustomerRef:{value:"foreign"}}], ["amount",{TotalAmt:4}], ["currency",{CurrencyRef:{value:"CAD"}}],
    ["V1 namespace collision",{PrivateNote:"V1 payment with same PMT reference"}], ["another V2 request",{PrivateNote:"PrintersHero V2 payment other"}],
    ["reference",{PaymentRefNum:"PMT-1001"}], ["unallocated remainder",{UnappliedAmt:1}],
    ["Invoice identity",{Line:[{Amount:1,LinkedTxn:[{TxnType:"Invoice",TxnId:"10"}]},{Amount:2,LinkedTxn:[{TxnType:"Invoice",TxnId:"99"}]}]}],
    ["Invoice allocation amounts",{Line:[{Amount:2,LinkedTxn:[{TxnType:"Invoice",TxnId:"10"}]},{Amount:1,LinkedTxn:[{TxnType:"Invoice",TxnId:"20"}]}]}],
  ])("fails closed for %s", (_name, overrides) => { expect(matchQuickBooksPayment(context,read([{...payment(),...overrides}])).state).toBe("mismatch"); });
  test.each([ ["realm",{realmId:"other"}], ["tenant",{organizationId:"org-b"}], ["environment",{environment:"production"}], ["truncated page",{complete:false}] ])("fails closed for %s provenance", (_name, overrides) => { expect(matchQuickBooksPayment(context,read([payment()],overrides))).toEqual({state:"unknown"}); });
  test("missing, partial, ambiguous, duplicate and sub-cent evidence cannot establish success", () => {
    expect(matchQuickBooksPayment(context,read([]))).toEqual({state:"missing"});
    expect(matchQuickBooksPayment(context,read([{Id:"300"}]))).toEqual({state:"unknown"});
    expect(matchQuickBooksPayment(context,read([payment(),{...payment(),Id:"301"}]))).toEqual({state:"ambiguous"});
    expect(matchQuickBooksPayment(context,read([{...payment(),Line:[payment().Line[0],payment().Line[0]]}]))).toEqual({state:"ambiguous"});
    expect(matchQuickBooksPayment(context,read([{...payment(),Line:[{Amount:1.001,LinkedTxn:[{TxnType:"Invoice",TxnId:"10"}]}]}]))).toEqual({state:"unknown"});
    expect(matchQuickBooksPayment({...context,jobId:""},read([payment()]))).toEqual({state:"unknown"});
  });
  test("timeout accepted by provider recovers the same complete request, once", async () => {
    let created=0,visible:unknown[]=[];
    const port=reader(()=>visible);port.assertCreationReferences=async()=>{};port.createPayment=async()=>{created++;visible=[payment()];throw new Error("lost provider response");};
    let marked=0;
    const id=await exportOrRecoverQuickBooksPayment(port,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}});
    expect(id).toBe("300"); expect(created).toBe(1);
    expect(marked).toBe(1);
    expect(await exportOrRecoverQuickBooksPayment(port,context,{allowCreate:false,occurredAt:"2026-01-01",beforeCreate:async()=>{throw new Error("must not replay");}})).toBe("300");
  });
  test("reference collision and absent uncertain result never trigger another write", async () => {
    let created=0;
    for(const visible of [[],[{...payment(),CustomerRef:{value:"foreign"}}],[payment(),payment()]]) await expect(exportOrRecoverQuickBooksPayment(reader(()=>visible),context,{allowCreate:false,occurredAt:"2026-01-01",beforeCreate:async()=>{created++;}})).rejects.toThrow("RECONCILIATION_REQUIRED");
    expect(created).toBe(0);
  });
  test("an incorrect create response ID cannot be adopted even if an exact request exists", async () => {
    let visible:unknown[]=[];
    const port=reader(()=>visible);port.assertCreationReferences=async()=>{};port.createPayment=async()=>{visible=[payment()];return {qbPaymentId:"999"};};
    await expect(exportOrRecoverQuickBooksPayment(port,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{}})).rejects.toThrow("post-attempt lookup is mismatch");
  });
});

describe("V2-owned read-only Intuit connection/transport extraction", () => {
  const connection = (overrides={}) => ({id:"conn-a",company_id:"1234",access_token:"inert-access-token",token_expires_at:new Date(Date.now()+3600_000),metadata:{qbConnection:{state:"connected",authoritative:true}},...overrides});
  const fixture = (rows: unknown[], body: unknown={QueryResponse:{Payment:[payment()],startPosition:1,maxResults:1,totalCount:1}}) => {
    const queries: {sql:string;values:unknown[]}[]=[],requests:{url:string;init:RequestInit}[]=[];
    const pool = {query:async(sql:string,values:unknown[])=>{queries.push({sql,values});return {rows};}};
    const fetcher = async(url: string,init:RequestInit)=>{requests.push({url,init});return {ok:true,json:async()=>body};};
    return {service:new PostgresQuickBooksPaymentReadTransport(pool as never,fetcher as never,{}),queries,requests};
  };
  test("reads tenant-bound full candidates using GET only, with no credential/database/provider write", async()=>{
    const f=fixture([connection()]);const c=await f.service.connection("org-a");
    expect(matchQuickBooksPayment(context,await f.service.payments(c,"PMT-1000"))).toEqual({state:"matched",providerId:"300"});
    expect(f.queries.every(q=>q.sql.startsWith("SELECT")&&q.values[0]==="org-a")).toBe(true);
    expect(f.requests).toHaveLength(1); expect(f.requests[0]!.init.method).toBe("GET"); expect(f.requests[0]!.init.body).toBeUndefined();
    expect(decodeURIComponent(f.requests[0]!.url)).toContain("/v3/company/1234/query?query=SELECT * FROM Payment WHERE PaymentRefNum = 'PMT-1000' STARTPOSITION 1 MAXRESULTS 1000");
  });
  test.each([
    ["disconnected",[connection({metadata:{qbConnection:{state:"disconnected"}}})]], ["missing",[]],
    ["expired",[connection({token_expires_at:new Date(0)})]], ["unknown expiry",[connection({token_expires_at:null})]],
    ["reauth",[connection({metadata:{qbAuth:{state:"needs_reauth"}}})]], ["ambiguous",[connection(),connection({id:"conn-b"})]],
  ])("%s connection fails closed without OAuth or fetch",async(_name,rows)=>{const f=fixture(rows as unknown[]);await expect(f.service.connection("org-a")).rejects.toThrow("RECONCILIATION_REQUIRED");expect(f.requests).toHaveLength(0);});
  test("encrypted existing credential envelope is read without rewriting/refreshing it",async()=>{
    const secret="inert-fixture-encryption-key",iv=Buffer.alloc(12,1),cipher=createCipheriv("aes-256-gcm",createHash("sha256").update(secret).digest(),iv);
    const ciphertext=Buffer.concat([cipher.update("inert-decrypted-token"),cipher.final()]);
    const envelope=["qbtoken:v1","v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(":");
    let headers: HeadersInit | undefined;
    const service=new PostgresQuickBooksPaymentReadTransport({query:async()=>({rows:[connection({access_token:envelope})]})} as never,(async(_url:string,init:RequestInit)=>{headers=init.headers;return {ok:true,json:async()=>({Payment:payment()})};}) as never,{QB_TOKEN_ENCRYPTION_KEY:secret});
    const c=await service.connection("org-a");expect(matchQuickBooksPayment(context,await service.payments(c,"PMT-1000","300"),"300").state).toBe("matched");
    expect((headers as Record<string,string>).Authorization).toBe("Bearer inert-decrypted-token");
  });
  test("changed realm, malicious identity and truncated/malformed reads cannot establish absence",async()=>{
    const f=fixture([connection()]);await expect(f.service.payments({...await f.service.connection("org-a"),realmId:"999"},"PMT-1000")).rejects.toThrow("realm changed");
    await expect(f.service.payments(await f.service.connection("org-a"),"PMT-1000' OR 1=1")).rejects.toThrow("identity is invalid");expect(f.requests).toHaveLength(0);
    const truncated=fixture([connection()],{QueryResponse:{Payment:Array.from({length:1000},payment),startPosition:1,maxResults:1000}});const c=await truncated.service.connection("org-a");expect((await truncated.service.payments(c,"PMT-1000")).complete).toBe(false);
    const malformed=fixture([connection()],{});await expect(malformed.service.payments(await malformed.service.connection("org-a"),"PMT-1000")).rejects.toThrow("read outcome is unavailable");
  });
  test("a short second page cannot prove complete provider evidence",async()=>{
    const f=fixture([connection()],{QueryResponse:{Payment:[payment()],startPosition:2,maxResults:1,totalCount:2}});
    const snapshot=await f.service.payments(await f.service.connection("org-a"),"PMT-1000");
    expect(snapshot.complete).toBe(false);
  });
  test("explicit null Payment is unknown, not an absence authorizing creation",async()=>{
    const f=fixture([connection()],{QueryResponse:{Payment:null,startPosition:1,maxResults:0,totalCount:0}});let markers=0;
    await expect(exportOrRecoverQuickBooksPayment(f.service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{markers++;}})).rejects.toThrow("RECONCILIATION_REQUIRED");
    expect(markers).toBe(0);expect(f.requests.filter(r=>r.init.method==="POST")).toHaveLength(0);
  });
  test.each([
    {Payment:[payment()],startPosition:1,maxResults:2,totalCount:1},
    {Payment:[payment()],startPosition:1,maxResults:1,totalCount:null},
    {Payment:[payment()],startPosition:1,maxResults:1,totalCount:0},
    {Payment:[payment()],startPosition:null,maxResults:1},
    {Payment:[],startPosition:2,maxResults:0,totalCount:0},
    {Payment:[],startPosition:1,maxResults:0},
  ])("malformed or non-absence pagination never marks or creates (%j)",async page=>{
    const f=fixture([connection()],{QueryResponse:page});let marked=0;
    await expect(exportOrRecoverQuickBooksPayment(f.service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}})).rejects.toThrow("RECONCILIATION_REQUIRED");
    expect(marked).toBe(0);expect(f.requests.filter(r=>r.init.method==="POST")).toHaveLength(0);
  });
  test("an omitted zero-result collection requires an explicit same-realm filtered COUNT before POST",async()=>{
    const requests:{url:string;init:RequestInit}[]=[];let visible=false,marked=0;
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>({rows:sql.includes("oauth_connections")?[connection()]:referenceRows()})} as never,(async(url:string,init:RequestInit)=>{
      requests.push({url,init});let body:unknown;
      if(init.method==="POST"){expect(marked).toBe(1);visible=true;body={Payment:payment()};}
      else if(url.includes("/payment/300"))body={Payment:payment()};
      else if(decodeURIComponent(url).includes("SELECT COUNT(*)"))body={QueryResponse:{totalCount:visible?1:0}};
      else body=visible?{QueryResponse:{Payment:[payment()],startPosition:1,maxResults:1}}:{QueryResponse:{}};
      return {ok:true,json:async()=>body};
    }) as never,{});
    expect(await exportOrRecoverQuickBooksPayment(service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}})).toBe("300");
    const post=requests.find(r=>r.init.method==="POST")!;expect(post.url).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/1234/payment?requestid=job-a");
    expect(JSON.parse(post.init.body as string)).toEqual({CustomerRef:{value:"100"},TotalAmt:3,CurrencyRef:{value:"USD"},TxnDate:"2026-01-01",PaymentRefNum:"PMT-1000",PrivateNote:"PrintersHero V2 payment pay-a",Line:payment().Line});
    expect(requests.filter(r=>r.init.method==="POST")).toHaveLength(1);
  });
  test.each([{}, {totalCount:null}, {totalCount:1}, {totalCount:0,startPosition:2}, {totalCount:0,Payment:null}])("omitted collection with an unproven absence count stays held (%j)",async aggregate=>{
    let marked=0,posts=0;
    const service=new PostgresQuickBooksPaymentReadTransport({query:async()=>({rows:[connection()]})} as never,(async(url:string,init:RequestInit)=>{if(init.method==="POST")posts++;return {ok:true,json:async()=>({QueryResponse:decodeURIComponent(url).includes("COUNT(*)")?aggregate:{}})};}) as never,{});
    await expect(exportOrRecoverQuickBooksPayment(service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}})).rejects.toThrow("RECONCILIATION_REQUIRED");expect(marked).toBe(0);expect(posts).toBe(0);
  });
  test("reconnection after preflight cannot invoke a Payment POST in either realm",async()=>{
    let current=connection(),posts=0,marked=0;
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>({rows:sql.includes("oauth_connections")?[current]:referenceRows()})} as never,(async(_url:string,init:RequestInit)=>{if(init.method==="POST")posts++;current=connection({company_id:"5678",access_token:"new-realm-token"});return {ok:true,json:async()=>({QueryResponse:{Payment:[],startPosition:1,maxResults:0,totalCount:0}})};}) as never,{});
    await expect(exportOrRecoverQuickBooksPayment(service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}})).rejects.toThrow("realm changed");expect(marked).toBe(1);expect(posts).toBe(0);
  });
  test("the actual POST URL and credential remain pinned even if connection state changes after validation",async()=>{
    let reads=0,current=connection();const requests:{url:string;init:RequestInit}[]=[];
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>{if(!sql.includes("oauth_connections"))return {rows:referenceRows()};reads++;const selected=current;current=connection({company_id:"5678",access_token:"new-realm-token"});return {rows:[selected]};}} as never,(async(url:string,init:RequestInit)=>{requests.push({url,init});return {ok:true,json:async()=>({Payment:payment()})};}) as never,{});
    expect(await service.createPayment({organizationId:"org-a",realmId:"1234",environment:"sandbox"},context,"2026-01-01")).toEqual({qbPaymentId:"300"});expect(reads).toBe(1);
    expect(requests[0]!.url).toContain("/company/1234/payment?requestid=job-a");expect((requests[0]!.init.headers as Record<string,string>).Authorization).toBe("Bearer inert-access-token");
  });
  test("a first page without totalCount is not complete until filtered COUNT matches its size",async()=>{
    const requests:string[]=[];let count=2;
    const service=new PostgresQuickBooksPaymentReadTransport({query:async()=>({rows:[connection()]})} as never,(async(url:string)=>{requests.push(url);return {ok:true,json:async()=>({QueryResponse:decodeURIComponent(url).includes("COUNT(*)")?{totalCount:count}:{Payment:[payment()],startPosition:1,maxResults:1}})};}) as never,{});
    const c=await service.connection("org-a");expect((await service.payments(c,"PMT-1000")).complete).toBe(false);count=1;expect((await service.payments(c,"PMT-1000")).complete).toBe(true);expect(requests.filter(url=>decodeURIComponent(url).includes("COUNT(*)"))).toHaveLength(2);
  });
  test("wrong query entity cannot be fabricated into zero Payment results",async()=>{
    const f=fixture([connection()],{QueryResponse:{Invoice:[{Id:"10"}],startPosition:1,maxResults:0,totalCount:0}});let marked=0;
    await expect(exportOrRecoverQuickBooksPayment(f.service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{marked++;}})).rejects.toThrow("entity provenance");expect(marked).toBe(0);expect(f.requests.filter(r=>r.init.method==="POST")).toHaveLength(0);
  });
  test("coincidental old-realm Customer and Invoice IDs cannot authorize a fresh current-realm Payment",async()=>{
    let posts=0;
    const currentCustomer={Id:"100",DisplayName:"Unrelated current-realm customer"};
    const currentInvoice={Id:"10",CustomerRef:{value:"100"},DocNumber:"Unrelated current-realm Invoice"};
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>({rows:sql.includes("oauth_connections")?[connection()]:[
      {entity_kind:"customer",entity_id:"local-customer",provider_id:"100",provider_identity:{organizationId:"org-a",entityKind:"customer",entityId:"local-customer",providerId:"100",realmId:"5678",environment:"sandbox"}},
      ...["10","20"].map((id,index)=>({entity_kind:"invoice",entity_id:`local-${index+1}`,provider_id:id,provider_identity:{organizationId:"org-a",entityKind:"invoice",entityId:`local-${index+1}`,providerId:id,realmId:"5678",environment:"sandbox"}})),
    ]})} as never,(async(url:string,init:RequestInit)=>{if(init.method==="POST")posts++;return {ok:true,json:async()=>url.includes("/customer/")?{Customer:currentCustomer}:url.includes("/invoice/")?{Invoice:currentInvoice}:{Payment:payment()}};}) as never,{});
    await expect(service.createPayment({organizationId:"org-a",realmId:"1234",environment:"sandbox"},context,"2026-01-01")).rejects.toThrow("RECONCILIATION_REQUIRED");
    expect(posts).toBe(0);
  });
  test.each(["missing","canonical","realm","environment","provider"] as const)("unproven %s binding stops before an attempt marker or POST",async fault=>{
    let markers=0,posts=0;const rows=referenceRows();
    if(fault==="missing")rows[0]!.provider_identity=null as never;
    else if(fault==="canonical")rows[0]!.provider_identity.entityId="unrelated-customer";
    else if(fault==="realm")rows[1]!.provider_identity.realmId="5678";
    else if(fault==="environment")rows[2]!.provider_identity.environment="production";
    else rows[1]!.provider_identity.providerId="999";
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>({rows:sql.includes("oauth_connections")?[connection()]:rows})} as never,(async(_url:string,init:RequestInit)=>{if(init.method==="POST")posts++;return {ok:true,json:async()=>({QueryResponse:{Payment:[],startPosition:1,maxResults:0,totalCount:0}})};}) as never,{});
    await expect(exportOrRecoverQuickBooksPayment(service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{markers++;}})).rejects.toThrow("RECONCILIATION_REQUIRED");expect(markers).toBe(0);expect(posts).toBe(0);
  });
  test("a binding changed after preparation is rechecked before the actual POST",async()=>{
    let posts=0;const rows=referenceRows();
    const service=new PostgresQuickBooksPaymentReadTransport({query:async(sql:string)=>({rows:sql.includes("oauth_connections")?[connection()]:rows})} as never,(async(_url:string,init:RequestInit)=>{if(init.method==="POST")posts++;return {ok:true,json:async()=>({QueryResponse:{Payment:[],startPosition:1,maxResults:0,totalCount:0}})};}) as never,{});
    await expect(exportOrRecoverQuickBooksPayment(service,context,{allowCreate:true,occurredAt:"2026-01-01",beforeCreate:async()=>{rows[1]!.provider_identity.realmId="5678";}})).rejects.toThrow("RECONCILIATION_REQUIRED");expect(posts).toBe(0);
  });
});

const queueFixture = async (input: { fresh?: boolean; attempted?: boolean; historical?: boolean; visible?: unknown[]; failCompletion?: boolean; missingPrerequisite?: boolean; lostResponse?: boolean; unknownResult?: boolean;connectionFailure?:boolean; publisher?:boolean;lostPublication?:"customer"|"invoice";unknownPublication?:"customer"|"invoice";publicationCollision?:boolean;afterPublicationPost?:(db:PGlite,kind:string)=>Promise<void>; beforeProviderRead?: (db: PGlite) => Promise<void> } = {}) => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); INSERT INTO organizations VALUES('org-a');
    CREATE TABLE v2_billing_payments(id varchar,organization_id varchar,amount_cents bigint,currency varchar,occurred_at timestamptz,PRIMARY KEY(id,organization_id));
    CREATE TABLE v2_billing_invoices(id varchar,organization_id varchar,customer_id varchar,synchronization_version varchar,invoice_state varchar);
    CREATE TABLE v2_billing_payment_allocations(organization_id varchar,payment_id varchar,invoice_id varchar,amount_cents bigint);
    INSERT INTO v2_billing_payments VALUES('pay-a','org-a',300,'USD','2026-01-01');
    INSERT INTO v2_billing_invoices VALUES('local-1','org-a','local-customer','1','issued'),('local-2','org-a','local-customer','1','issued');
    INSERT INTO v2_billing_payment_allocations VALUES('org-a','pay-a','local-1',100),('org-a','pay-a','local-2',200);`);
  for (const file of ["0248_v2_quickbooks_billing_queue.sql","0263_v2_quickbooks_payment_reference_sequence.sql"]) await db.exec(await readFile(`server/db/migrations_v2/${file}`,"utf8"));
  await db.exec(`ALTER TABLE v2_quickbooks_sync_links ADD COLUMN projection_version varchar,ADD COLUMN projection_fingerprint varchar,ADD COLUMN projection_json jsonb,ADD COLUMN projection_synced_at timestamptz;
    INSERT INTO v2_quickbooks_sync_jobs(id,organization_id,subject_kind,subject_id,state) VALUES('job-a','org-a','payment','pay-a','queued');
    INSERT INTO v2_quickbooks_payment_reference_counters VALUES('org-a',1000);
    INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_version) VALUES
    ('org-a','customer','local-customer','100',NULL),('org-a','invoice','local-1','10','1'),('org-a','invoice','local-2','20','1');`);
  if (input.historical) await db.exec("INSERT INTO v2_quickbooks_payment_references(organization_id,payment_id,sequence_number,payment_ref_num) VALUES('org-a','pay-a',1000,'PMT-1000')");
  await db.exec(await readFile("server/db/migrations_v2/0300_v2_quickbooks_payment_recovery_context.sql","utf8"));
  // Attempt protection comes only from the parent migration, not fixture repair.
  if (!input.fresh && !input.historical) {
    await db.query("INSERT INTO v2_quickbooks_payment_references(organization_id,payment_id,sequence_number,payment_ref_num,recovery_context) VALUES('org-a','pay-a',1000,'PMT-1000',$1::jsonb)",[JSON.stringify(context)]);
    if (input.attempted !== false) await db.exec("UPDATE v2_quickbooks_payment_references SET provider_attempt_started_at=now() WHERE payment_id='pay-a'");
  }
  if (input.missingPrerequisite) await db.exec("DELETE FROM v2_quickbooks_sync_links WHERE entity_id='local-2'");
  for(const row of referenceRows()) await db.query("UPDATE v2_quickbooks_sync_links SET projection_json=$3::jsonb WHERE organization_id='org-a' AND entity_kind=$1 AND entity_id=$2",[row.entity_kind,row.entity_id,JSON.stringify({providerIdentity:row.provider_identity})]);
  if (input.failCompletion) await db.exec("CREATE FUNCTION fixture_fail_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='succeeded' THEN RAISE EXCEPTION 'inert completion failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_fail_completion BEFORE UPDATE ON v2_quickbooks_sync_jobs FOR EACH ROW EXECUTE FUNCTION fixture_fail_completion()");
  let visible=input.visible??[],delayed=false,legacyWrites=0,creates=0,connectionUnavailable=input.connectionFailure??false;
  const calls:{sql:string;values:unknown[]}[]=[];
  const query=async(sql:string,values:readonly unknown[]=[]):Promise<any>=>{calls.push({sql,values:[...values]});return db.query(sql,[...values]);};
  const requests:{url:string;method:string;payload:any}[]=[],entities={Customer:[] as any[],Invoice:[] as any[],Payment:[] as any[]};
  if(input.publisher){
    await db.exec(`DELETE FROM v2_quickbooks_sync_links;
      ALTER TABLE v2_billing_invoices ADD COLUMN sales_order_document_id varchar,ADD COLUMN invoice_display_number varchar,ADD COLUMN currency varchar DEFAULT 'USD',ADD COLUMN issued_at timestamptz DEFAULT '2026-01-01',ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN total_cents bigint,ADD COLUMN tax_total_cents bigint DEFAULT 0;
      UPDATE v2_billing_invoices SET sales_order_document_id=id,invoice_display_number=id,total_cents=CASE WHEN id='local-1' THEN 100 ELSE 200 END;
      CREATE TABLE v2_sales_documents(id varchar,organization_id varchar,display_number varchar); INSERT INTO v2_sales_documents VALUES('local-1','org-a','local-1'),('local-2','org-a','local-2');
      CREATE TABLE customers(id varchar,organization_id varchar,display_name varchar,company_name varchar,email varchar,phone varchar,customer_type varchar); INSERT INTO customers VALUES('local-customer','org-a','Modern Buyer',NULL,NULL,NULL,'business');
      CREATE TABLE v2_billing_invoice_lines(organization_id varchar,invoice_id varchar,position integer,description varchar,quantity integer,selling_unit_cents bigint,selling_line_cents bigint); INSERT INTO v2_billing_invoice_lines VALUES('org-a','local-1',1,'Line one',1,100,100),('org-a','local-2',1,'Line two',1,200,200);
      CREATE TABLE v2_billing_invoice_additional_charges(organization_id varchar,invoice_id varchar,created_at timestamptz,id varchar,customer_note varchar,customer_charge_cents bigint);
      CREATE TABLE v2_quickbooks_invoice_approvals(organization_id varchar,invoice_id varchar,synchronization_version varchar); INSERT INTO v2_quickbooks_invoice_approvals VALUES('org-a','local-1','1'),('org-a','local-2','1');
      ALTER TABLE v2_billing_payments ADD COLUMN invoice_id varchar; UPDATE v2_billing_payments SET invoice_id='local-1';
      CREATE TABLE v2_billing_refunds(id varchar,organization_id varchar,invoice_id varchar,amount_cents bigint,currency varchar);
      INSERT INTO v2_quickbooks_sync_jobs(id,organization_id,subject_kind,subject_id,state,available_at) VALUES('invoice-job-1','org-a','invoice','local-1','queued',now()-interval '2 seconds'),('invoice-job-2','org-a','invoice','local-2','queued',now()-interval '1 second');
      CREATE TABLE oauth_connections(id varchar,organization_id varchar,provider varchar,company_id varchar,access_token varchar,token_expires_at timestamptz,metadata jsonb,created_at timestamptz,updated_at timestamptz); INSERT INTO oauth_connections VALUES('conn-a','org-a','quickbooks','1234','inert',now()+interval '1 day','{"qbConnection":{"authoritative":true,"state":"connected"}}',now(),now());`);
    if(input.publicationCollision)entities.Customer.push({Id:"999",DisplayName:"Modern Buyer",Notes:"unrelated company"});
  }
  const actualTransport=new PostgresQuickBooksPaymentReadTransport({query} as never,(async(url:string,options:RequestInit)=>{
    const method=options.method??"GET",payload=options.body?JSON.parse(String(options.body)):undefined;requests.push({url,method,payload});
    const path=new URL(url).pathname.split("/").slice(-2),kind=path.at(-1)?.split("?")[0],queryText=new URL(url).searchParams.get("query");
    if(method==="POST"){
      const entity=url.includes("/customer?")?"Customer":url.includes("/invoice?")?"Invoice":"Payment";
      const requestId=new URL(url).searchParams.get("requestid");
      if(entity!=="Payment")expect((await db.query<{provider_attempt_started_at:unknown}>("SELECT provider_attempt_started_at FROM v2_quickbooks_provider_requests WHERE request_id=$1",[requestId])).rows[0]!.provider_attempt_started_at).not.toBeNull();
      if(input.unknownPublication===entity.toLowerCase())throw new Error("inert publication outcome unknown");
      const id=payload.Id??(entity==="Customer"?"100":entity==="Invoice"?(payload.DocNumber==="local-1"?"10":"20"):"300");
      const existing=entities[entity].findIndex(row=>row.Id===id);
      const value={...payload,Id:id,...(entity==="Invoice"?{SyncToken:String(existing<0?0:Number(entities.Invoice[existing].SyncToken)+1),TotalAmt:payload.Line.reduce((sum:number,line:any)=>sum+line.Amount,0),TxnTaxDetail:{TotalTax:0}}:{}),...(entity==="Payment"?{UnappliedAmt:0}:{})};
      if(existing<0)entities[entity].push(value);else entities[entity][existing]=value;
      if(input.afterPublicationPost)await input.afterPublicationPost(db,entity);
      if(input.lostPublication===entity.toLowerCase())throw new Error("inert publication response lost");
      return {ok:true,json:async()=>({[entity]:value})};
    }
    if(queryText){const entity=/FROM (Customer|Invoice|Payment)/.exec(queryText)![1] as keyof typeof entities;const field=entity==="Customer"?"DisplayName":entity==="Invoice"?"DocNumber":"PaymentRefNum";const selected=/'([^']*)'/.exec(queryText)![1];const rows=entities[entity].filter(row=>row[field]===selected);return {ok:true,json:async()=>({QueryResponse:queryText.includes("COUNT(*)")?{totalCount:rows.length}:{[entity]:rows,startPosition:1,maxResults:rows.length,totalCount:rows.length}})};}
    const entity=path[0]==="customer"?"Customer":path[0]==="invoice"?"Invoice":"Payment";const row=entities[entity].find(row=>row.Id===kind);return {ok:true,json:async()=>row?{[entity]:row}:{}};
  }) as never,{});
  const readPort = {
    ...reader(()=>visible),
    connection:async()=>{if(connectionUnavailable)throw recovery.quickBooksPaymentReconciliationRequired("inert credentials unavailable");return {organizationId:"org-a",realmId:"1234",environment:"sandbox" as const};},
    assertCreationReferences:(connection: transport.QuickBooksPaymentConnection,expected:Omit<QuickBooksPaymentRecoveryContext,"reference">)=>new PostgresQuickBooksPaymentReadTransport({query} as never,undefined,{}).assertCreationReferences(connection,expected),
    payments: async (connection: unknown, reference: string, id?: string) => {if (!delayed && input.beforeProviderRead) {delayed=true;await input.beforeProviderRead(db);}return read(visible.filter(p=>!id||(p as {Id:string}).Id===id));},
    createPayment: async (_connection: unknown, expected: QuickBooksPaymentRecoveryContext) => {
      creates++;const row=(await db.query<{provider_attempt_started_at:unknown;recovery_context:unknown}>("SELECT provider_attempt_started_at,recovery_context FROM v2_quickbooks_payment_references")).rows[0]!;
      expect(row.provider_attempt_started_at).not.toBeNull();expect(row.recovery_context).toEqual(expected);if(!input.unknownResult)visible=[payment()];if(input.lostResponse||input.unknownResult)throw new Error("inert lost response");return {qbPaymentId:"300"};
    },
  };
  const values=new Map<string,object>([
    ["node:crypto",{randomUUID}],["node:os",{hostname:()=>"fixture"}],
    ["../../../server/quickbooksService.js",{syncV2PaymentToQuickBooks:async()=>{legacyWrites++;visible=[payment()];return {qbPaymentId:"300"};},syncV2InvoiceToQuickBooks:()=>{throw new Error("forbidden Invoice export");},syncV2RefundCreditMemoToQuickBooks:()=>{throw new Error("forbidden Refund export");},syncV2RefundDisbursementToQuickBooks:()=>{throw new Error("forbidden Refund export");},fetchQBCustomersForPreview:()=>{},fetchQBInvoicePreviewPage:()=>{},importQBInvoicesByIds:()=>{throw new Error("forbidden V1 import");}}],
    ["./quickBooksQueuePolicy.js",policy],["./quickBooksLiveInvoiceProjection.js",projection],["./quickBooksPaymentReference.js",reference],["./quickBooksPaymentRecovery.js",recovery],["./quickBooksPaymentExport.js",exporter],["./quickBooksPaymentReadTransport.js",transport],["./quickBooksProviderPublication.js",publications],
  ]);
  const vm=createContext({Date,process:{env:{},pid:1}});
  const module=new SourceTextModule(ts.transpileModule(await readFile("v2/infrastructure/accounting/quickBooksBillingQueue.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context:vm});
  await module.link(async specifier=>{const exported=values.get(specifier);if(!exported)throw new Error(`Unapproved queue import: ${specifier}`);return new SyntheticModule(Object.keys(exported),function(){for(const [name,value] of Object.entries(exported))this.setExport(name,value);},{context:vm});});await module.evaluate();
  const Worker=(module.namespace as any).V2QuickBooksBillingWorker,Sync=(module.namespace as any).PostgresQuickBooksSyncNow,pool={query,connect:async()=>({query,release(){}})};
  const port=input.publisher?actualTransport:readPort;
  return {db,calls,requests,entities,worker:new Worker(pool,"worker-a",port),sync:new Sync(pool,port),restoreCredentials:()=>{connectionUnavailable=false;},legacyWrites:()=>legacyWrites,creates:()=>creates,close:()=>db.close()};
};

describe("actual Payment queue SQL rejects stale adoption and distinguishes durable provider attempts",()=>{
  test("stale generation cannot insert or overwrite a Payment link",async()=>{
    const f=await queueFixture({visible:[payment()],beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_sync_jobs SET claimed_by='new-worker',attempt_count=attempt_count+1,updated_at=now() WHERE id='job-a'");}});
    try {await f.worker.run(1);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toHaveLength(0);expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"))).toBe(false);}finally{await f.close();}
  });
  test("operator recovery cannot adopt after a held job's generation changes",async()=>{
    const f=await queueFixture({visible:[payment()],beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_sync_jobs SET state='uncertain',updated_at=updated_at+interval '1 second' WHERE id='job-a'");}});
    try {await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked' WHERE id='job-a'");await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{})).rejects.toThrow();expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("a missing prerequisite on the first claim may create once after it is ready",async()=>{
    const f=await queueFixture({fresh:true,missingPrerequisite:true});
    try {expect((await f.worker.run(1)).retry).toBe(1);await f.db.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_version,projection_json) VALUES('org-a','invoice','local-2','20','1',$1::jsonb)",[JSON.stringify({providerIdentity:referenceRows()[2]!.provider_identity})]);await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET available_at=now() WHERE id='job-a'");expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);expect(f.legacyWrites()).toBe(0);}finally{await f.close();}
  });
  test("fresh Payment creation never uses the unbound V1 write bridge",async()=>{
    const f=await queueFixture({fresh:true});try {expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.legacyWrites()).toBe(0);expect(f.creates()).toBe(1);}finally{await f.close();}
  });
  test("confirmed Payment link and completion commit in one guarded SQL transaction",async()=>{
    const f=await queueFixture({visible:[payment()]});try{expect((await f.worker.run(1)).succeeded).toBe(1);const linked=(await f.db.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows;expect(linked).toEqual([{provider_id:"300"}]);expect((await f.db.query<{state:string}>("SELECT state FROM v2_quickbooks_sync_jobs WHERE id='job-a'")).rows[0]!.state).toBe("succeeded");const insert=f.calls.findIndex(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"));expect(f.calls[insert-2]!.sql).toContain("FOR UPDATE");expect(f.calls.at(-1)!.sql).toBe("COMMIT");expect(f.creates()).toBe(0);}finally{await f.close();}
  });
  test("expired lease cannot write a link or finalize job state",async()=>{
    const f=await queueFixture({visible:[payment()],beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_sync_jobs SET lease_expires_at=now()-interval '1 second' WHERE id='job-a'");}});try{expect((await f.worker.run(1)).uncertain).toBe(1);expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"))).toBe(false);expect((await f.db.query<{state:string}>("SELECT state FROM v2_quickbooks_sync_jobs WHERE id='job-a'")).rows[0]!.state).toBe("processing");}finally{await f.close();}
  });
  test("actual SQL failure rolls back both operator adoption and completion",async()=>{
    const f=await queueFixture({visible:[payment()],failCompletion:true});try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked' WHERE id='job-a'");await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{})).rejects.toThrow("inert completion failure");expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toHaveLength(0);expect((await f.db.query<{state:string}>("SELECT state FROM v2_quickbooks_sync_jobs WHERE id='job-a'")).rows[0]!.state).toBe("blocked");expect(f.calls.at(-1)!.sql).toBe("ROLLBACK");}finally{await f.close();}
  });
  test("unique provider binding is preserved and duplicate adoption rolls back",async()=>{
    const f=await queueFixture({visible:[payment()]});try{await f.db.exec("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES('org-a','payment','other-payment','300')");expect((await f.worker.run(1)).blocked).toBe(1);expect((await f.db.query<{entity_id:string;provider_id:string}>("SELECT entity_id,provider_id FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toEqual([{entity_id:"other-payment",provider_id:"300"}]);}finally{await f.close();}
  });
  test("a raced different local identity is never overwritten",async()=>{
    const f=await queueFixture({visible:[payment()],beforeProviderRead:async db=>{await db.exec("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES('org-a','payment','pay-a','999')");}});try{expect((await f.worker.run(1)).blocked).toBe(1);expect((await f.db.query<{provider_id:string}>("SELECT provider_id FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toEqual([{provider_id:"999"}]);expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"))).toBe(false);}finally{await f.close();}
  });
  test("recovery requires current operator authority after the provider read",async()=>{
    const f=await queueFixture({visible:[payment()]});try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked' WHERE id='job-a'");let checks=0;await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{checks++;throw new Error("operator authority revoked");})).rejects.toThrow("authority revoked");expect(checks).toBe(1);expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"))).toBe(false);expect((await f.db.query<{state:string}>("SELECT state FROM v2_quickbooks_sync_jobs WHERE id='job-a'")).rows[0]!.state).toBe("blocked");}finally{await f.close();}
  });
  test("prepared unattempted request remains fresh even after many queue claims",async()=>{
    const f=await queueFixture({attempted:false});try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET attempt_count=17,last_error='unrelated prerequisite wait' WHERE id='job-a'");expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);expect((await f.db.query<{recovery_context:unknown}>("SELECT recovery_context FROM v2_quickbooks_payment_references")).rows[0]!.recovery_context).toEqual(context);}finally{await f.close();}
  });
  test("true unknown provider attempt never creates again, even if the claim counter/error is reset",async()=>{
    const f=await queueFixture({fresh:true,unknownResult:true});try{expect((await f.worker.run(1)).blocked).toBe(1);const marker=(await f.db.query("SELECT provider_attempt_started_at::text FROM v2_quickbooks_payment_references")).rows;await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='queued',attempt_count=0,last_error='Failed to get valid access token',available_at=now() WHERE id='job-a'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.creates()).toBe(1);expect((await f.db.query("SELECT provider_attempt_started_at::text FROM v2_quickbooks_payment_references")).rows).toEqual(marker);}finally{await f.close();}
  });
  test("a raced attempt marker cannot authorize a second invocation",async()=>{
    const f=await queueFixture({attempted:false,beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_payment_references SET provider_attempt_started_at=now() WHERE payment_id='pay-a'");}});try{expect((await f.worker.run(1)).blocked).toBe(1);expect(f.creates()).toBe(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='payment'")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("accepted lost response recovers one provider attempt through actual SQL",async()=>{
    const f=await queueFixture({fresh:true,lostResponse:true});try{expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);expect(f.legacyWrites()).toBe(0);}finally{await f.close();}
  });
  test("historical NULL context stays held without a backfill or provider attempt",async()=>{
    const f=await queueFixture({historical:true,visible:[payment()]});try{expect((await f.worker.run(1)).blocked).toBe(1);expect(f.creates()).toBe(0);expect((await f.db.query<{recovery_context:unknown;provider_attempt_started_at:unknown}>("SELECT recovery_context,provider_attempt_started_at FROM v2_quickbooks_payment_references")).rows).toEqual([{recovery_context:null,provider_attempt_started_at:null}]);}finally{await f.close();}
  });
  test("missing parent attempt-column schema fails closed before any invocation",async()=>{
    const f=await queueFixture({fresh:true});try{await f.db.exec("ALTER TABLE v2_quickbooks_payment_references DROP COLUMN provider_attempt_started_at CASCADE");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.creates()).toBe(0);expect(f.legacyWrites()).toBe(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_payment_references")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("lost lease before attempt marking performs no marker update or provider invocation",async()=>{
    const f=await queueFixture({fresh:true,beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_sync_jobs SET claimed_by='new-worker',attempt_count=attempt_count+1 WHERE id='job-a'");}});try{expect((await f.worker.run(1)).uncertain).toBe(1);expect(f.creates()).toBe(0);expect(f.calls.some(c=>c.sql.startsWith("UPDATE v2_quickbooks_payment_references"))).toBe(false);expect((await f.db.query<{provider_attempt_started_at:unknown}>("SELECT provider_attempt_started_at FROM v2_quickbooks_payment_references")).rows[0]!.provider_attempt_started_at).toBeNull();}finally{await f.close();}
  });
  test("same held state and attempt count still require the unchanged generation",async()=>{
    const f=await queueFixture({visible:[payment()],beforeProviderRead:async db=>{await db.exec("UPDATE v2_quickbooks_sync_jobs SET updated_at=updated_at+interval '1 second' WHERE id='job-a'");}});try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked' WHERE id='job-a'");await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{})).rejects.toThrow("generation changed");expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_sync_links"))).toBe(false);}finally{await f.close();}
  });
  test("a rolled-back attempt-marker transaction is not a provider attempt",async()=>{
    const f=await queueFixture({fresh:true});try{
      await f.db.exec("CREATE FUNCTION fixture_fail_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_attempt_started_at IS NOT NULL THEN RAISE EXCEPTION 'inert attempt marker failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fixture_fail_attempt BEFORE UPDATE ON v2_quickbooks_payment_references FOR EACH ROW EXECUTE FUNCTION fixture_fail_attempt()");
      expect((await f.worker.run(1)).retry).toBe(1);expect(f.creates()).toBe(0);expect((await f.db.query<{provider_attempt_started_at:unknown}>("SELECT provider_attempt_started_at FROM v2_quickbooks_payment_references")).rows[0]!.provider_attempt_started_at).toBeNull();
      await f.db.exec("DROP TRIGGER fixture_fail_attempt ON v2_quickbooks_payment_references; UPDATE v2_quickbooks_sync_jobs SET available_at=now() WHERE id='job-a'");
      expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);expect((await f.db.query<{recovery_context:unknown}>("SELECT recovery_context FROM v2_quickbooks_payment_references")).rows[0]!.recovery_context).toEqual(context);
    }finally{await f.close();}
  });
  test("Payment cannot be resumed using only credential-error text",async()=>{
    const f=await queueFixture();try{await expect(f.sync.resumeAfterCredentialReauth("org-a","payment","pay-a")).rejects.toThrow("durable attempt state");expect(f.calls).toHaveLength(0);expect(f.creates()).toBe(0);}finally{await f.close();}
  });
  test("never-prepared credential failure can explicitly retry after restoration without a reconcile POST",async()=>{
    const f=await queueFixture({fresh:true,connectionFailure:true});try{
      expect((await f.worker.run(1)).blocked).toBe(1);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_payment_references")).rows).toHaveLength(0);f.restoreCredentials();
      await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{})).rejects.toThrow();expect(f.creates()).toBe(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_payment_references")).rows).toHaveLength(0);
      expect(await f.sync.retry("org-a","payment","pay-a")).toEqual({state:"queued",attemptCount:1});expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);
    }finally{await f.close();}
  });
  test.each([{historical:true},{attempted:true}])("historical/started attempts cannot be retried by resetting counters or credential text (%j)",async options=>{
    const f=await queueFixture(options);try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked',attempt_count=0,last_error='credentials restored' WHERE id='job-a'");await expect(f.sync.retry("org-a","payment","pay-a")).rejects.toThrow("original Payment attempt");expect(f.creates()).toBe(0);}finally{await f.close();}
  });
  test("prepared valid context without an attempt can explicitly retry independently of error text",async()=>{
    const f=await queueFixture({attempted:false});try{await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='blocked',attempt_count=9,last_error='QUICKBOOKS_PAYMENT_RECONCILIATION_REQUIRED: before invocation' WHERE id='job-a'");expect(await f.sync.retry("org-a","payment","pay-a")).toEqual({state:"queued",attemptCount:9});expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.creates()).toBe(1);}finally{await f.close();}
  });
  test("a known provider Payment without request context stays held",async()=>{
    const f=await queueFixture({fresh:true});try{await f.db.exec("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id) VALUES('org-a','payment','pay-a','300');UPDATE v2_quickbooks_sync_jobs SET state='blocked' WHERE id='job-a'");await expect(f.sync.retry("org-a","payment","pay-a")).rejects.toThrow("original Payment attempt");expect(f.creates()).toBe(0);}finally{await f.close();}
  });
  test.each(["legacy","old-realm","wrong-customer"] as const)("actual SQL refuses new context/marker for %s reference bindings",async fault=>{
    const f=await queueFixture({fresh:true});try{
      if(fault==="legacy")await f.db.exec("UPDATE v2_quickbooks_sync_links SET projection_json=NULL WHERE entity_kind IN ('invoice','customer')");
      else if(fault==="old-realm")await f.db.exec("UPDATE v2_quickbooks_sync_links SET projection_json=jsonb_set(projection_json,'{providerIdentity,realmId}','\"5678\"'::jsonb) WHERE entity_kind IN ('invoice','customer')");
      else await f.db.exec("UPDATE v2_quickbooks_sync_links SET projection_json=jsonb_set(projection_json,'{providerIdentity,entityId}','\"another-customer\"'::jsonb) WHERE entity_kind='customer'");
      expect((await f.worker.run(1)).blocked).toBe(1);expect(f.creates()).toBe(0);expect(f.legacyWrites()).toBe(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_payment_references")).rows).toHaveLength(0);expect((await f.db.query<{next_sequence:string}>("SELECT next_sequence::text FROM v2_quickbooks_payment_reference_counters")).rows[0]!.next_sequence).toBe("1000");
      expect(f.calls.some(c=>c.sql.startsWith("INSERT INTO v2_quickbooks_payment_references"))).toBe(false);expect(f.calls.some(c=>c.sql.startsWith("UPDATE v2_quickbooks_payment_references"))).toBe(false);
    }finally{await f.close();}
  });
});

describe("actual pinned prerequisite publisher SQL and transport",()=>{
  test("modern Customer and Invoices publish strong identity and enable a fresh Payment",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{
      const outcome=await f.worker.run(3);if(outcome.succeeded!==3)throw new Error(JSON.stringify((await f.db.query("SELECT subject_id,last_error FROM v2_quickbooks_sync_jobs")).rows));
      expect(outcome).toEqual({claimed:3,succeeded:3,retry:0,uncertain:0,blocked:0});
      const links=(await f.db.query<{entity_kind:string;projection_json:any}>("SELECT entity_kind,projection_json FROM v2_quickbooks_sync_links WHERE entity_kind IN ('customer','invoice')")).rows;
      expect(links).toHaveLength(3);for(const row of links){expect(Object.keys(row.projection_json.providerIdentity).sort()).toEqual(["entityId","entityKind","environment","organizationId","providerId","realmId"]);expect(row.projection_json.providerIdentity.realmId).toBe("1234");expect(row.projection_json.providerRequestId).toMatch(/^v2pub_[a-f0-9]{44}$/);}
      expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(4);expect(f.requests.every(r=>r.url.includes("/company/1234/"))).toBe(true);expect(f.legacyWrites()).toBe(0);
      expect((await f.db.query<{state:string}>("SELECT state FROM v2_quickbooks_sync_jobs WHERE id='job-a'")).rows[0]!.state).toBe("succeeded");
    }finally{await f.close();}
  });
  test.each(["customer","invoice"] as const)("accepted lost %s response recovers the same request without a second mutation",async kind=>{
    const f=await queueFixture({fresh:true,publisher:true,lostPublication:kind});try{expect((await f.worker.run(3)).succeeded).toBe(3);expect(f.requests.filter(r=>r.method==="POST"&&r.url.includes(`/${kind}?`))).toHaveLength(kind==="customer"?1:2);}finally{await f.close();}
  });
  test("unchanged projection advances only local version, changed projection uses one new durable update",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{
      expect((await f.worker.run(3)).succeeded).toBe(3);const count=f.requests.filter(r=>r.method==="POST").length;
      await f.db.exec("UPDATE v2_billing_invoices SET synchronization_version='2' WHERE id='local-1';INSERT INTO v2_quickbooks_invoice_approvals VALUES('org-a','local-1','2');UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now() WHERE id='invoice-job-1'");
      expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count);
      await f.db.exec("UPDATE v2_billing_invoices SET synchronization_version='3',total_cents=150 WHERE id='local-1';UPDATE v2_billing_invoice_lines SET selling_line_cents=150,selling_unit_cents=150 WHERE invoice_id='local-1';INSERT INTO v2_quickbooks_invoice_approvals VALUES('org-a','local-1','3');UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now() WHERE id='invoice-job-1'");
      expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count+1);expect(f.entities.Invoice.find(row=>row.Id==="10").TotalAmt).toBe(1.5);
      const json=(await f.db.query<{projection_json:any}>("SELECT projection_json FROM v2_quickbooks_sync_links WHERE entity_kind='invoice' AND entity_id='local-1'")).rows[0]!.projection_json;expect(json.providerIdentity.entityId).toBe("local-1");expect(json.providerIdentity.realmId).toBe("1234");
    }finally{await f.close();}
  });
  test("old unproven local IDs remain held without a publisher mutation",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{await f.db.exec("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_version) VALUES('org-a','invoice','local-1','10','1')");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_provider_requests")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("a display-name collision never gains an owner marker or a naming suffix",async()=>{
    const f=await queueFixture({fresh:true,publisher:true,publicationCollision:true});try{expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(0);expect(f.entities.Customer[0].DisplayName).toBe("Modern Buyer");expect(f.entities.Customer[0].Notes).toBe("unrelated company");}finally{await f.close();}
  });
  test("stale publisher generation performs zero Invoice-link adoption",async()=>{
    const f=await queueFixture({fresh:true,publisher:true,afterPublicationPost:async(db,kind)=>{if(kind==="Invoice")await db.exec("UPDATE v2_quickbooks_sync_jobs SET claimed_by='new-worker',attempt_count=attempt_count+1 WHERE id='invoice-job-1'");}});try{expect((await f.worker.run(1)).uncertain).toBe(1);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='invoice' AND entity_id='local-1'")).rows).toHaveLength(0);expect((await f.db.query<{confirmed_provider_id:unknown}>("SELECT confirmed_provider_id FROM v2_quickbooks_provider_requests WHERE entity_kind='invoice'")).rows[0]!.confirmed_provider_id).toBeNull();}finally{await f.close();}
  });
  test.each(["tax","adjustment"] as const)("unclear %s shape is held before any Customer or Invoice mutation",async kind=>{
    const f=await queueFixture({fresh:true,publisher:true});try{await f.db.exec(kind==="tax"?"UPDATE v2_billing_invoices SET tax_total_cents=10,total_cents=110 WHERE id='local-1'":"UPDATE v2_billing_invoices SET total_cents=90 WHERE id='local-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(0);}finally{await f.close();}
  });
  test.each(["customer","invoice"] as const)("unknown %s attempt never replays after another claim",async kind=>{
    const f=await queueFixture({fresh:true,publisher:true,unknownPublication:kind});try{expect((await f.worker.run(1)).blocked).toBe(1);const count=f.requests.filter(r=>r.method==="POST").length;await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now()-interval '3 seconds' WHERE id='invoice-job-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count);}finally{await f.close();}
  });
  test("reconnection cannot restamp numerically identical modern links",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{expect((await f.worker.run(3)).succeeded).toBe(3);const before=(await f.db.query("SELECT entity_id,projection_json FROM v2_quickbooks_sync_links ORDER BY entity_id")).rows,count=f.requests.filter(r=>r.method==="POST").length;await f.db.exec("UPDATE oauth_connections SET company_id='5678';UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now()-interval '3 seconds' WHERE id='invoice-job-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count);expect((await f.db.query("SELECT entity_id,projection_json FROM v2_quickbooks_sync_links ORDER BY entity_id")).rows).toEqual(before);}finally{await f.close();}
  });
  test("an outstanding old-realm intent without any link remains held after reconnection",async()=>{
    const f=await queueFixture({fresh:true,publisher:true,afterPublicationPost:async(db,kind)=>{if(kind==="Customer")await db.exec("UPDATE v2_quickbooks_sync_jobs SET claimed_by='new-worker',attempt_count=attempt_count+1 WHERE id='invoice-job-1'");}});try{expect((await f.worker.run(1)).uncertain).toBe(1);const count=f.requests.filter(r=>r.method==="POST").length;await f.db.exec("UPDATE oauth_connections SET company_id='5678';UPDATE v2_quickbooks_sync_jobs SET state='queued',claimed_by=NULL,lease_expires_at=NULL,available_at=now()-interval '3 seconds' WHERE id='invoice-job-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='customer'")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("unexpected external Invoice edits are held, not blindly overwritten",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{await f.worker.run(3);const count=f.requests.filter(r=>r.method==="POST").length;f.entities.Invoice[0].TotalAmt=99;await f.db.exec("UPDATE v2_billing_invoices SET synchronization_version='2',total_cents=150 WHERE id='local-1';UPDATE v2_billing_invoice_lines SET selling_line_cents=150,selling_unit_cents=150 WHERE invoice_id='local-1';INSERT INTO v2_quickbooks_invoice_approvals VALUES('org-a','local-1','2');UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now()-interval '3 seconds' WHERE id='invoice-job-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(count);expect(f.entities.Invoice[0].TotalAmt).toBe(99);}finally{await f.close();}
  });
  test("Invoice adoption and completion both roll back on actual SQL failure",async()=>{
    const f=await queueFixture({fresh:true,publisher:true,failCompletion:true});try{expect((await f.worker.run(1)).retry).toBe(1);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_sync_links WHERE entity_kind='invoice'")).rows).toHaveLength(0);expect((await f.db.query<{confirmed_provider_id:unknown}>("SELECT confirmed_provider_id FROM v2_quickbooks_provider_requests WHERE entity_kind='invoice'")).rows[0]!.confirmed_provider_id).toBeNull();}finally{await f.close();}
  });
  test("claimed modern Invoice metadata without a confirmed request cannot authorize another mutation",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{const identity=referenceRows()[1]!.provider_identity;await f.db.query("INSERT INTO v2_quickbooks_sync_links(organization_id,entity_kind,entity_id,provider_id,projection_version,projection_json) VALUES('org-a','invoice','local-1','10','1',$1::jsonb)",[JSON.stringify({providerIdentity:identity,providerRequestId:"v2pub_missing"})]);expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(0);}finally{await f.close();}
  });
  test("missing protected request schema is visibly held before a publisher POST",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{await f.db.exec("DROP TABLE v2_quickbooks_provider_requests");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(r=>r.method==="POST")).toHaveLength(0);}finally{await f.close();}
  });
  test("approved A100 to B150 to A100 is a new transition, not replay of the first A",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{
      expect((await f.worker.run(3)).succeeded).toBe(3);const first=f.entities.Invoice.find(row=>row.Id==="10").PrivateNote;
      for(const [version,amount] of [["2",150],["3",100]] as const){await f.db.query("UPDATE v2_billing_invoices SET synchronization_version=$1,total_cents=$2 WHERE id='local-1'",[version,amount]);await f.db.query("UPDATE v2_billing_invoice_lines SET selling_line_cents=$1,selling_unit_cents=$1 WHERE invoice_id='local-1'",[amount]);await f.db.query("INSERT INTO v2_quickbooks_invoice_approvals VALUES('org-a','local-1',$1)",[version]);await f.db.exec("UPDATE v2_quickbooks_sync_jobs SET state='queued',available_at=now()-interval '3 seconds' WHERE id='invoice-job-1'");expect((await f.worker.run(1)).succeeded).toBe(1);}
      expect(f.entities.Invoice.find(row=>row.Id==="10").TotalAmt).toBe(1);expect(f.entities.Invoice.find(row=>row.Id==="10").PrivateNote).not.toBe(first);expect(f.requests.filter(row=>row.method==="POST"&&row.url.includes("/invoice?")&&row.payload.DocNumber==="local-1")).toHaveLength(3);
    }finally{await f.close();}
  });
  test("unsafe decimal round trip is held before any Customer or Invoice mutation",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{await f.db.exec("UPDATE v2_billing_invoices SET total_cents=9007199254740991 WHERE id='local-1';UPDATE v2_billing_invoice_lines SET selling_line_cents=9007199254740991,selling_unit_cents=9007199254740991 WHERE invoice_id='local-1'");expect((await f.worker.run(1)).blocked).toBe(1);expect(f.requests.filter(row=>row.method==="POST")).toHaveLength(0);expect((await f.db.query("SELECT 1 FROM v2_quickbooks_provider_requests")).rows).toHaveLength(0);}finally{await f.close();}
  });
  test("actual queue DTO exposes explicit retry, not reconcile, after credentials fail before context",async()=>{
    const f=await queueFixture({fresh:true,publisher:true});try{
      expect((await f.worker.run(2)).succeeded).toBe(2);await f.db.exec("UPDATE oauth_connections SET token_expires_at='2020-01-01'");expect((await f.worker.run(1)).blocked).toBe(1);
      const row=(await f.sync.queueActivity("org-a",{page:1,pageSize:25,search:"",actionRequiredOnly:true})).items.find((row:any)=>row.subjectId==="pay-a");expect(row.retryEligible).toBe(true);expect(row.recoveryEligible).toBe(false);
      const posts=f.requests.filter(row=>row.method==="POST").length;await f.db.exec("UPDATE oauth_connections SET token_expires_at=now()+interval '1 day'");
      await expect(f.sync.reconcilePayment("org-a","pay-a",async()=>{})).rejects.toThrow();expect(f.requests.filter(row=>row.method==="POST")).toHaveLength(posts);
      await f.sync.retry("org-a","payment","pay-a");expect((await f.worker.run(1)).succeeded).toBe(1);expect(f.requests.filter(row=>row.method==="POST")).toHaveLength(posts+1);
    }finally{await f.close();}
  });
});

describe("actual Accounting reconcile HTTP boundary",()=>{
  const fixture=(authorized:boolean,fail=false,changed?:"grant"|"actor"|"tenant")=>{
    const calls:string[][]=[];let credentialResume=0,principalReads=0,adoptions=0;
    const app=express().use(express.json()).use("/v2/organizations/:organizationId/settings/accounting",createQuickBooksIntegrationRouter({integrations:{} as never,principals:{principal:async()=>{principalReads++;const late=principalReads>1;return {kind:"staff",organizationId:late&&changed==="tenant"?"org-b":"org-a",userId:late&&changed==="actor"?"staff-b":"staff-a",authority:{membershipId:"membership-a",capabilities:authorized&&!(late&&changed==="grant")?["organization.configure"]:[]}} as never;}},quickBooksSync:{reconcilePayment:async(org:string,id:string,authorize:()=>Promise<void>)=>{calls.push([org,id]);if(fail)throw recovery.quickBooksPaymentReconciliationRequired("unknown provider result");await authorize();adoptions++;return {state:"succeeded",providerId:"300"};},resumeAfterCredentialReauth:async()=>{credentialResume++;return {state:"queued",attemptCount:2};}} as never}));
    return {app,calls,resume:()=>credentialResume,principalReads:()=>principalReads,adoptions:()=>adoptions};
  };
  test("Payment reconciliation returns confirmed success, never a false queued acknowledgement",async()=>{const f=fixture(true);const response=await request(f.app).post("/v2/organizations/org-a/settings/accounting/queue/payment/pay-a/reconcile").send({providerId:"forged"});expect(response.status).toBe(200);expect(response.body.data.state).toBe("succeeded");expect(response.body.data.providerId).toBe("300");expect(f.calls).toEqual([["org-a","pay-a"]]);expect(f.resume()).toBe(0);});
  test.each([ ["missing grant",false,"org-a"], ["foreign tenant",true,"org-b"] ])("%s does not disclose or reconcile provider evidence",async(_name,grant,org)=>{const f=fixture(grant as boolean);const response=await request(f.app).post(`/v2/organizations/${org}/settings/accounting/queue/payment/pay-a/reconcile`).send({});expect(response.status).toBe(403);expect(f.calls).toHaveLength(0);expect(f.resume()).toBe(0);});
  test("unknown/mismatched provider evidence is an operator conflict, not success or a provider retry",async()=>{const f=fixture(true,true);const response=await request(f.app).post("/v2/organizations/org-a/settings/accounting/queue/payment/pay-a/reconcile").send({});expect(response.status).toBe(409);expect(response.body.error.message).toMatch(/RECONCILIATION_REQUIRED/);expect(f.resume()).toBe(0);});
  test.each(["grant","actor","tenant"] as const)("changed %s after the provider read cannot authorize adoption",async changed=>{const f=fixture(true,false,changed);const response=await request(f.app).post("/v2/organizations/org-a/settings/accounting/queue/payment/pay-a/reconcile").send({});expect(response.status).toBe(403);expect(f.principalReads()).toBe(2);expect(f.adoptions()).toBe(0);expect(f.resume()).toBe(0);});
});
