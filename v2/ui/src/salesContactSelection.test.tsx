import assert from "node:assert/strict";
import React, { act, StrictMode } from "react";
import { JSDOM } from "jsdom";
import { SalesContactSelection, type SalesContactSelectionProps } from "./SalesContactSelection";
import type { CustomerContactReference } from "../../src/modules/customers/contracts";
import type { SalesContactChoice, SalesContactSelectionQuery, SalesContactSelectionResult } from "../../src/modules/customers/salesContactSelection";
import { brandedId } from "../../src/modules/shared/commercialValues";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic", "Use cleanEnvironment/run.");
const org = brandedId<"OrganizationId">("tenant-a");
const otherOrg = brandedId<"OrganizationId">("tenant-b");
const customer = brandedId<"CustomerId">("account-a");
const secondCustomer = brandedId<"CustomerId">("account-b");
const contact = brandedId<"ContactId">("contact-a");
const savedContact = brandedId<"ContactId">("saved-contact");
const choice = (id: string, label: string): SalesContactChoice => ({ id: brandedId<"ContactId">(id), label });
const direct = choice(contact, "Alex Direct");
const saved = choice(savedContact, "Dana Saved");
const result = (items: readonly SalesContactChoice[] = [direct], selectedContact: SalesContactChoice | null = null): SalesContactSelectionResult => ({ items, selectedContact });
const both: CustomerContactReference = { organizationId: org, customerId: customer, contactId: contact };

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://ui.invalid/sales/new" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { Simulate } = await import("react-dom/test-utils");
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error("The selector must only use the supplied scoped lookup, never shared API/providers."); };
let root = createRoot(document.getElementById("root")!);
let props: SalesContactSelectionProps;
let changes: (CustomerContactReference | undefined)[] = [];
const text = () => document.body.textContent ?? "";
const field = (label: string) => {
  const control = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  assert.ok(control, label); return control;
};
const options = () => [...field("Contact").querySelectorAll("option")].map((node) => ({ id: node.value, label: node.textContent }));
const render = async (overrides: Partial<SalesContactSelectionProps> = {}) => {
  props = { ...props, ...overrides };
  await act(async () => root.render(<StrictMode><SalesContactSelection {...props} /></StrictMode>));
};
const mount = async (overrides: Partial<SalesContactSelectionProps> = {}) => {
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!); changes = [];
  props = { organizationId: org, identityScope: "user-a/workspace-a", value: undefined,
    customerOptions: [{ id: customer, label: "First Account" }, { id: secondCustomer, label: "Second Account" }],
    lookupContacts: async () => result(),
    onChange: (value) => { changes.push(value); props = { ...props, value }; root.render(<StrictMode><SalesContactSelection {...props} /></StrictMode>); },
    ...overrides };
  await render();
};
const change = async (label: string, value: string) => {
  await act(async () => { const control = field(label); control.value = value; Simulate.change(control); });
};
function deferredLookup() {
  const requests: { query: SalesContactSelectionQuery; resolve: (value: SalesContactSelectionResult) => void; reject: (error: Error) => void }[] = [];
  const lookupContacts = (query: SalesContactSelectionQuery) => new Promise<SalesContactSelectionResult>((resolve, reject) => { requests.push({ query, resolve, reject }); });
  const last = () => { const request = requests.at(-1); assert.ok(request); return request; };
  const resolve = async (request: ReturnType<typeof last>, value: SalesContactSelectionResult) => { await act(async () => request.resolve(value)); };
  return { lookupContacts, requests, last, resolve };
}
let cases = 0;
const check = async (name: string, work: () => Promise<void>) => { await work(); cases++; console.log(`PASS ${name}`); };
try {
  await check("neutral Customer mode performs no lookup, Contact-only needs no account", async () => {
    const calls: SalesContactSelectionQuery[] = [];
    await mount({ lookupContacts: async (query) => { calls.push(query); return result(); } });
    assert.equal(calls.length, 0); assert.equal(field("Search Contacts").disabled, true);
    await change("Customer / Contact mode", "contact_only");
    assert.equal(document.querySelector('[aria-label="Customer"]'), null);
    assert.equal(field("Search Contacts").disabled, false);
    assert.equal(Object.hasOwn(calls.at(-1)!, "customerId"), false);
    await change("Contact", contact);
    assert.deepEqual(props.value, { organizationId: org, contactId: contact });
    assert.equal(Object.hasOwn(props.value!, "customerId"), false);
    await change("Contact", "");
    assert.equal(props.value, undefined); assert.equal(field("Customer / Contact mode").value, "contact_only");
    assert.equal(field("Search Contacts").disabled, false, "clearing contact-only identity must not require a Customer");
  });
  await check("mode switch explicitly removes account and returning never guesses it", async () => {
    await mount({ value: both, lookupContacts: async () => result([direct], direct) });
    await change("Customer / Contact mode", "contact_only");
    assert.deepEqual(changes.at(-1), { organizationId: org, contactId: contact });
    assert.equal(Object.hasOwn(changes.at(-1)!, "customerId"), false);
    await change("Customer / Contact mode", "customer_contact");
    assert.equal(props.value, undefined); assert.equal(field("Customer").value, ""); assert.equal(field("Contact").value, "");
    await change("Customer", secondCustomer);
    assert.deepEqual(props.value, { organizationId: org, customerId: secondCustomer });
  });
  await check("changing Customer clears contact before the next scoped read", async () => {
    const calls: SalesContactSelectionQuery[] = [];
    await mount({ value: both, lookupContacts: async (query) => { calls.push(query); return result([choice("contact-b", "Bailey Linked")]); } });
    await change("Customer", secondCustomer);
    assert.deepEqual(props.value, { organizationId: org, customerId: secondCustomer });
    assert.equal(field("Contact").value, "");
    assert.equal(calls.at(-1)?.customerId, secondCustomer); assert.equal(calls.at(-1)?.selectedContactId, undefined);
    await change("Contact", "contact-b");
    assert.deepEqual(props.value, { organizationId: org, customerId: secondCustomer, contactId: "contact-b" });
  });
  await check("resume hydrates a saved Contact outside the first page and preserves controlled identity", async () => {
    const calls: SalesContactSelectionQuery[] = [];
    const value: CustomerContactReference = { organizationId: org, contactId: savedContact };
    await mount({ value, lookupContacts: async (query) => { calls.push(query); return result([direct], saved); } });
    assert.equal(field("Customer / Contact mode").value, "contact_only");
    assert.equal(field("Contact").value, savedContact);
    assert.ok(options().some((option) => option.id === savedContact && option.label === "Dana Saved"));
    assert.equal(calls.at(-1)?.selectedContactId, savedContact); assert.equal(calls.at(-1)?.customerId, undefined);
    assert.equal(changes.length, 0); assert.deepEqual(props.value, value);
    await change("Search Contacts", "Alex");
    assert.equal(field("Contact").value, savedContact); assert.equal(changes.length, 0);
    assert.ok(options().some((option) => option.id === savedContact && option.label === "Dana Saved"));
    await mount({ value: both, customerOptions: [], lookupContacts: async () => result([], direct) });
    assert.equal(field("Customer").value, customer); assert.equal(field("Contact").value, contact); assert.equal(changes.length, 0);
  });
  await check("stale persisted selection reports unavailable without silently clearing it", async () => {
    await mount({ value: { organizationId: org, contactId: savedContact }, lookupContacts: async () => result([]) });
    assert.equal(field("Contact").value, savedContact); assert.equal(changes.length, 0);
    assert.match(text(), /saved Contact is unavailable/); assert.match(text(), /No active Contacts are available/);
    assert.equal(field("Contact").disabled, false, "an explicit correction remains available");
    await change("Contact", ""); assert.equal(props.value, undefined);
  });
  await check("search races hide old choices immediately and ignore out-of-order responses", async () => {
    const lookup = deferredLookup(); await mount({ value: { organizationId: org, contactId: savedContact }, lookupContacts: lookup.lookupContacts });
    await lookup.resolve(lookup.last(), result([direct], saved));
    await change("Search Contacts", "old"); const old = lookup.last();
    assert.match(text(), /Loading Contacts/); assert.equal(field("Contact").disabled, true);
    assert.ok(!options().some((option) => option.id === contact));
    await change("Search Contacts", "new"); const latest = lookup.last();
    await lookup.resolve(latest, result([choice("new-contact", "New Result")], saved));
    await lookup.resolve(old, result([choice("old-contact", "Private Old Result")], saved));
    assert.doesNotMatch(text(), /Private Old Result/); assert.ok(!options().some((option) => option.id === "old-contact"));
    const forgedOption = document.createElement("option"); forgedOption.value = "old-contact"; field("Contact").append(forgedOption);
    await change("Contact", "old-contact"); assert.equal(props.value?.contactId, savedContact);
    await change("Contact", "new-contact"); assert.deepEqual(props.value, { organizationId: org, contactId: "new-contact" });
  });
  await check("late previous-Customer results cannot reinsert its contact", async () => {
    const lookup = deferredLookup(); await mount({ value: both, lookupContacts: lookup.lookupContacts });
    const previous = lookup.last(); await change("Customer", secondCustomer); const latest = lookup.last();
    assert.equal(field("Contact").value, "");
    await lookup.resolve(latest, result([choice("second-contact", "Second Contact")]));
    await lookup.resolve(previous, result([direct], direct));
    assert.doesNotMatch(text(), /Alex Direct/); assert.equal(field("Contact").value, "");
    assert.deepEqual(props.value, { organizationId: org, customerId: secondCustomer });
    assert.equal(changes.length, 1, "lookup completion must never change reference identity");
  });
  await check("tenant and user/workspace identity changes discard old requests and display data", async () => {
    const oldLookup = deferredLookup(); await mount({ value: { organizationId: org, contactId: savedContact }, lookupContacts: oldLookup.lookupContacts });
    const old = oldLookup.last();
    const nextLookup = deferredLookup();
    await render({ organizationId: otherOrg, identityScope: "user-a/workspace-b", value: { organizationId: otherOrg, contactId: brandedId<"ContactId">("tenant-b-contact") }, customerOptions: [], lookupContacts: nextLookup.lookupContacts });
    await nextLookup.resolve(nextLookup.last(), result([choice("tenant-b-contact", "Tenant B Name")], choice("tenant-b-contact", "Tenant B Name")));
    await oldLookup.resolve(old, result([choice("foreign-old", "Private Tenant A")], saved));
    assert.doesNotMatch(text(), /Private Tenant A|Dana Saved/); assert.equal(field("Contact").value, "tenant-b-contact");
    const priorUser = nextLookup.last(); await change("Search Contacts", "late-user"); const lateUser = nextLookup.last();
    const userLookup = deferredLookup(); await render({ identityScope: "user-b/workspace-b", value: undefined, lookupContacts: userLookup.lookupContacts });
    assert.equal(field("Search Contacts").value, ""); assert.equal(field("Customer / Contact mode").value, "customer_contact");
    await nextLookup.resolve(lateUser, result([choice("old-user-contact", "Private Prior User")]));
    await nextLookup.resolve(priorUser, result([choice("old-user-contact", "Private Prior User")]));
    assert.doesNotMatch(text(), /Tenant B Name|Private Prior User/); assert.equal(field("Contact").value, "");
    assert.equal(changes.length, 0);
    await render({ value: both }); assert.match(text(), /belongs to another organization/); assert.equal(field("Contact").value, "");
  });
  await check("loading, generic error, retry and empty states never leak provider errors", async () => {
    const lookup = deferredLookup(); await mount({ value: { organizationId: org, contactId: savedContact }, lookupContacts: lookup.lookupContacts });
    assert.match(text(), /Loading Contacts/); assert.equal(field("Contact").value, savedContact);
    await act(async () => lookup.last().reject(Error("private database/provider failure")));
    assert.match(text(), /Contacts are unavailable/); assert.doesNotMatch(text(), /private database/); assert.equal(changes.length, 0);
    const retry = [...document.querySelectorAll("button")].find((button) => button.textContent === "Retry Contacts"); assert.ok(retry);
    await act(async () => retry.click()); await lookup.resolve(lookup.last(), result([], saved));
    assert.match(text(), /No active Contacts are available/); assert.equal(field("Contact").value, savedContact);
    await change("Search Contacts", "missing"); await lookup.resolve(lookup.last(), result([], saved));
    assert.match(text(), /No active Contacts match this search/); assert.equal(changes.length, 0);
  });
  await check("disabled and read-only states block changes including synthetic events", async () => {
    let reads = 0; const lookupContacts = async () => { reads++; return result([direct], direct); };
    await mount({ value: both, lookupContacts, disabled: true });
    assert.equal(reads, 0);
    for (const label of ["Customer / Contact mode", "Customer", "Search Contacts", "Contact"]) assert.equal(field(label).disabled, true);
    await change("Customer", secondCustomer); await change("Customer / Contact mode", "contact_only"); await change("Contact", "");
    assert.equal(changes.length, 0); assert.deepEqual(props.value, both);
    await render({ disabled: false, readOnly: true });
    assert.ok(reads > 0, "read-only resume may hydrate a name but never edit"); assert.match(text(), /read-only/);
    await change("Customer", secondCustomer); await change("Contact", ""); assert.equal(changes.length, 0);
    await render({ readOnly: false }); assert.equal(field("Customer").disabled, false);
    await change("Customer", secondCustomer); assert.equal(changes.length, 1);
    await render({ identityScope: "", value: undefined }); assert.match(text(), /current workspace identity/); assert.equal(field("Customer / Contact mode").disabled, true);
  });
  console.log(`Mounted Sales contact selection: ${cases} cases passed.`);
} finally {
  await act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.window.close();
}
