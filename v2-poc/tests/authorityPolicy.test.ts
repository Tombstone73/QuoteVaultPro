import { describe, expect, jest, test } from "@jest/globals";
import { AuthorityPolicy, type PortalPrincipal, type StaffPrincipal } from "../src/authorization/authorityPolicy";
import { PostgresPrincipalContext } from "../src/authorization/postgresPrincipalContext";
const policy=new AuthorityPolicy(); const staff:StaffPrincipal={kind:"staff",organizationId:"o",actorId:"u",capabilities:["orders.create","quotes.convert","fulfillment.pickup"]}; const portal:PortalPrincipal={kind:"portal",organizationId:"o",customerId:"c",portalSubjectId:"p",capabilities:["quotes.convert","proof.respond","finance.record"]};
describe("canonical authority policy",()=>{test("keeps portal customer-scoped without staff impersonation",()=>{expect(()=>policy.authorize(portal,"quotes.convert",{organizationId:"o",customerId:"c"})).not.toThrow();expect(()=>policy.authorize(portal,"quotes.convert",{organizationId:"o",customerId:"other"})).toThrow();expect(()=>policy.authorize(portal,"fulfillment.pickup",{organizationId:"o",customerId:"c"})).toThrow();expect(policy.actorId(portal)).toBeNull()});test("AI only narrows delegated staff",()=>{expect(()=>policy.authorize({kind:"ai",staff,command:"orders.create",confirmed:true,fresh:true},"orders.create",{organizationId:"o"})).not.toThrow();expect(()=>policy.authorize({kind:"ai",staff,command:"orders.create",confirmed:false,fresh:true},"orders.create",{organizationId:"o"})).toThrow();expect(()=>policy.authorize({kind:"ai",staff,command:"orders.create",confirmed:true,fresh:true},"quotes.convert",{organizationId:"o"})).toThrow();expect(()=>policy.authorize({kind:"service",organizationId:"o",clientId:"s",capabilities:["orders.create"]},"quotes.convert",{organizationId:"o"})).toThrow()})});

test("principal context refuses to retarget staff or AI across organizations", async () => {
  const context = new PostgresPrincipalContext();
  const client = { query: jest.fn() } as any;
  await expect(context.resolve(client, { ...staff, organizationId: "other" }, "o")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(context.resolve(client, { kind: "ai", staff: { ...staff, organizationId: "other" }, command: "orders.create", confirmed: true, fresh: true }, "o")).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(client.query).not.toHaveBeenCalled();
});
