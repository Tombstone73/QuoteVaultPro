export type ProductionRecoveryTransport = <T>(organizationId:string,operation:"production",suffix:string,init:RequestInit,expectedSessionScope:string)=>Promise<T>;
let recoveryTransport:ProductionRecoveryTransport|undefined;
export function configureProductionRecoveryTransport(transport:ProductionRecoveryTransport|undefined){recoveryTransport=transport;}
const ownerRequest=<T>(organizationId:string,sessionScope:string,suffix:string,init:RequestInit,assertCurrent?:()=>void)=>{
  assertCurrent?.();
  if(!recoveryTransport)throw new Error("Production recovery requires the authenticated central transport.");
  return recoveryTransport<T>(organizationId,"production",suffix,init,sessionScope);
};
export type ProductionOutputReceipt = Readonly<{
  operation: "production.attempt.output.v1" | "production.run.output.v1";
  businessRequestId: string;
  productionWorkId?: string;
  productionAttemptId?: string;
  productionRunId?: string;
  productionRunAllocationId?: string;
  intent: Readonly<{ businessRequestId: string; goodQuantityDelta: number; wasteQuantityDelta?: number }> | null;
  historicalIntentUnavailable?:true;
  intentRedacted?:true;
  submittedAt: string;
  status: "pending" | "succeeded" | "rejected";
  rejection?:Readonly<{code:string;message:string}>;
  result: unknown | null;
}>;

function boundProductionResult(receipt:ProductionOutputReceipt,organizationId:string){
  if(!receipt.result||typeof receipt.result!=="object")return false;
  const result=receipt.result as {organizationId?:unknown;productionRunId?:unknown;state?:unknown;revision?:unknown;allocations?:readonly {productionRunAllocationId?:unknown;productionWorkId?:unknown;productionAttemptId?:unknown}[];events?:unknown;work?:{organizationId?:unknown;productionWorkId?:unknown};attempt?:{productionAttemptId?:unknown;productionWorkId?:unknown}};
  if(receipt.operation==="production.attempt.output.v1")return result.work?.organizationId===organizationId&&result.work?.productionWorkId===receipt.productionWorkId&&result.attempt?.productionAttemptId===receipt.productionAttemptId&&result.attempt?.productionWorkId===receipt.productionWorkId;
  if(result.organizationId!==organizationId||result.productionRunId!==receipt.productionRunId||typeof result.state!=="string"||!Number.isInteger(result.revision)||!Array.isArray(result.events)||!Array.isArray(result.allocations))return false;
  return receipt.historicalIntentUnavailable===true||result.allocations.some(allocation=>allocation.productionRunAllocationId===receipt.productionRunAllocationId&&allocation.productionWorkId===receipt.productionWorkId&&allocation.productionAttemptId===receipt.productionAttemptId);
}

export async function discoverProductionOutput(organizationId: string, sessionScope: string, operation: ProductionOutputReceipt["operation"], businessRequestId?: string, signal?: AbortSignal,assertCurrent?:()=>void): Promise<readonly ProductionOutputReceipt[]> {
  const query = new URLSearchParams({ operation, ...(businessRequestId ? { businessRequestId } : {}) });
  const data = await ownerRequest<readonly ProductionOutputReceipt[]>(organizationId,sessionScope,`/output-recovery?${query}`,{method:"GET",signal},assertCurrent);
  assertCurrent?.();
  if(signal?.aborted)throw new Error("Production recovery scope changed. Details remain hidden.");
  if (!Array.isArray(data) || data.some((receipt: ProductionOutputReceipt) => !receipt || receipt.operation !== operation || typeof receipt.businessRequestId !== "string" || !Number.isFinite(Date.parse(receipt.submittedAt)) || !["pending", "succeeded","rejected"].includes(receipt.status) || receipt.status==="succeeded"&&!boundProductionResult(receipt,organizationId) || receipt.status==="rejected"&&!receipt.intentRedacted&&(!receipt.intent||!receipt.rejection||!["VALIDATION_ERROR","CONFLICT","NOT_FOUND"].includes(receipt.rejection.code)||typeof receipt.rejection.message!=="string"||!receipt.rejection.message.trim()) || (receipt.intent ? !receipt.productionWorkId || !receipt.productionAttemptId || receipt.intent.businessRequestId !== receipt.businessRequestId : receipt.intentRedacted!==true&&(receipt.historicalIntentUnavailable!==true || receipt.status!=="succeeded" || !receipt.result)))) throw new Error("Production recovery returned invalid evidence.");
  return data;
}

