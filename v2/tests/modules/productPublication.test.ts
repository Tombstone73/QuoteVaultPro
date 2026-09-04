import { describe, expect, test } from "@jest/globals";
import { ProductPublicationApplicationService, type CanonicalProductPublisher, type ProductPublicationTransaction, type ProductPublicationTransactionRunner } from "../../src/modules/products/productPublication";
import type { OperationContext } from "../../src/application/operation";
import type { StaffPrincipal } from "../../src/authorization/principals";

const principal: StaffPrincipal = { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "membership-a", capabilities: ["pricing.publish"] } };
const context = (id: string): OperationContext => ({ principal, organizationId: "org-a", operationId: id, businessRequest: { id, payloadFingerprint: id } });

class MemoryRunner implements ProductPublicationTransactionRunner {
  readonly requests = new Map<string, any>();
  readonly audits: string[] = [];
  readonly normalizations: string[] = [];
  async transaction<T>(action: (transaction: ProductPublicationTransaction) => Promise<T>): Promise<T> {
    const requests = this.requests;
    return action({
      readDraftPublicationState: async () => ({ productUpdatedAt: "2026-08-18T00:00:00.000Z", draftUpdatedAt: "2026-08-18T00:00:00.000Z", lifecycle: "draft" as const, workflowIntent:"standard_production" as const, requiresProductionJob:true, hasProductionUnitRules:true, routing:{kind:"route_required" as const,routeTemplateId:"route-a",routeTemplateName:"Standard",sourceTemplateRevision:"1",sourceTemplateFingerprint:"sha256:route",steps:[{position:0,kind:"production" as const}]}}),
      normalizeLegacyDraftScaffold: async (input) => { this.normalizations.push(input.draftVersionId); },
      reserve: async (input) => {
        const current = requests.get(input.businessRequestId);
        if (current && current.fingerprint !== input.payloadFingerprint) throw Object.assign(new Error("conflict"), { code: "IDEMPOTENCY_CONFLICT" });
        if (current) return { kind: "replay" as const, request: current };
        const request = { id: `request:${input.businessRequestId}`, resultJson: null, fingerprint: input.payloadFingerprint };
        requests.set(input.businessRequestId, request);
        return { kind: "new" as const, request };
      },
      succeed: async (_org, id, result) => { for (const request of requests.values()) if (request.id === id) request.resultJson = result; },
      markRetryableFailure: async () => undefined,
      attribute: async () => undefined,
      audit: async (input) => { this.audits.push(input.resourceId); },
    });
  }
}

const publisher = (calls: unknown[]): CanonicalProductPublisher => ({
  propose: async () => ({ productId: "product-a", productName: "Rigid Sign", treeVersionId: "draft-a", expectedProductUpdatedAt: "2026-08-18T01:00:01.000Z", expectedTreeUpdatedAt: "2026-08-18T01:00:01.000Z", alreadyPublished: false, operationReference: "products.publish_configuration.v1" as const }),
  execute: async (input) => { calls.push(input); return { product: { id: "product-a", name: "Rigid Sign", updatedAt: "2026-08-18T01:00:01.000Z" }, tree: { id: "draft-a", updatedAt: "2026-08-18T01:00:01.000Z", publishedAt: "2026-08-18T01:00:01.000Z" }, appliedChanges: [{}], operationReference: "products.publish_configuration.v1" as const }; },
});
const command = (id = "publish-a") => ({ productId: "product-a", draftVersionId: "draft-a", expectedProductUpdatedAt: "2026-08-18T00:00:00.000Z", expectedDraftUpdatedAt: "2026-08-18T00:00:00.000Z", businessRequestId: id, activateProduct: true });

