import { createHash, randomUUID } from "node:crypto";
import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import { brandedId, canonicalJson, type OrderId, type OrderLineId, type OrderLineMaterialRequirementId, type OrganizationId, type ProductionAttemptId, type ProductionMaterialConsumptionId, type ProductionWorkId } from "../shared/commercialValues.js";
import { recipeUnits, type RecipeUnit } from "../products/productRecipes.js";

export const materialConsumptionKinds = ["consumed", "waste", "correction"] as const;
export type MaterialConsumptionKind = (typeof materialConsumptionKinds)[number];
type Actor = Readonly<{ principalKind: OperationContext["principal"]["kind"]; principalSubject: string; staffActorUserId?: string }>;
type Reservation = Readonly<{ kind: "new" | "resumed" | "replay"; request: Readonly<{ id: string; resultJson: unknown | null }> }>;

export type ProductionMaterialConsumption = Readonly<{
  consumptionId: ProductionMaterialConsumptionId;
  organizationId: OrganizationId;
  orderId: OrderId;
  orderLineId: OrderLineId;
  productionWorkId: ProductionWorkId;
  productionAttemptId: ProductionAttemptId;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  requirementId?: OrderLineMaterialRequirementId;
  quantity: string;
  unit: RecipeUnit;
  kind: MaterialConsumptionKind;
  correctsConsumptionId?: ProductionMaterialConsumptionId;
  createdAt: string;
  createdPrincipalKind: Actor["principalKind"];
  createdPrincipalSubject: string;
  createdStaffActorUserId?: string;
}>;

export type RecordMaterialConsumptionInput = Readonly<{
  businessRequestId: string;
  productionWorkId: ProductionWorkId;
  productionAttemptId: ProductionAttemptId;
  materialId: string;
  requirementId?: OrderLineMaterialRequirementId;
  quantity: string;
  unit: RecipeUnit;
  kind: MaterialConsumptionKind;
  correctsConsumptionId?: ProductionMaterialConsumptionId;
}>;

export type MaterialUsageComparison = Readonly<{
  materialId: string;
  materialName: string;
  materialSku: string | null;
  unit: RecipeUnit;
  requirementId?: OrderLineMaterialRequirementId;
  expectedQuantity: string;
  consumedQuantity: string;
  wasteQuantity: string;
  correctionQuantity: string;
  totalPhysicalUsageQuantity: string;
  varianceQuantity: string;
}>;

export type ProductionMaterialConsumptionProjection = Readonly<{
  productionWorkId: ProductionWorkId;
  orderId: OrderId;
  orderLineId: OrderLineId;
  facts: readonly ProductionMaterialConsumption[];
  comparison: readonly MaterialUsageComparison[];
}>;

export interface ProductionMaterialConsumptionTransaction {
  reserve(input: Readonly<{ organizationId: string; operation: string; businessRequestId: string; payloadFingerprint: string } & Actor>): Promise<Reservation>;
  succeed(organizationId: string, requestId: string, result: ProductionMaterialConsumption): Promise<void>;
  attribute(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: ProductionMaterialConsumptionId } & Actor>): Promise<void>;
  audit(input: Readonly<{ organizationId: string; requestId: string; operation: string; resourceId: ProductionMaterialConsumptionId; summary: string } & Actor>): Promise<void>;
  record(input: Readonly<{ id: ProductionMaterialConsumptionId; organizationId: OrganizationId } & RecordMaterialConsumptionInput & Actor & { operationRequestId: string }>): Promise<ProductionMaterialConsumption>;
  readProjection(organizationId: OrganizationId, productionWorkId: ProductionWorkId): Promise<ProductionMaterialConsumptionProjection | null>;
}
export interface ProductionMaterialConsumptionTransactionRunner { transaction<T>(action: (tx: ProductionMaterialConsumptionTransaction) => Promise<T>): Promise<T>; }

const scale = 1_000_000n;
const parse = (value: string): bigint => {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value)) throw new V2ApplicationError("VALIDATION_ERROR", "Material quantity must be a positive six-decimal value.");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * scale + BigInt((fraction + "000000").slice(0, 6));
  if (result <= 0n) throw new V2ApplicationError("VALIDATION_ERROR", "Material quantity must be greater than zero.");
  return result;
};
const print = (value: bigint): string => {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
};
const keyFor = (value: Pick<ProductionMaterialConsumption, "materialId" | "unit" | "requirementId">) => `${value.requirementId ?? "unplanned"}:${value.materialId}:${value.unit}`;

