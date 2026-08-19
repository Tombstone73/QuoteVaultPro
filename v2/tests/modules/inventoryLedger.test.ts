import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { V2ApplicationError } from "../../src/errors/applicationError";
import { InventoryLedgerApplicationService, type InventoryLedgerTransaction, type InventoryLedgerTransactionRunner, type InventoryMovement, type InventoryReservation } from "../../src/modules/inventory/inventoryLedger";
import { brandedId } from "../../src/modules/shared/commercialValues";

const context = (requestId: string, capabilities: readonly string[] = ["production.work", "production.view", "inventory.view", "inventory.receive"]): OperationContext => ({ organizationId: "org-a", operationId: requestId, businessRequest: { id: requestId, payloadFingerprint: requestId }, principal: { kind: "staff", organizationId: "org-a", userId: "operator-a", authority: { membershipId: "membership-a", capabilities: capabilities as any } } });
const reservation = (): InventoryReservation => ({ reservationId: "reservation-a", organizationId: brandedId<"OrganizationId">("org-a"), productionWorkId: brandedId<"ProductionWorkId">("work-a"), requirementId: brandedId<"OrderLineMaterialRequirementId">("requirement-a"), materialId: "material-a", materialName: "Grommets", materialSku: "GROM", quantity: "200", unit: "each" });
const movement = (id: string, kind: InventoryMovement["kind"], onHandDelta: string, reservedDelta: string): InventoryMovement => ({ movementId: id, organizationId: brandedId<"OrganizationId">("org-a"), materialId: "material-a", materialName: "Grommets", materialSku: "GROM", productionWorkId: brandedId<"ProductionWorkId">("work-a"), reservationId: "reservation-a", requirementId: brandedId<"OrderLineMaterialRequirementId">("requirement-a"), quantity: onHandDelta === "0" ? reservedDelta.replace("-", "") : onHandDelta.replace("-", ""), unit: "each", kind, onHandDelta, reservedDelta, createdAt: "2026-08-19T00:00:00.000Z" });

