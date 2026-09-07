import { RouteTemplateProductionDestinationApplicationService, type RouteTemplateProductionDestinationTransaction, type RouteTemplateProductionDestinationTransactionRunner } from "../../src/modules/routing/routeTemplateProductionDestinationAuthoring";

const context = (requestId: string, capabilities = ["route.manageTemplates"]) => ({ organizationId: "org-a", operationId: requestId, businessRequest: { id: requestId, payloadFingerprint: "derived" }, principal: { kind: "staff" as const, userId: "staff-a", organizationId: "org-a", authority: { membershipId: "membership-a", capabilities } } } as any);

class Runner implements RouteTemplateProductionDestinationTransactionRunner {
  saved: any;
  calls: any[] = [];
  async transaction<T>(work: (tx: RouteTemplateProductionDestinationTransaction) => Promise<T>): Promise<T> {
    return work({
      reserve: async (input: any) => this.saved?.request === input.businessRequestId ? { kind: "replay", request: { id: "request-a", resultJson: this.saved.value } } : { kind: "new", request: { id: "request-a", resultJson: null } },
      set: async (input: any) => { this.calls.push(input); return { destination: { routeTemplateId: input.routeTemplateId, routeTemplateStepId: input.routeTemplateStepId, stationKey: input.stationKey }, previousStationKey: "flatbed" }; },
      attribute: async () => undefined,
      audit: async () => undefined,
      succeed: async (_organizationId, _requestId, _resourceId, value) => { this.saved = { request: "set", value }; },
    });
  }
}

describe("Route Template production-destination authoring", () => {
  test("is tenant-scoped, replay-safe, and only permits canonical station identities", async () => {
    const runner = new Runner();
    const service = new RouteTemplateProductionDestinationApplicationService(runner);
    const input = { businessRequestId: "set", routeTemplateId: "template-a", routeTemplateStepId: "production-step-a", stationKey: "roll" as const };
    await expect(service.set(context("set"), input)).resolves.toMatchObject({ ok: true, value: { stationKey: "roll" } });
    await expect(service.set(context("set"), input)).resolves.toMatchObject({ ok: true, value: { stationKey: "roll" } });
    expect(runner.calls).toHaveLength(1);
    await expect(service.set(context("invalid"), { ...input, businessRequestId: "invalid", stationKey: "finishing" as any })).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  test("requires existing Routing template authority", async () => {
    const service = new RouteTemplateProductionDestinationApplicationService(new Runner());
    await expect(service.set(context("denied", ["route.view"]), { businessRequestId: "denied", routeTemplateId: "template-a", routeTemplateStepId: "production-step-a", stationKey: "flatbed" })).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
