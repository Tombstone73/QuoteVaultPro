import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import { AiOperatorAdapter, FutureApiAdapter, InboundAdapter, PortalAdapter, StaffAdapter } from "../src/interfaces/convergence";

const staff = { kind: "staff" as const, actorId: "staff-a", organizationId: "org", capabilities: ["orders.create", "quotes.convert", "proof.respond", "fulfillment.pickup", "finance.record"] as const };
const portal = { kind: "portal" as const, organizationId: "org", customerId: "customer", portalSubjectId: "portal-a", capabilities: ["quotes.convert", "proof.respond", "finance.record"] as const };
const api = { kind: "service" as const, organizationId: "org", clientId: "api-a", capabilities: ["orders.create"] as const };

describe("V2 interface convergence", () => {
  test("staff, inbound, AI GO, portal, and API invoke one typed operation port", async () => {
    const calls: any[] = [];
    const port = { execute: async (principal: any, command: any) => { calls.push([principal, command]); return { ok: true }; } };
    const staffAdapter = new StaffAdapter(port), inbound = new InboundAdapter(port), ai = new AiOperatorAdapter(port), future = new FutureApiAdapter(port), portalAdapter = new PortalAdapter(port);
    await staffAdapter.execute(staff, { requestId: "staff" });
    await inbound.approved(staff, { requestId: "inbound" });
    ai.plan("p", staff, { requestId: "ai" }, "orders.create"); await ai.go("p", staff);
    await portalAdapter.execute(portal, { requestId: "portal" });
    await future.execute(api, { requestId: "api" });
    expect(calls).toHaveLength(5);
    expect(calls.map(([principal]) => principal.kind)).toEqual(["staff", "staff", "ai", "portal", "service"]);
    expect(calls[2][0]).toMatchObject({ command: "orders.create", confirmed: true, fresh: true });
    await expect(ai.go("p", staff)).rejects.toThrow("STALE_OR_FORBIDDEN_PLAN");
  });
  test("adapters have no persistence imports, SQL, or V1 business-service dependency", () => {
    const source = fs.readFileSync("v2-poc/src/interfaces/convergence.ts", "utf8");
    expect(source).not.toMatch(/postgres|drizzle|server\/services|\bselect\b|\binsert\b|\bupdate\b|\bdelete\b/i);
  });
});
