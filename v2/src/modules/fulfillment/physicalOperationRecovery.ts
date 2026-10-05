import type { OperationContext } from "../../application/operation.js";
import type { ApplicationResult } from "../../errors/applicationError.js";

export const physicalOperations = ["fulfillment.pickup.complete.v1", "fulfillment.shipment.complete.v1", "fulfillment.shipment-container.prepare.v1", "fulfillment.shipment-container.correct.v1", "fulfillment.shipment-container.void.v1", "fulfillment.shipment-container.finalize.v1"] as const;
export type PhysicalOperation = typeof physicalOperations[number];
export type PhysicalIntent = Readonly<{ businessRequestId: string; operation: PhysicalOperation; input: Readonly<Record<string, unknown>> }>;
/** Fingerprint is a 32-byte SHA-256 of canonical submitted domain input, not an authorization grant. */
export type PhysicalRecoveryResult = Readonly<{ organizationId:string; businessRequestId: string; operation: PhysicalOperation; status: "pending" | "succeeded" | "failed" | "withdrawn"; submittedPayloadFingerprint?:string; input?: Readonly<Record<string, unknown>>; result?: unknown; anotherActor: boolean }>;
export interface PhysicalOperationRecoveryPort {
  admit(context: OperationContext, intent: PhysicalIntent): Promise<ApplicationResult<PhysicalRecoveryResult>>;
  discover(context: OperationContext): Promise<ApplicationResult<readonly PhysicalRecoveryResult[]>>;
  receipt(context: OperationContext, operation: PhysicalOperation, businessRequestId: string): Promise<ApplicationResult<PhysicalRecoveryResult>>;
  withdraw(context: OperationContext, operation: PhysicalOperation, businessRequestId: string): Promise<ApplicationResult<PhysicalRecoveryResult>>;
}
