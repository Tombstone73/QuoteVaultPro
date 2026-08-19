import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";
import { compareMaterialUsage, ProductionMaterialConsumptionApplicationService, type ProductionMaterialConsumption, type ProductionMaterialConsumptionTransaction, type ProductionMaterialConsumptionTransactionRunner } from "../../src/modules/production/materialConsumption";
import { brandedId } from "../../src/modules/shared/commercialValues";

const context = (requestId: string, capabilities: readonly string[] = ["production.work", "production.view"]): OperationContext => ({ organizationId: "org-a", operationId: requestId, businessRequest: { id: requestId, payloadFingerprint: requestId }, principal: { kind: "staff", organizationId: "org-a", userId: "operator-a", authority: { membershipId: "membership-a", capabilities: capabilities as any } } });
const base = (id: string, kind: ProductionMaterialConsumption["kind"] = "consumed", quantity = "80", correctsConsumptionId?: string): ProductionMaterialConsumption => ({ consumptionId: brandedId<"ProductionMaterialConsumptionId">(id), organizationId: brandedId<"OrganizationId">("org-a"), orderId: brandedId<"OrderId">("order-a"), orderLineId: brandedId<"OrderLineId">("line-a"), productionWorkId: brandedId<"ProductionWorkId">("work-a"), productionAttemptId: brandedId<"ProductionAttemptId">("attempt-a"), materialId: "material-a", materialName: "Grommets", materialSku: "GROM", requirementId: brandedId<"OrderLineMaterialRequirementId">("requirement-a"), quantity, unit: "each", kind, ...(correctsConsumptionId ? { correctsConsumptionId: brandedId<"ProductionMaterialConsumptionId">(correctsConsumptionId) } : {}), createdAt: "2026-08-18T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "operator-a" });

class Transaction implements ProductionMaterialConsumptionTransaction {
  private readonly requests = new Map<string, ProductionMaterialConsumption>();
  facts: ProductionMaterialConsumption[] = [];
  async reserve(input: Parameters<ProductionMaterialConsumptionTransaction["reserve"]>[0]) { const prior = this.requests.get(input.businessRequestId); return prior ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: prior } } : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } }; }
  async succeed(_org: string, requestId: string, result: ProductionMaterialConsumption) { this.requests.set(requestId, result); }
  async attribute() {} async audit() {}
  async record(input: Parameters<ProductionMaterialConsumptionTransaction["record"]>[0]) {
    if (input.organizationId !== "org-a" || input.productionWorkId !== "work-a" || input.productionAttemptId !== "attempt-a") throw new V2ApplicationError("NOT_FOUND", "Production work was not found.");
    if (input.materialId !== "material-a" || (input.requirementId && input.requirementId !== "requirement-a")) throw new V2ApplicationError("CONFLICT", "Material requirement does not match.");
    if (input.kind === "correction" && input.correctsConsumptionId !== "fact-a") throw new V2ApplicationError("CONFLICT", "Correction must match an original fact.");
    const saved = base(input.id, input.kind, input.quantity, input.correctsConsumptionId);
    this.facts.push(saved); return saved;
  }
  async readProjection() { return null; }
}
class Runner implements ProductionMaterialConsumptionTransactionRunner { readonly state = new Transaction(); async transaction<T>(action: (tx: ProductionMaterialConsumptionTransaction) => Promise<T>) { return action(this.state); } }

describe("P7C immutable Production material consumption", () => {
  test("derives expected, actual, waste, correction, and variance from immutable facts", () => {
    const facts = [base("fact-a", "consumed", "80"), base("fact-b", "consumed", "120"), base("fact-waste", "waste", "10"), base("fact-correction", "correction", "10", "fact-waste")];
    const projection = compareMaterialUsage([{ requirementId: brandedId<"OrderLineMaterialRequirementId">("requirement-a"), materialId: "material-a", materialName: "Grommets", materialSku: "GROM", quantity: "200", unit: "each" }], facts);
    expect(projection).toEqual([expect.objectContaining({ expectedQuantity: "200", consumedQuantity: "200", wasteQuantity: "0", correctionQuantity: "10", totalPhysicalUsageQuantity: "200", varianceQuantity: "0" })]);
  });

  test("records partial usage once, replays exactly, and rejects invalid/cross-tenant input", async () => {
    const runner = new Runner(), service = new ProductionMaterialConsumptionApplicationService(runner);
    const input = { businessRequestId: "consume-a", productionWorkId: brandedId<"ProductionWorkId">("work-a"), productionAttemptId: brandedId<"ProductionAttemptId">("attempt-a"), materialId: "material-a", requirementId: brandedId<"OrderLineMaterialRequirementId">("requirement-a"), quantity: "80", unit: "each" as const, kind: "consumed" as const };
    const first = await service.record(context("consume-a"), input), replay = await service.record(context("consume-a"), input);
    const zero = await service.record(context("consume-zero"), { ...input, businessRequestId: "consume-zero", quantity: "0" });
    const unit = await service.record(context("consume-unit"), { ...input, businessRequestId: "consume-unit", unit: "grommet" as any });
    const mismatch = await service.record(context("consume-mismatch"), { ...input, businessRequestId: "consume-mismatch", requirementId: brandedId<"OrderLineMaterialRequirementId">("other-requirement") });
    const foreign = await service.record({ ...context("consume-foreign"), organizationId: "org-b" }, { ...input, businessRequestId: "consume-foreign" });
    const denied = await service.record(context("consume-denied", []), { ...input, businessRequestId: "consume-denied" });
    expect(first).toMatchObject({ ok: true, value: { quantity: "80", kind: "consumed" } });
    expect(replay).toEqual(first);
    expect(runner.state.facts).toHaveLength(1);
    expect(zero).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(unit).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(mismatch).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(foreign).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  test("requires an additive correction reference and does not permit an implicit negative quantity", async () => {
    const service = new ProductionMaterialConsumptionApplicationService(new Runner());
    const invalid = await service.record(context("correction-invalid"), { businessRequestId: "correction-invalid", productionWorkId: brandedId<"ProductionWorkId">("work-a"), productionAttemptId: brandedId<"ProductionAttemptId">("attempt-a"), materialId: "material-a", quantity: "10", unit: "each", kind: "correction" });
    const negative = await service.record(context("negative"), { businessRequestId: "negative", productionWorkId: brandedId<"ProductionWorkId">("work-a"), productionAttemptId: brandedId<"ProductionAttemptId">("attempt-a"), materialId: "material-a", quantity: "-1", unit: "each", kind: "consumed" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(negative).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
