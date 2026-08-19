import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type OrderLineMaterialRequirementId, type OrganizationId, type ProductionMaterialConsumptionId, type ProductionWorkId } from "../shared/commercialValues.js";
import type { RecipeUnit } from "../products/productRecipes.js";

export const inventoryMovementKinds = ["reserve", "release", "consume", "waste", "correction"] as const;
export type InventoryMovementKind = (typeof inventoryMovementKinds)[number];
type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;

export type InventoryReservation = Readonly<{ reservationId: string; organizationId: OrganizationId; productionWorkId: ProductionWorkId; requirementId: OrderLineMaterialRequirementId; materialId: string; materialName: string; materialSku: string | null; quantity: string; unit: RecipeUnit }>;
export type InventoryMovement = Readonly<{ movementId: string; organizationId: OrganizationId; materialId: string; materialName: string; materialSku: string | null; productionWorkId: ProductionWorkId; reservationId?: string; requirementId?: OrderLineMaterialRequirementId; consumptionId?: ProductionMaterialConsumptionId; quantity: string; unit: RecipeUnit; kind: InventoryMovementKind; onHandDelta: string; reservedDelta: string; createdAt: string }>;
export type InventoryBalance = Readonly<{ materialId: string; materialName: string; materialSku: string | null; unit: RecipeUnit; onHandQuantity: string; reservedQuantity: string; availableQuantity: string }>;
export type InventoryReconciliation = Readonly<{ productionWorkId: ProductionWorkId; balances: readonly InventoryBalance[]; movements: readonly InventoryMovement[] }>;

export interface InventoryLedgerTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: unknown): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string; summary: string } & Actor>): Promise<void>;
  reserveForWork(input: Readonly<{ organizationId: OrganizationId; productionWorkId: ProductionWorkId; operationRequestId: string } & Actor>): Promise<readonly InventoryReservation[]>;
  releaseUnusedForWork(input: Readonly<{ organizationId: OrganizationId; productionWorkId: ProductionWorkId; operationRequestId: string } & Actor>): Promise<readonly InventoryMovement[]>;
  applyConsumption(input: Readonly<{ organizationId: OrganizationId; consumptionId: ProductionMaterialConsumptionId; operationRequestId: string } & Actor>): Promise<InventoryMovement>;
  read(organizationId: OrganizationId, productionWorkId: ProductionWorkId): Promise<InventoryReconciliation | null>;
}
export interface InventoryLedgerTransactionRunner { transaction<T>(work: (tx: InventoryLedgerTransaction) => Promise<T>): Promise<T>; }

const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const error = (cause: unknown) => cause instanceof V2ApplicationError ? cause : new V2ApplicationError("CONFLICT", cause instanceof Error ? cause.message : "Inventory operation could not be completed.");

/**
 * V2 inventory is deliberately applied after immutable P7C consumption.  A
 * failed stock application never deletes Production history; it remains a
 * retryable reconciliation operation keyed by the consumption fact.
 */
export class InventoryLedgerApplicationService {
  constructor(private readonly runner: InventoryLedgerTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async reserveForProductionWork(context: OperationContext, input: Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId }>): Promise<ApplicationResult<readonly InventoryReservation[]>> {
    return this.mutate(context, "inventory.reserve-production-work.v1", input, async (tx, requestId) => tx.reserveForWork({ organizationId: brandedId<"OrganizationId">(context.organizationId), productionWorkId: input.productionWorkId, operationRequestId: requestId, ...actor(context) }));
  }
  async releaseUnusedForProductionWork(context: OperationContext, input: Readonly<{ businessRequestId: string; productionWorkId: ProductionWorkId }>): Promise<ApplicationResult<readonly InventoryMovement[]>> {
    return this.mutate(context, "inventory.release-production-work.v1", input, async (tx, requestId) => tx.releaseUnusedForWork({ organizationId: brandedId<"OrganizationId">(context.organizationId), productionWorkId: input.productionWorkId, operationRequestId: requestId, ...actor(context) }));
  }
  async applyProductionConsumption(context: OperationContext, input: Readonly<{ businessRequestId: string; consumptionId: ProductionMaterialConsumptionId }>): Promise<ApplicationResult<InventoryMovement>> {
    return this.mutate(context, "inventory.apply-production-consumption.v1", input, async (tx, requestId) => tx.applyConsumption({ organizationId: brandedId<"OrganizationId">(context.organizationId), consumptionId: input.consumptionId, operationRequestId: requestId, ...actor(context) }));
  }
  async read(context: OperationContext, productionWorkId: ProductionWorkId): Promise<ApplicationResult<InventoryReconciliation>> {
    try {
      requireOperationPrincipalScope(context);
      if (!this.authority.decide(context.principal, { capability: "production.view", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to view Production inventory.");
      const projection = await this.runner.transaction((tx) => tx.read(brandedId<"OrganizationId">(context.organizationId), productionWorkId));
      if (!projection) throw new V2ApplicationError("NOT_FOUND", "Production work was not found.");
      return success(projection);
    } catch (cause) { return failure(error(cause)); }
  }
  private async mutate<T>(context: OperationContext, operation: string, input: { businessRequestId: string }, work: (tx: InventoryLedgerTransaction, requestId: string) => Promise<T>): Promise<ApplicationResult<T>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!this.authority.decide(context.principal, { capability: "production.work", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to reconcile Production inventory.");
      const value = await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as T;
        const result = await work(tx, reservation.request.id);
        const resourceId = Array.isArray(result) ? (result[0] as { reservationId?: string; movementId?: string } | undefined)?.reservationId ?? (result[0] as { movementId?: string } | undefined)?.movementId ?? input.businessRequestId : (result as { movementId?: string }).movementId ?? input.businessRequestId;
        await tx.attribute({ organizationId: context.organizationId, requestId: reservation.request.id, operation, resourceId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation, resourceId, summary: operation, ...actor(context) });
        await tx.succeed(context.organizationId, reservation.request.id, result);
        return result;
      });
      return success(value);
    } catch (cause) { return failure(error(cause)); }
  }
}
