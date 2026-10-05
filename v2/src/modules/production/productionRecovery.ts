import { createHash } from "node:crypto";
import { requireOperationPrincipalScope, type OperationContext } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import type { PrincipalKind } from "../../authorization/principals.js";
import { canonicalJson } from "../shared/commercialValues.js";
import { V2ApplicationError } from "../../errors/applicationError.js";

export type ProductionOutputOperation = "production.attempt.output.v1" | "production.run.output.v1";
export type ProductionOutputIntent = Readonly<{
  businessRequestId: string;
  goodQuantityDelta: number;
  wasteQuantityDelta?: number;
  productionAttemptId?: string;
  productionRunId?: string;
  productionRunAllocationId?: string;
}>;
export type ProductionOutputReceipt = Readonly<{
  operation: ProductionOutputOperation;
  businessRequestId: string;
  productionWorkId?: string;
  productionAttemptId?: string;
  productionRunId?: string;
  productionRunAllocationId?: string;
  intent: ProductionOutputIntent | null;
  historicalIntentUnavailable?: true;
  intentRedacted?: true;
  submittedAt: string;
  status: "pending" | "succeeded" | "rejected";
  result: unknown | null;
  rejection?: Readonly<{code:string;message:string}>;
}>;
// Principal fields are attribution, never part of the tenant/operation/request identity.
export type ProductionRecoveryActor = Readonly<{ organizationId: string; principalKind: PrincipalKind; principalSubject: string; staffActorUserId?: string }>;
export interface ProductionRecoveryPort {
  prepare(actor: ProductionRecoveryActor, operation: ProductionOutputOperation, input: ProductionOutputIntent): Promise<ProductionOutputReceipt>;
  discover(actor: ProductionRecoveryActor, operation: ProductionOutputOperation, businessRequestId?: string): Promise<readonly ProductionOutputReceipt[]>;
  reject(actor: ProductionRecoveryActor, operation: ProductionOutputOperation, input: ProductionOutputIntent, rejection: Readonly<{code:string;message:string}>): Promise<void>;
}
export const productionIntentFingerprint = (input: unknown) => `sha256:${createHash("sha256").update(canonicalJson(input)).digest("hex")}`;

/** Recovery is read/prepare only. Execution still uses the exact existing owner command. */
export class ProductionRecoveryService {
  constructor(private readonly port: ProductionRecoveryPort, private readonly authority = new AuthorityPolicy()) {}
  private actor(c: OperationContext, operation: ProductionOutputOperation): ProductionRecoveryActor {
    requireOperationPrincipalScope(c);
    if (operation !== "production.attempt.output.v1" && operation !== "production.run.output.v1") throw new V2ApplicationError("VALIDATION_ERROR", "Production recovery operation is invalid.");
    const capability = operation === "production.run.output.v1" ? "production.run.execute" : "production.work";
    for (const cap of ["production.view", capability] as const) {
      if (!this.authority.decide(c.principal, { capability: cap, resource: { organizationId: c.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Production output recovery is not authorized.");
    }
    return { organizationId: c.organizationId, principalKind: c.principal.kind, principalSubject: principalSubject(c.principal), staffActorUserId: staffActorId(c.principal) };
  }
  async prepare(c: OperationContext, operation: ProductionOutputOperation, input: ProductionOutputIntent) {
    const actor = this.actor(c, operation);
    const keys = operation === "production.attempt.output.v1" ? ["businessRequestId", "productionAttemptId", "goodQuantityDelta", "wasteQuantityDelta"] : ["businessRequestId", "productionRunId", "productionRunAllocationId", "goodQuantityDelta", "wasteQuantityDelta"];
    if (!input || Object.keys(input).some(key => !keys.includes(key)) || !c.businessRequest || c.businessRequest.id !== input.businessRequestId || typeof input.businessRequestId !== "string" || !input.businessRequestId.trim() || input.businessRequestId.length > 255 ||
      !Number.isSafeInteger(input.goodQuantityDelta) || input.goodQuantityDelta < 0 || !Number.isSafeInteger(input.wasteQuantityDelta ?? 0) || (input.wasteQuantityDelta ?? 0) < 0 || input.goodQuantityDelta + (input.wasteQuantityDelta ?? 0) === 0 ||
      (operation === "production.attempt.output.v1" ? typeof input.productionAttemptId !== "string" || !input.productionAttemptId : typeof input.productionRunId !== "string" || !input.productionRunId || typeof input.productionRunAllocationId !== "string" || !input.productionRunAllocationId)) throw new V2ApplicationError("VALIDATION_ERROR", "An exact Production output intent is required.");
    return this.port.prepare(actor, operation, input);
  }
  async discover(c: OperationContext, operation: ProductionOutputOperation, businessRequestId?: string) {
    const actor = this.actor(c, operation);
    if (businessRequestId !== undefined && (typeof businessRequestId!=="string" || !businessRequestId.trim() || businessRequestId.length > 255)) throw new V2ApplicationError("VALIDATION_ERROR", "Production recovery request identity is invalid.");
    return this.port.discover(actor, operation, businessRequestId);
  }
  async prepared(c: OperationContext, operation: ProductionOutputOperation, input: ProductionOutputIntent) {
    if(!c.businessRequest||c.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","Production output request scope does not match the original intent.");
    const receipt=await this.prepare(c,operation,input);
    if(!receipt.intent)throw new V2ApplicationError("CONFLICT","The historical committed result is recoverable, but its exact submitted intent was not retained. It must not be executed again.");
    if(productionIntentFingerprint(receipt.intent)!==productionIntentFingerprint(input))throw new V2ApplicationError("IDEMPOTENCY_CONFLICT","Production output intent does not match the original request.");
    if(receipt.status==="rejected")throw new V2ApplicationError("CONFLICT","The original output was definitively rejected. Reconcile that receipt before creating a changed physical report.");
    return receipt;
  }
  async reject(c:OperationContext,operation:ProductionOutputOperation,input:ProductionOutputIntent,error:V2ApplicationError){
    const actor=this.actor(c,operation);
    if(["VALIDATION_ERROR","CONFLICT","NOT_FOUND"].includes(error.code))await this.port.reject(actor,operation,input,{code:error.code,message:error.publicMessage});
  }
}
