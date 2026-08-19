import type { Request, Response, Router } from "express";
import { Router as expressRouter } from "express";
import type { OperationContext } from "../../application/operation.js";
import type { Principal } from "../../authorization/principals.js";
import { type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { InventoryLedgerApplicationService } from "../../modules/inventory/inventoryLedger.js";

export interface VerifiedV2InventoryPrincipalProvider { principal(request: Request, organizationId: string): Promise<Principal>; }
export type InventoryHttpDependencies = Readonly<{ inventory: InventoryLedgerApplicationService; principals: VerifiedV2InventoryPrincipalProvider }>;
const status = (code: string) => code === "VALIDATION_ERROR" ? 400 : code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" || code === "WRONG_TENANT" ? 404 : code === "CONFLICT" || code === "STALE_STATE" || code === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
const body = (value: unknown): Readonly<Record<string, unknown>> => { if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "An Inventory command object is required."); return value as Readonly<Record<string, unknown>>; };
const context = async (request: Request, dependencies: InventoryHttpDependencies, mutation = false): Promise<OperationContext> => {
  const organizationId = request.params.organizationId;
  if (!organizationId) throw new V2ApplicationError("VALIDATION_ERROR", "organizationId is required.");
  const command = mutation ? body(request.body) : undefined;
  const requestId = command?.businessRequestId;
  if (mutation && (typeof requestId !== "string" || !requestId.trim())) throw new V2ApplicationError("VALIDATION_ERROR", "businessRequestId is required.");
  return { principal: await dependencies.principals.principal(request, organizationId), organizationId, operationId: `http:${request.method}:${request.path}`, ...(mutation ? { businessRequest: { id: requestId as string, payloadFingerprint: "inventory-fingerprint-is-derived-by-operation" } } : {}) };
};
const send = (response: Response, result: ApplicationResult<unknown>) => result.ok ? response.status(200).json({ ok: true, data: result.value }) : response.status(status(result.error.code)).json({ ok: false, error: { code: result.error.code, message: result.error.publicMessage } });
const run = async (response: Response, operation: () => Promise<ApplicationResult<unknown>>) => { try { send(response, await operation()); } catch (cause) { const error = cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Inventory operation is unavailable."); response.status(status(error.code)).json({ ok: false, error: { code: error.code, message: error.publicMessage } }); } };

export const createInventoryRouter = (dependencies: InventoryHttpDependencies): Router => {
  const router = expressRouter({ mergeParams: true });
  router.get("/materials", (request, response) => void run(response, async () => dependencies.inventory.listMaterials(await context(request, dependencies))));
  router.post("/materials/:materialId/receipts", (request, response) => void run(response, async () => {
    const command = body(request.body);
    if (typeof command.quantity !== "string" || typeof command.reason !== "string") throw new V2ApplicationError("VALIDATION_ERROR", "Inventory receipt quantity and reason are required.");
    return dependencies.inventory.receiveStock(await context(request, dependencies, true), { businessRequestId: String(command.businessRequestId), materialId: request.params.materialId, quantity: command.quantity, reason: command.reason });
  }));
  return router;
};
