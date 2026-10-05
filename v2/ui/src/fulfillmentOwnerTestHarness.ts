import { configureFulfillmentOwnerTransport } from "./fulfillmentOwnerApi";
import { fulfillmentApi } from "./api";
import type { PhysicalOperation,PhysicalRecoveryResult } from "../../src/modules/fulfillment/physicalOperationRecovery";
import { createHash,webcrypto } from "node:crypto";
import { canonicalJson } from "../../src/modules/shared/commercialValues";
let fixtureReceipts=new Map<string,PhysicalRecoveryResult>();
export const recordFulfillmentOwnerTestResult=(org:string,operation:PhysicalOperation,businessRequestId:string)=>{const key=JSON.stringify([org,operation,businessRequestId]),row=fixtureReceipts.get(key);if(!row)throw Error("The fixture must admit its exact command before recording success.");fixtureReceipts.set(key,{...row,status:"succeeded",input:undefined});};
/** Inert transport for existing mounted fixtures, never a production fallback. */
export function installFulfillmentOwnerTestTransport(){
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:webcrypto});
  const receipts=new Map<string,PhysicalRecoveryResult>();
  fixtureReceipts=receipts;
  configureFulfillmentOwnerTransport(async <T>(org:string,suffix:string,init?:RequestInit):Promise<T>=>{
    const body=init?.body?JSON.parse(String(init.body)):{};
    if(suffix==="/physical-operations")return [] as T;
    if(suffix==="/physical-operations/admit"){const result:PhysicalRecoveryResult={organizationId:org,businessRequestId:body.businessRequestId,operation:body.operation,status:"pending",anotherActor:false,input:body.input,submittedPayloadFingerprint:`sha256:${createHash("sha256").update(canonicalJson(body.input)).digest("hex")}`};receipts.set(JSON.stringify([org,body.operation,body.businessRequestId]),result);return result as T;}
    if(suffix.endsWith("/withdraw")){const operation=decodeURIComponent(suffix.split("/")[2]) as PhysicalOperation,key=JSON.stringify([org,operation,body.businessRequestId]),prior=receipts.get(key),result:PhysicalRecoveryResult={organizationId:org,businessRequestId:body.businessRequestId,operation,status:"withdrawn",anotherActor:false,submittedPayloadFingerprint:prior?.submittedPayloadFingerprint};receipts.set(key,result);return result as T;}
    if(suffix.startsWith("/physical-operations/")&&!init?.method){const parts=suffix.split("/"),result=receipts.get(JSON.stringify([org,decodeURIComponent(parts[2]),decodeURIComponent(parts[3])]));if(result)return result as T;throw {code:"NOT_FOUND",message:"No synthetic receipt; absence is not proof of failure."};}
    if(suffix.endsWith("/sender-context"))return {orderId:decodeURIComponent(suffix.split("/")[2]),customerId:"customer-a",defaultBlindShipping:false,billingSender:{}} as T;
    const {businessRequestId,...input}=body;
    if(suffix==="/shipments/prepared"){const result=await fulfillmentApi.createShipment(org,businessRequestId,input as any);recordFulfillmentOwnerTestResult(org,"fulfillment.shipment-container.prepare.v1",businessRequestId);return result as T;}
    if(suffix.endsWith("/correct")){const result=await fulfillmentApi.correctShipment(org,decodeURIComponent(suffix.split("/")[2]),businessRequestId,input as any);recordFulfillmentOwnerTestResult(org,"fulfillment.shipment-container.correct.v1",businessRequestId);return result as T;}
    throw new Error(`Unexpected inert Fulfillment owner path ${suffix}`);
  });
}