export async function prepareProductionOutput(organizationId:string,sessionScope:string,operation:ProductionOutputReceipt["operation"],input:NonNullable<ProductionOutputReceipt["intent"]>&Readonly<{productionAttemptId?:string;productionRunId?:string;productionRunAllocationId?:string}>,assertCurrent?:()=>void) {
  const [existing]=await discoverProductionOutput(organizationId,sessionScope,operation,input.businessRequestId,undefined,assertCurrent);
  let command=input;
  if(existing?.intent){
    const matches=existing.businessRequestId===input.businessRequestId&&existing.intent.goodQuantityDelta===input.goodQuantityDelta&&(existing.intent.wasteQuantityDelta??0)===(input.wasteQuantityDelta??0)&&(operation==="production.attempt.output.v1"?existing.productionAttemptId===input.productionAttemptId:existing.productionRunId===input.productionRunId&&existing.productionRunAllocationId===input.productionRunAllocationId);
    if(!matches)throw new Error("The original durable output intent does not match this report. No changed command was sent.");
    command=existing.intent as typeof input;
    if(existing.status==="rejected")throw new Error("The original owner output intent was definitively rejected. Reconcile its receipt before changing the report.");
    // A committed physical result still uses the owner replay path so that
    // post-commit lifecycle reconciliation can be repaired without new effects.
  }
  const data=await ownerRequest<ProductionOutputReceipt>(organizationId,sessionScope,`/output-intents/${operation}`,{method:"POST",body:JSON.stringify(command)},assertCurrent);
  assertCurrent?.();
  if(!data||data.businessRequestId!==input.businessRequestId||data.operation!==operation)throw new Error("Production output intent evidence is invalid.");
  if(!["pending","succeeded","rejected"].includes(data.status)||data.status==="succeeded"&&!boundProductionResult(data,organizationId))throw new Error("Production output result evidence is unavailable. No new output was sent.");
  const expected=command as Record<string,unknown>,received=data.intent as Record<string,unknown>|null;
  if(!received||Object.keys(received).sort().join("\u0000")!==Object.keys(expected).sort().join("\u0000")||Object.keys(expected).some(key=>received[key]!==expected[key]))throw new Error("Production output intent does not match the exact submitted command.");
  if(data.status==="rejected")throw new Error("The original owner output intent was definitively rejected.");
  return {status:data.status==="succeeded"?"succeeded" as const:"pending" as const,result:data.result as unknown,input:{goodQuantityDelta:command.goodQuantityDelta,...(command.wasteQuantityDelta!==undefined?{wasteQuantityDelta:command.wasteQuantityDelta}:{})}};
}

export async function executeProductionOutput<T>(organizationId:string,sessionScope:string,operation:ProductionOutputReceipt["operation"],resource:Readonly<{productionAttemptId?:string;productionRunId?:string;productionRunAllocationId?:string}>,businessRequestId:string,input:Readonly<{goodQuantityDelta:number;wasteQuantityDelta?:number}>,assertCurrent:()=>void):Promise<T>{
  const suffix=operation==="production.attempt.output.v1"?`/attempts/${encodeURIComponent(resource.productionAttemptId!)}/output`:`/runs/${encodeURIComponent(resource.productionRunId!)}/allocations/${encodeURIComponent(resource.productionRunAllocationId!)}/output`;
  const result=await ownerRequest<T>(organizationId,sessionScope,suffix,{method:"POST",body:JSON.stringify({businessRequestId,...input})},assertCurrent);assertCurrent();return result;
}