describe("V2 Product publication adapter", () => {
  test("calls the canonical publisher once and records a durable replay-safe V2 operation", async () => {
    const calls: unknown[] = [], runner = new MemoryRunner(), service = new ProductPublicationApplicationService(runner, publisher(calls));
    const first = await service.publish(context("publish-a"), command());
    const replay = await service.publish(context("publish-a"), command());
    expect(first).toMatchObject({ ok: true, value: { productVersionId: "draft-a", alreadyPublished: false } });
    expect(replay).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(runner.audits).toEqual(["draft-a"]);
    expect(runner.normalizations).toEqual(["draft-a"]);
  });

  test("enforces the dedicated publish capability and rejects a reused request with changed content", async () => {
    const calls: unknown[] = [], runner = new MemoryRunner(), service = new ProductPublicationApplicationService(runner, publisher(calls));
    const denied = await service.publish({ ...context("denied"), principal: { ...principal, authority: { ...principal.authority, capabilities: ["product.edit"] } } }, command("denied"));
    expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await service.publish(context("publish-b"), command("publish-b"))).ok).toBe(true);
    const conflict = await service.publish(context("publish-b"), { ...command("publish-b"), activateProduct: false });
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  });

  test("checks the V2 Draft revision before translating it to the canonical publisher revision", async () => {
    const runner = new MemoryRunner();
    const service = new ProductPublicationApplicationService(runner, publisher([]));
    const stale = await service.publish(context("stale"), { ...command("stale"), expectedDraftUpdatedAt: "2026-08-18T00:01:00.000Z" });
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
  });
  test("blocks physical standard-production Draft publication when neither an exact route nor compatibility fallback is valid", async () => {
    const runner = new MemoryRunner();
    const original = runner.transaction.bind(runner);
    runner.transaction = async (action) => original(async (tx) => action({ ...tx, readDraftPublicationState: async () => ({ productUpdatedAt: "2026-08-18T00:00:00.000Z", draftUpdatedAt: "2026-08-18T00:00:00.000Z", lifecycle:"draft" as const, workflowIntent:"standard_production" as const, requiresProductionJob:true, hasProductionUnitRules:true, routing:{kind:"unconfigured" as const} }) }));
    const result = await new ProductPublicationApplicationService(runner, publisher([])).publish(context("routing-required"),command("routing-required"));
    expect(result).toMatchObject({ok:false,error:{code:"VALIDATION_ERROR"}});
  });
  test("blocks production-required Draft publication when the selected route has no production step", async () => {
    const calls: unknown[] = [], runner = new MemoryRunner();
    const original = runner.transaction.bind(runner);
    runner.transaction = async (action) => original(async (tx) => action({ ...tx, readDraftPublicationState: async () => ({ productUpdatedAt: "2026-08-18T00:00:00.000Z", draftUpdatedAt: "2026-08-18T00:00:00.000Z", lifecycle:"draft" as const, workflowIntent:"standard_production" as const, requiresProductionJob:true, hasProductionUnitRules:true, routing:{kind:"route_required" as const,routeTemplateId:"route-a",routeTemplateName:"Incomplete",sourceTemplateRevision:"1",sourceTemplateFingerprint:"sha256:route",steps:[{position:0,kind:"proofing" as const},{position:1,kind:"fulfillment" as const}]}}) }));
    const result = await new ProductPublicationApplicationService(runner, publisher(calls)).publish(context("production-step-required"),command("production-step-required"));
    expect(result).toMatchObject({ok:false,error:{code:"VALIDATION_ERROR"}});
    expect(calls).toHaveLength(0);
  });
  test("blocks production-required Draft publication with no frozen production-unit rules", async () => {
    const calls: unknown[] = [], runner = new MemoryRunner();
    const original = runner.transaction.bind(runner);
    runner.transaction = async (action) => original(async (tx) => action({ ...tx, readDraftPublicationState: async () => ({ productUpdatedAt: "2026-08-18T00:00:00.000Z", draftUpdatedAt: "2026-08-18T00:00:00.000Z", lifecycle:"draft" as const, workflowIntent:"standard_production" as const, requiresProductionJob:true, hasProductionUnitRules:false, routing:{kind:"route_required" as const,routeTemplateId:"route-a",routeTemplateName:"Standard",sourceTemplateRevision:"1",sourceTemplateFingerprint:"sha256:route",steps:[{position:0,kind:"production" as const}]}}) }));
    const result = await new ProductPublicationApplicationService(runner, publisher(calls)).publish(context("production-units-required"),command("production-units-required"));
    expect(result).toMatchObject({ok:false,error:{code:"VALIDATION_ERROR"}});
    expect(calls).toHaveLength(0);
  });
});