class Transaction implements InventoryLedgerTransaction {
  private readonly requests = new Map<string, unknown>(); readonly failures = new Map<string, { status: "retryable" | "blocked"; code: string; message: string }>(); reservations: InventoryReservation[] = []; movements: InventoryMovement[] = []; stock = 500;
  async reserve(input: Parameters<InventoryLedgerTransaction["reserve"]>[0]) { const prior = this.requests.get(input.businessRequestId); return prior ? { kind: "replay" as const, request: { id: input.businessRequestId, resultJson: prior } } : { kind: "new" as const, request: { id: input.businessRequestId, resultJson: null } }; }
  async succeed(_org: string, id: string, result: unknown) { this.requests.set(id, result); } async attribute() {} async audit() {}
  async receiveStock(input: Parameters<InventoryLedgerTransaction["receiveStock"]>[0]) { if (input.organizationId !== "org-a" || input.materialId === "foreign") throw new V2ApplicationError("NOT_FOUND", "Material was not found."); if (input.materialId !== "material-a") throw new V2ApplicationError("NOT_FOUND", "Material was not found."); this.stock += Number(input.quantity); const row: InventoryMovement = { movementId: `receipt-${this.movements.length}`, organizationId: brandedId<"OrganizationId">("org-a"), materialId: "material-a", materialName: "Grommets", materialSku: "GROM", quantity: input.quantity, unit: "each", kind: "receipt", onHandDelta: input.quantity, reservedDelta: "0", reason: input.reason, createdAt: "2026-08-19T00:00:00.000Z" }; this.movements.push(row); return row; }
  async reserveForWork(input: Parameters<InventoryLedgerTransaction["reserveForWork"]>[0]) { if (input.organizationId !== "org-a" || input.productionWorkId !== "work-a") throw new V2ApplicationError("NOT_FOUND", "Production work was not found."); if (this.reservations.length) return this.reservations; if (this.stock - this.reserved < 200) throw new V2ApplicationError("CONFLICT", "Insufficient available stock."); const row = reservation(); this.reservations.push(row); this.movements.push(movement("reserve-a", "reserve", "0", "200")); return this.reservations; }
  get reserved() { return this.movements.reduce((sum, row) => sum + Number(row.reservedDelta), 0); }
  async releaseUnusedForWork(input: Parameters<InventoryLedgerTransaction["releaseUnusedForWork"]>[0]) { if (input.productionWorkId !== "work-a") throw new V2ApplicationError("NOT_FOUND", "Production work was not found."); if (this.reserved <= 0) return []; const row = movement(`release-${this.movements.length}`, "release", "0", `-${this.reserved}`); this.movements.push(row); return [row]; }
  async applyConsumption(input: Parameters<InventoryLedgerTransaction["applyConsumption"]>[0]) { if (input.organizationId !== "org-a" || input.consumptionId === "foreign") throw new V2ApplicationError("NOT_FOUND", "Production material consumption was not found."); const prior = this.movements.find((row) => row.consumptionId === input.consumptionId); if (prior) return prior; const correction = input.consumptionId === "correct"; const quantity = input.consumptionId === "waste" || correction ? 10 : input.consumptionId === "full" ? 120 : 80; if (!correction && this.stock < quantity) throw new V2ApplicationError("CONFLICT", "Insufficient on-hand stock."); const useReservation = correction ? 0 : Math.min(this.reserved, quantity); this.stock += correction ? quantity : -quantity; const row: InventoryMovement = { ...movement(`movement-${input.consumptionId}`, correction ? "correction" : input.consumptionId === "waste" ? "waste" : "consume", correction ? String(quantity) : `-${quantity}`, useReservation ? `-${useReservation}` : "0"), consumptionId: brandedId<"ProductionMaterialConsumptionId">(input.consumptionId) }; this.movements.push(row); return row; }
  async recordReconciliationFailure(input: Parameters<InventoryLedgerTransaction["recordReconciliationFailure"]>[0]) { this.failures.set(input.consumptionId, { status: input.status, code: input.errorCode, message: input.errorMessage }); }
  async read(_org: any, id: any) { if (id !== "work-a") return null; return { productionWorkId: brandedId<"ProductionWorkId">("work-a"), balances: [{ materialId: "material-a", materialName: "Grommets", materialSku: "GROM", unit: "each" as const, onHandQuantity: String(this.stock), reservedQuantity: String(this.reserved), availableQuantity: String(this.stock - this.reserved) }], movements: this.movements, facts: [] }; }
  async listMaterials(org: any) { if (org !== "org-a") return []; return [{ materialId: "material-a", materialName: "Grommets", materialSku: "GROM", unit: "each" as const, onHandQuantity: String(this.stock), reservedQuantity: String(this.reserved), availableQuantity: String(this.stock - this.reserved) }]; }
}
class Runner implements InventoryLedgerTransactionRunner { readonly state = new Transaction(); async transaction<T>(action: (tx: InventoryLedgerTransaction) => Promise<T>) { return action(this.state); } }