/** Derived only from immutable facts; it never mutates requirements or stock. */
export const compareMaterialUsage = (
  requirements: readonly Readonly<{ requirementId: OrderLineMaterialRequirementId; materialId: string; materialName: string; materialSku: string | null; quantity: string; unit: RecipeUnit }>[],
  facts: readonly ProductionMaterialConsumption[],
): readonly MaterialUsageComparison[] => {
  const groups = new Map<string, { materialId: string; materialName: string; materialSku: string | null; unit: RecipeUnit; requirementId?: OrderLineMaterialRequirementId; expected: bigint; consumed: bigint; waste: bigint; corrections: bigint }>();
  const originals = new Map(facts.filter((fact) => fact.kind !== "correction").map((fact) => [fact.consumptionId, fact]));
  const ensure = (value: Pick<ProductionMaterialConsumption, "materialId" | "materialName" | "materialSku" | "unit" | "requirementId">, expected = 0n) => {
    const key = keyFor(value);
    const found = groups.get(key);
    if (found) { found.expected += expected; return found; }
    const next = { ...value, expected, consumed: 0n, waste: 0n, corrections: 0n };
    groups.set(key, next);
    return next;
  };
  for (const requirement of requirements) ensure({ ...requirement }, parse(requirement.quantity));
  for (const fact of facts) {
    if (fact.kind === "correction") {
      const original = fact.correctsConsumptionId ? originals.get(fact.correctsConsumptionId) : undefined;
      if (!original) continue;
      const group = ensure(original);
      const quantity = parse(fact.quantity);
      if (original.kind === "consumed") group.consumed -= quantity;
      else group.waste -= quantity;
      group.corrections += quantity;
      continue;
    }
    const group = ensure(fact);
    if (fact.kind === "consumed") group.consumed += parse(fact.quantity);
    else group.waste += parse(fact.quantity);
  }
  return [...groups.values()].map((group) => {
    const total = group.consumed + group.waste;
    return Object.freeze({ ...group, expectedQuantity: print(group.expected), consumedQuantity: print(group.consumed), wasteQuantity: print(group.waste), correctionQuantity: print(group.corrections), totalPhysicalUsageQuantity: print(total), varianceQuantity: print(total - group.expected) });
  });
};

const actor = (context: OperationContext): Actor => ({ principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
const fingerprint = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

export class ProductionMaterialConsumptionApplicationService {
  constructor(private readonly runner: ProductionMaterialConsumptionTransactionRunner, private readonly authority = new AuthorityPolicy()) {}
  async record(context: OperationContext, input: RecordMaterialConsumptionInput): Promise<ApplicationResult<ProductionMaterialConsumption>> {
    try {
      requireOperationPrincipalScope(context);
      if (context.businessRequest?.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A matching business request identity is required.");
      if (!this.authority.decide(context.principal, { capability: "production.work", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to record Production material usage.");
      parse(input.quantity);
      if (!recipeUnits.includes(input.unit) || !materialConsumptionKinds.includes(input.kind)) throw new V2ApplicationError("VALIDATION_ERROR", "Material consumption unit or kind is invalid.");
      if ((input.kind === "correction") !== Boolean(input.correctsConsumptionId)) throw new V2ApplicationError("VALIDATION_ERROR", "Corrections must reference exactly one original material fact.");
      const operation = "production.material-consumption.record.v1";
      const result = await this.runner.transaction(async (tx) => {
        const reservation = await tx.reserve({ organizationId: context.organizationId, operation, businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint(input), ...actor(context) });
        if (reservation.kind === "replay") return reservation.request.resultJson as ProductionMaterialConsumption;
        const fact = await tx.record({ id: brandedId<"ProductionMaterialConsumptionId">(randomUUID()), organizationId: brandedId<"OrganizationId">(context.organizationId), operationRequestId: reservation.request.id, ...input, ...actor(context) });
        await tx.attribute({ organizationId: context.organizationId, requestId: reservation.request.id, operation, resourceId: fact.consumptionId, ...actor(context) });
        await tx.audit({ organizationId: context.organizationId, requestId: reservation.request.id, operation, resourceId: fact.consumptionId, summary: `${fact.kind} ${fact.quantity} ${fact.unit} of ${fact.materialName}.`, ...actor(context) });
        await tx.succeed(context.organizationId, reservation.request.id, fact);
        return fact;
      });
      return success(result);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Material consumption could not be recorded.")); }
  }
  async read(context: OperationContext, productionWorkId: ProductionWorkId): Promise<ApplicationResult<ProductionMaterialConsumptionProjection>> {
    try {
      requireOperationPrincipalScope(context);
      if (!this.authority.decide(context.principal, { capability: "production.view", resource: { organizationId: context.organizationId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal does not have authority to view Production material usage.");
      const projection = await this.runner.transaction((tx) => tx.readProjection(brandedId<"OrganizationId">(context.organizationId), productionWorkId));
      if (!projection) throw new V2ApplicationError("NOT_FOUND", "Production work was not found.");
      return success(projection);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("CONFLICT", "Material consumption could not be read.")); }
  }
}
