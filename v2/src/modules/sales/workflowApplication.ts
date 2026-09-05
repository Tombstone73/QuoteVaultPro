import { createHash } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { canonicalJson, brandedId, type OrderId, type OrderLineId, type OrganizationId } from "../shared/commercialValues.js";
import type { OrderAutomaticLifecycle } from "./orderAutomaticLifecycle.js";
import { decideWorkflowBypass, type OrganizationWorkflowPolicy } from "./workflowPolicy.js";

type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;
export type WorkflowStation = "flatbed" | "roll";
export type WorkflowTransitionResult = Readonly<{ orderId: OrderId; orderLineId: OrderLineId; action: "direct_production" | "production_not_required"; policy: OrganizationWorkflowPolicy; confirmationRequired: boolean; destination?: WorkflowStation }>;
export type WorkflowActionEligibility = Readonly<{ action: "direct_production" | "production_not_required"; orderLineId: OrderLineId; confirmationRequired: boolean; allowedDestinations?: readonly WorkflowStation[]; reasonRequired: boolean; eligibilityReason: string }>;
export type DirectProductionCommand = Readonly<{ businessRequestId: string; orderId: OrderId; orderLineId: OrderLineId; destination: WorkflowStation; confirmed?: boolean }>;
export type ProductionNotRequiredCommand = Readonly<{ businessRequestId: string; orderId: OrderId; orderLineId: OrderLineId; reason: string; confirmed?: boolean }>;
export interface WorkflowTransitionTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: WorkflowTransitionResult): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: string } & Actor>): Promise<void>;
  policy(organizationId: OrganizationId): Promise<OrganizationWorkflowPolicy>;
  eligibleActions(organizationId: OrganizationId, orderId: OrderId, confirmationRequired: boolean): Promise<readonly WorkflowActionEligibility[]>;
  directProduction(input: Readonly<{ organizationId: OrganizationId; orderId: OrderId; orderLineId: OrderLineId; destination: WorkflowStation; reason: string } & Actor>): Promise<void>;
  productionNotRequired(input: Readonly<{ organizationId: OrganizationId; orderId: OrderId; orderLineId: OrderLineId; reason: string } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; eventType: "order_line_direct_production" | "order_line_production_not_required"; resourceId: string; changes: unknown } & Actor>): Promise<void>;
}
export interface WorkflowTransitionTransactionRunner { transaction<T>(action: (transaction: WorkflowTransitionTransaction) => Promise<T>): Promise<T>; }
const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** Named, auditable Order-line exceptions. It does not rewrite immutable
 * Product/pricing snapshots or fabricate Prepress/Production completion. */
export class OrderWorkflowApplicationService {
  constructor(private readonly runner: WorkflowTransitionTransactionRunner, private readonly authority = new AuthorityPolicy(), private readonly lifecycle?: OrderAutomaticLifecycle) {}
  async directProduction(context: OperationContext, command: DirectProductionCommand): Promise<ApplicationResult<WorkflowTransitionResult>> {
    return this.mutate(context, command, "direct_production", async (transaction, policy, decision) => {
      if (decision.confirmationRequired && command.confirmed !== true) throw new V2ApplicationError("CONFLICT", "This workflow policy requires explicit confirmation before bypassing Prepress.");
      await transaction.directProduction({ organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: command.orderId, orderLineId: command.orderLineId, destination: command.destination, reason: "Authorized direct Production transition.", ...actor(context) });
      return { orderId: command.orderId, orderLineId: command.orderLineId, action: "direct_production" as const, policy, confirmationRequired: decision.confirmationRequired, destination: command.destination };
    });
  }
  async productionNotRequired(context: OperationContext, command: ProductionNotRequiredCommand): Promise<ApplicationResult<WorkflowTransitionResult>> {
    return this.mutate(context, command, "production_not_required", async (transaction, policy, decision) => {
      if (!command.reason.trim()) throw new V2ApplicationError("VALIDATION_ERROR", "A reason is required when Production is not required.");
      if (decision.confirmationRequired && command.confirmed !== true) throw new V2ApplicationError("CONFLICT", "This workflow policy requires explicit confirmation before removing a Production obligation.");
      await transaction.productionNotRequired({ organizationId: brandedId<"OrganizationId">(context.organizationId), orderId: command.orderId, orderLineId: command.orderLineId, reason: command.reason.trim(), ...actor(context) });
      return { orderId: command.orderId, orderLineId: command.orderLineId, action: "production_not_required" as const, policy, confirmationRequired: decision.confirmationRequired };
    });
  }
  async eligibleActions(context: OperationContext, orderId: OrderId): Promise<ApplicationResult<readonly WorkflowActionEligibility[]>> {
    try {
      requireOperationPrincipalScope(context);
      if (!this.authority.decide(context.principal, { capability: "order.view", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "Order access is unavailable.");
      if (!this.authority.decide(context.principal, { capability: "workflow.override", resource: { organizationId: context.organizationId } }).allowed) return success([]);
      return success(await this.runner.transaction(async (transaction) => {
        const policy = await transaction.policy(brandedId<"OrganizationId">(context.organizationId));
        return transaction.eligibleActions(brandedId<"OrganizationId">(context.organizationId), orderId, decideWorkflowBypass({ policy, hasWorkflowOverride: true, action: "direct_production" }).confirmationRequired);
      }));
    } catch (cause) { return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("VALIDATION_ERROR", "Order workflow actions are unavailable.")); }
  }
  private async mutate<T extends DirectProductionCommand | ProductionNotRequiredCommand>(context: OperationContext, command: T, action: WorkflowTransitionResult["action"], work: (transaction: WorkflowTransitionTransaction, policy: OrganizationWorkflowPolicy, decision: ReturnType<typeof decideWorkflowBypass>) => Promise<WorkflowTransitionResult>): Promise<ApplicationResult<WorkflowTransitionResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== command.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!this.authority.decide(context.principal, { capability: "workflow.override", resource: { organizationId: context.organizationId } }).allowed) throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to override an Order workflow.");
      const result = await this.runner.transaction(async (transaction) => {
        const policy = await transaction.policy(brandedId<"OrganizationId">(context.organizationId));
        const decision = decideWorkflowBypass({ policy, action, hasWorkflowOverride: true });
        const operation = `sales.order_line.workflow.${action}.v1`;
        const reserved = await transaction.reserve({ organizationId: context.organizationId, operation, businessRequestId: command.businessRequestId, payloadFingerprint: fingerprint(command), ...actor(context) });
        if (reserved.kind === "replay") return reserved.request.resultJson as WorkflowTransitionResult;
        const value = await work(transaction, policy, decision);
        await transaction.attribute({ organizationId: context.organizationId, requestId: reserved.request.id, operation, resourceId: command.orderLineId, ...actor(context) });
        await transaction.audit({ organizationId: context.organizationId, requestId: reserved.request.id, operation, eventType: action === "direct_production" ? "order_line_direct_production" : "order_line_production_not_required", resourceId: command.orderLineId, changes: value, ...actor(context) });
        await transaction.succeed(context.organizationId, reserved.request.id, value);
        return value;
      });
      await this.lifecycle?.reconcileOrder(brandedId<"OrganizationId">(context.organizationId), result.orderId);
      return success(result);
    } catch (cause) { return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("VALIDATION_ERROR", cause instanceof Error ? cause.message : "Order workflow transition is unavailable.")); }
  }
}
