import assert from "node:assert/strict";
import { customerAdministrationAiCommandHandlers } from "../infrastructure/ai/customerAdministrationAiCommands.js";

const customer: any = { customerId: "customer-a", displayName: "Acme", revision: "4", editable: { companyName: "Acme", displayName: "Acme", email: "billing@acme.test", phone: "555" }, contacts: [{ contactId: "contact-a", displayName: "Ada Lovelace", email: "ada@acme.test", primary: true, status: "active", revision: "2" }], contactReadiness: { status: "ready", reasons: [] } };
const contact: any = { contactId: "contact-a", displayName: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", customerId: "customer-a", customerName: "Acme", primary: true, status: "active", revision: "2", customerRevision: "4", relatedContacts: [], customerPresentation: {} };
const calls: Array<{ kind: string; input: unknown }> = [];
const commands = customerAdministrationAiCommandHandlers({
  customers: { read: async (_organizationId, customerId) => customerId === "customer-a" ? customer : null },
  contacts: { read: async (_organizationId, contactId) => contactId === "contact-a" ? contact : null },
  administration: {
    updateCustomer: async (_org, _principal, _id, input) => { calls.push({ kind: "customer", input }); },
    createContact: async (_org, _principal, input) => { calls.push({ kind: "contact-add", input }); return "contact-b"; },
    updateContact: async (_org, _principal, _id, input) => { calls.push({ kind: "contact-update", input }); },
    setPrimaryContact: async (_org, _principal, input) => { calls.push({ kind: "primary", input }); },
  },
});
const handler = (name: string) => { const item = commands.find((candidate) => candidate.name === name); assert.ok(item, `${name} registered`); return item; };
const context: any = { organizationId: "org-a", user: { kind: "staff", organizationId: "org-a", userId: "staff-a", authority: { membershipId: "m", capabilities: ["assistant.use", "customer.edit"] } }, conversationId: "conversation-a", requestId: "request-a" };
const execution: any = { organizationId: "org-a", userId: "staff-a", conversationId: "conversation-a", businessRequestId: "ai-request-a", delegatedPrincipal: { kind: "delegated_ai", organizationId: "org-a", staff: context.user, delegation: {} } };

const customerPlan = await handler("customer.update").prepare(context, { customerId: "customer-a", patch: { companyName: "Acme Signs" } });
await handler("customer.update").execute(execution, customerPlan.normalizedInput);
assert.deepEqual(calls[0], { kind: "customer", input: { companyName: "Acme Signs", displayName: "Acme", email: "billing@acme.test", phone: "555", expectedRevision: "4", businessRequestId: "ai-request-a" } }, "Customer update preserves omitted editable fields and carries the fresh revision.");

const addPlan = await handler("contact.add").prepare(context, { customerId: "customer-a", firstName: "Grace", lastName: "Hopper", email: "grace@acme.test" });
await handler("contact.add").execute(execution, addPlan.normalizedInput);
assert.deepEqual(calls[1], { kind: "contact-add", input: { customerId: "customer-a", firstName: "Grace", lastName: "Hopper", email: "grace@acme.test", expectedCustomerRevision: "4", businessRequestId: "ai-request-a" } }, "Contact add uses the Customer revision and canonical request identity.");
await assert.rejects(() => handler("contact.add").prepare(context, { customerId: "customer-a", firstName: "Ada", lastName: "Again", email: "ada@acme.test" }), /already belongs/, "Known active email collisions fail before proposal.");

const updatePlan = await handler("contact.update").prepare(context, { contactId: "contact-a", patch: { title: "Engineer" } });
await handler("contact.update").execute(execution, updatePlan.normalizedInput);
assert.deepEqual(calls[2], { kind: "contact-update", input: { firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test", title: "Engineer", active: true, customerId: "customer-a", expectedCustomerRevision: "4", expectedContactRevision: "2", businessRequestId: "ai-request-a" } }, "Contact update preserves current values and carries both optimistic revisions.");

const primaryPlan = await handler("contact.set_primary").prepare(context, { customerId: "customer-a", contactId: "contact-a" });
await handler("contact.set_primary").execute(execution, primaryPlan.normalizedInput);
assert.deepEqual(calls[3], { kind: "primary", input: { customerId: "customer-a", contactId: "contact-a", expectedCustomerRevision: "4", businessRequestId: "ai-request-a" } }, "Primary-contact command preserves tenant-scoped revision semantics.");
assert.equal(commands.some((item) => item.name === "customer.create"), false, "Customer creation remains unavailable until its canonical idempotency gap is closed.");
console.log("customer administration AI command adapters passed");