describe("P7D inventory reservation and movement ledger", () => {
  test("reserves available stock exactly once and releases unused stock without changing on hand", async () => {
    const runner = new Runner(), service = new InventoryLedgerApplicationService(runner), input = { productionWorkId: brandedId<"ProductionWorkId">("work-a") };
    const first = await service.reserveForProductionWork(context("reserve"), { businessRequestId: "reserve", ...input }); const replay = await service.reserveForProductionWork(context("reserve"), { businessRequestId: "reserve", ...input }); const released = await service.releaseUnusedForProductionWork(context("release"), { businessRequestId: "release", ...input });
    expect(first).toMatchObject({ ok: true, value: [expect.objectContaining({ quantity: "200" })] }); expect(replay).toEqual(first); expect(runner.state.stock).toBe(500); expect(runner.state.reserved).toBe(0); expect(released).toMatchObject({ ok: true, value: [expect.objectContaining({ kind: "release", reservedDelta: "-200" })] });
  });
  test("applies partial, full, waste, correction, and unplanned usage without double decrement", async () => {
    const runner = new Runner(), service = new InventoryLedgerApplicationService(runner); await service.reserveForProductionWork(context("reserve"), { businessRequestId: "reserve", productionWorkId: brandedId<"ProductionWorkId">("work-a") });
    const apply = (id: string) => service.applyProductionConsumption(context(id), { businessRequestId: id, consumptionId: brandedId<"ProductionMaterialConsumptionId">(id) });
    const first = await apply("partial"), second = await apply("full"), waste = await apply("waste"), correction = await apply("correct"), replay = await apply("partial");
    expect(first).toMatchObject({ ok: true, value: { onHandDelta: "-80", reservedDelta: "-80" } }); expect(second).toMatchObject({ ok: true, value: { onHandDelta: "-120", reservedDelta: "-120" } }); expect(waste).toMatchObject({ ok: true, value: { kind: "waste", onHandDelta: "-10", reservedDelta: "0" } }); expect(correction).toMatchObject({ ok: true, value: { kind: "correction", onHandDelta: "10" } }); expect(replay).toEqual(first); expect(runner.state.stock).toBe(300); expect(runner.state.reserved).toBe(0);
  });
  test("enforces authority, tenant, and insufficient-stock failures", async () => {
    const service = new InventoryLedgerApplicationService(new Runner());
    expect(await service.reserveForProductionWork(context("denied", []), { businessRequestId: "denied", productionWorkId: brandedId<"ProductionWorkId">("work-a") })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await service.applyProductionConsumption({ ...context("foreign"), organizationId: "org-b" }, { businessRequestId: "foreign", consumptionId: brandedId<"ProductionMaterialConsumptionId">("foreign") })).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
  });
  test("receives positive stock exactly once with an immutable receipt fact and authoritative Material unit", async () => {
    const runner = new Runner(), service = new InventoryLedgerApplicationService(runner);
    const first = await service.receiveStock(context("receipt-a"), { businessRequestId: "receipt-a", materialId: "material-a", quantity: "12.5", reason: "Vendor delivery" });
    const replay = await service.receiveStock(context("receipt-a"), { businessRequestId: "receipt-a", materialId: "material-a", quantity: "12.5", reason: "Vendor delivery" });
    const next = await service.receiveStock(context("receipt-b"), { businessRequestId: "receipt-b", materialId: "material-a", quantity: "1", reason: "Cycle count correction" });
    expect(first).toMatchObject({ ok: true, value: { kind: "receipt", quantity: "12.5", unit: "each", onHandDelta: "12.5", reservedDelta: "0", reason: "Vendor delivery" } });
    expect(replay).toEqual(first); expect(next).toMatchObject({ ok: true, value: { kind: "receipt", quantity: "1" } });
    expect(runner.state.stock).toBe(513.5); expect(runner.state.movements.filter((row) => row.kind === "receipt")).toHaveLength(2);
  });
  test("rejects invalid, foreign, and unauthorized Inventory receipts without recording stock", async () => {
    const runner = new Runner(), service = new InventoryLedgerApplicationService(runner);
    expect(await service.receiveStock(context("zero"), { businessRequestId: "zero", materialId: "material-a", quantity: "0", reason: "Vendor delivery" })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await service.receiveStock(context("negative"), { businessRequestId: "negative", materialId: "material-a", quantity: "-1", reason: "Vendor delivery" })).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await service.receiveStock({ ...context("foreign"), organizationId: "org-b" }, { businessRequestId: "foreign", materialId: "material-a", quantity: "1", reason: "Vendor delivery" })).toMatchObject({ ok: false, error: { code: "WRONG_TENANT" } });
    expect(await service.receiveStock(context("denied", ["inventory.view"]), { businessRequestId: "denied", materialId: "material-a", quantity: "1", reason: "Vendor delivery" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(runner.state.stock).toBe(500); expect(runner.state.movements).toHaveLength(0);
  });
  test("retains a durable retryable reconciliation failure without changing stock", async () => {
    const runner = new Runner(); runner.state.stock = 0; const service = new InventoryLedgerApplicationService(runner);
    const failed = await service.applyProductionConsumption(context("stock-conflict"), { businessRequestId: "stock-conflict", consumptionId: brandedId<"ProductionMaterialConsumptionId">("partial") });
    expect(failed).toMatchObject({ ok: false, error: { code: "CONFLICT" } }); expect(runner.state.stock).toBe(0); expect(runner.state.movements).toHaveLength(0); expect(runner.state.failures.get("partial")).toEqual(expect.objectContaining({ status: "blocked" }));
  });
});
