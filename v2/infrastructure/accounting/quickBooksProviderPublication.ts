import { createHash } from "node:crypto";
import type { QuickBooksInvoiceProjection } from "./quickBooksLiveInvoiceProjection.js";
import { quickBooksInvoiceProjectionFingerprint } from "./quickBooksLiveInvoiceProjection.js";
import { quickBooksPaymentReconciliationRequired } from "./quickBooksPaymentRecovery.js";
import type { QuickBooksPaymentConnection } from "./quickBooksPaymentReadTransport.js";

export type ProviderIdentity = Readonly<{ organizationId:string;entityKind:"customer"|"invoice";entityId:string;providerId:string;realmId:string;environment:"sandbox"|"production" }>;
export type PublicationIntent = Readonly<{ connection:QuickBooksPaymentConnection;entityKind:"customer"|"invoice";entityId:string;requestId:string;payload:Record<string,unknown> }>;
export type ConfirmedPublication = Readonly<{ providerIdentity:ProviderIdentity;providerRequestId:string }>;
export type PublicationLink = Readonly<{providerId:string;projectionJson:unknown}>;
export const publicationEquals=(a:unknown,b:unknown):boolean=>{const normalize=(value:unknown):unknown=>Array.isArray(value)?value.map(normalize):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,normalize(child)])):value;return JSON.stringify(normalize(a))===JSON.stringify(normalize(b));};
export const publicationIntent = (connection:QuickBooksPaymentConnection,entityKind:"customer"|"invoice",entityId:string,payload:Record<string,unknown>,version="create"):PublicationIntent => {
  const requestId=`v2pub_${createHash("sha256").update(JSON.stringify([connection.organizationId,connection.realmId,connection.environment,entityKind,entityId,version])).digest("hex").slice(0,44)}`;
  const marker=`PrintersHero V2 ${entityKind} ${connection.organizationId}/${entityId}; request ${requestId}`;
  return {connection,entityKind,entityId,requestId,payload:{...payload,[entityKind==="customer"?"Notes":"PrivateNote"]:marker}};
};
export const assertInvoicePublicationAmounts=(projection:QuickBooksInvoiceProjection):void=>{
  let total=0;
  for(const line of projection.lines){
    if(!Number.isSafeInteger(line.quantity)||line.quantity<=0||!Number.isSafeInteger(line.unitAmountCents)||line.unitAmountCents<0||!Number.isSafeInteger(line.lineAmountCents)||line.lineAmountCents<0
      ||cents(line.unitAmountCents/100)!==line.unitAmountCents||cents(line.lineAmountCents/100)!==line.lineAmountCents)throw quickBooksPaymentReconciliationRequired("canonical Invoice quantity or cents cannot round-trip exactly through the provider payload");
    total+=line.lineAmountCents;if(!Number.isSafeInteger(total)||cents(total/100)!==total)throw quickBooksPaymentReconciliationRequired("canonical Invoice total cannot round-trip exactly through the provider payload");
  }
};
export const invoicePublicationIntent = (connection:QuickBooksPaymentConnection,entityId:string,customerProviderId:string,projection:QuickBooksInvoiceProjection,approvedVersion:string):PublicationIntent => {
  assertInvoicePublicationAmounts(projection);
  if(!/^\d+$/.test(approvedVersion))throw quickBooksPaymentReconciliationRequired("approved Invoice transition identity is unavailable");
  return publicationIntent(connection,"invoice",entityId,{
  CustomerRef:{value:customerProviderId},DocNumber:projection.displayNumber,TxnDate:projection.postedAt.slice(0,10),CurrencyRef:{value:projection.currency},
  Line:projection.lines.map((line,index)=>({LineNum:index+1,Amount:line.lineAmountCents/100,DetailType:"SalesItemLineDetail",SalesItemLineDetail:{Qty:line.quantity,UnitPrice:line.unitAmountCents/100},Description:line.description})),
},`${approvedVersion}:${quickBooksInvoiceProjectionFingerprint(projection)}`);
};
export const assertPublicationLink = (connection:QuickBooksPaymentConnection,kind:"customer"|"invoice",entityId:string,link:PublicationLink):string => {
  const json=link.projectionJson as {providerIdentity?:ProviderIdentity;providerRequestId?:string}|null,identity=json?.providerIdentity;
  if(!identity||identity.organizationId!==connection.organizationId||identity.realmId!==connection.realmId||identity.environment!==connection.environment||identity.entityKind!==kind||identity.entityId!==entityId||identity.providerId!==link.providerId||!json?.providerRequestId)throw quickBooksPaymentReconciliationRequired("legacy or different-realm provider link has no canonical publication evidence");
  return json.providerRequestId;
};
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const cents=(value:unknown):number|undefined=>{const match=typeof value==="number"?/^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value)):null;if(!match)return undefined;const amount=Number(match[1])*100+Number((match[2]??"").padEnd(2,"0"));return Number.isSafeInteger(amount)?amount:undefined;};
const exactMoney=(a:unknown,b:unknown)=>cents(a)!==undefined&&cents(a)===cents(b);
export const publicationMatches = (intent:PublicationIntent,value:unknown,identityOnly=false):boolean => {
  const entity=object(value),payload=intent.payload,key=intent.entityKind==="customer"?"Notes":"PrivateNote";
  if(typeof entity.Id!=="string"||!/^\d{1,64}$/.test(entity.Id)||entity[key]!==payload[key])return false;
  if(identityOnly)return true;
  if(intent.entityKind==="customer")return entity.DisplayName===payload.DisplayName&&(!payload.CompanyName||entity.CompanyName===payload.CompanyName)&&(!payload.PrimaryEmailAddr||object(entity.PrimaryEmailAddr).Address===object(payload.PrimaryEmailAddr).Address)&&(!payload.PrimaryPhone||object(entity.PrimaryPhone).FreeFormNumber===object(payload.PrimaryPhone).FreeFormNumber);
  if(entity.DocNumber!==payload.DocNumber||entity.TxnDate!==payload.TxnDate||object(entity.CustomerRef).value!==object(payload.CustomerRef).value||object(entity.CurrencyRef).value!==object(payload.CurrencyRef).value||!Array.isArray(entity.Line)||!Array.isArray(payload.Line))return false;
  if(entity.Line.some(line=>!["SalesItemLineDetail","SubTotalLineDetail"].includes(String(object(line).DetailType))))return false;
  const actual=entity.Line.filter(line=>object(line).DetailType==="SalesItemLineDetail"),expected=payload.Line;
  if(actual.length!==expected.length||actual.some((raw,index)=>{const line=object(raw),wanted=object(expected[index]),details=object(line.SalesItemLineDetail),want=object(wanted.SalesItemLineDetail);return line.Description!==wanted.Description||!exactMoney(line.Amount,wanted.Amount)||details.Qty!==want.Qty||!exactMoney(details.UnitPrice,want.UnitPrice);} ))return false;
  return cents(entity.TotalAmt)===expected.reduce((sum,line)=>sum+(cents(object(line).Amount)??NaN),0)&&(!Object.hasOwn(entity,"TxnTaxDetail")||object(entity.TxnTaxDetail).TotalTax===0);
};
