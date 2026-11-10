/// <reference types="jest" />
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TextDecoder, TextEncoder } from "util";
Object.assign(globalThis, { TextEncoder, TextDecoder, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
const { MemoryRouter } = require("react-router-dom") as typeof import("react-router-dom");
import { TooltipProvider } from "@/components/ui/tooltip";
const { CustomerHeader, ContactsPanel } = require("./EnhancedCustomerView") as typeof import("./EnhancedCustomerView");
import { CustomerCompanySections } from "./CustomerCompanySections";
import type { CustomerWithRelations } from "@/hooks/useCustomer";

jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn(), apiRequest: jest.fn() }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, isAdmin: true }) }));
jest.mock("@/hooks/useActiveOrganizationRole", () => ({ useActiveOrganizationRole: () => ({ activeOrgId: "test-org" }) }));
jest.mock("@/components/invoices/MultiInvoicePaymentDialog", () => ({ MultiInvoicePaymentDialog: () => null }));
jest.mock("./TransactionsTab", () => ({ __esModule: true, default: () => null }));
jest.mock("./CurrentCustomerStatement", () => ({ __esModule: true, default: () => null }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const contact = { id: "contact-a", firstName: "Robin", lastName: "Review", title: "Purchasing", email: "robin@example.test", phone: "555-0100", isPrimary: true, isBilling: true };
// Deliberately includes database address names, zero modifiers, and note-history records.
const customer = {
  displayName: null, website: null, shippingAddressLine1: null, shippingAddressLine2: null, shippingZipCode: null, billingAddressLine1: null, billingAddressLine2: null, billingZipCode: null, availableCredit: null, internalNotes: null, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  id: "customer-a", companyName: "Synthetic Customer", customerType: "business", status: "active",
  email: "company@example.test", phone: "555-0199", billingStreet1: "123 Test St", billingCity: "Testville", billingState: "IN", billingPostalCode: "46000", billingCountry: "US",
  shippingStreet1: "123 Test St", shippingCity: "Testville", shippingState: "IN", shippingPostalCode: "46000", shippingCountry: "US",
  pricingTier: "wholesale", defaultDiscountPercent: "0.00", defaultMarkupPercent: "15", defaultMarginPercent: null, productVisibilityMode: "linked-only",
  creditLimit: "1250.00", creditLimitConfigured: true, creditLimitConfiguredAt: "2026-01-01", currentBalance: "0", paymentTerms: "net_30",
  isTaxExempt: true, taxRateOverride: "0.07", taxExemptReason: "Resale", taxExemptCertificateRef: "Certificate A", taxId: "TEST-TAX",
  alwaysRequireProof: true, blindShipping: true, localCompanyFolderPath: "\\\\test-server\\production",
  contacts: [contact], notes: [{ id: "note-a", subject: "Saved history", content: "Preserve this note", createdAt: "2026-01-01", noteType: "general" }], quotes: [], creditTransactions: [],
} as CustomerWithRelations;

let root: Root, host: HTMLDivElement, client: QueryClient;
let records: Array<Record<string, unknown>>, denyPortal: boolean, denyFolder: boolean;
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
async function render(element: React.ReactNode) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider>{element}</TooltipProvider></MemoryRouter></QueryClientProvider>));
  await flush();
}
function button(label: string) {
  const element = Array.from(document.querySelectorAll("button")).find(node => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  if (!element) throw new Error(`Button missing: ${label}`);
  return element;
}
async function click(label: string) { act(() => button(label).click()); await flush(); }
function change(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  localStorage.clear();
  records = []; denyPortal = false; denyFolder = false;
  fetchMock.mockReset(); global.fetch = fetchMock;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method) return response({ success: true });
    if (url.includes("portal-access")) return response({ success: !denyPortal, data: records }, !denyPortal);
    if (url.includes("destinations")) return response({ data: { localPath: "\\\\test-server\\art" } }, !denyFolder);
    if (url.includes("?search=")) return response([{ id: customer.id, notes: "Saved company instructions" }]);
    if (url.includes("account-credit")) return response({ availableCents: 2500 });
    return response({});
  });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { act(() => root.unmount()); client.clear(); document.body.innerHTML = ""; global.fetch = originalFetch; });

test('contact portal controls review and confirm a scoped role change without altering invoice notifications', async () => {
  records = [{ id: 'access-a', contactId: contact.id, email: contact.email, status: 'ACTIVE', accessRole: 'VIEWER' }];
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  act(() => button('Portal actions for Robin Review').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  await flush();
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => node.textContent === 'Change Role') as HTMLElement;
  act(() => item.click()); await flush();
  expect(document.body.textContent).toContain('Current role: Viewer');
  expect(document.body.textContent).toContain('pay invoices');
  const select = document.querySelector('select[aria-label="New portal role"]') as HTMLSelectElement;
  act(() => { select.value = 'BILLING'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(button('Save Role').hasAttribute('disabled')).toBe(true);
  expect(posts()).toHaveLength(0);
  act(() => (document.querySelector('[role="dialog"] input[type="checkbox"]') as HTMLInputElement).click());
  await click('Save Role');
  expect(posts()).toHaveLength(1);
  expect(posts()[0][0]).toBe('/api/customers/customer-a/portal-access/access-a/role');
  expect(JSON.parse(posts()[0][1].body)).toEqual({ role: 'BILLING', expectedRole: 'VIEWER' });
});

test("saved company, financial, pricing and production values are readable, including zero and note history", async () => {
  const edit = jest.fn();
  await render(<CustomerCompanySections customer={customer} companyNotes="Saved company instructions" artworkFolder="/fixtures/art" onEdit={edit} onEditDestination={() => {}} />);
  for (const value of ["123 Test St", "46000", "company@example.test", "Saved company instructions", "Preserve this note", "$1,250.00", "7%", "TEST-TAX", "wholesale", "0%", "15%", "Linked products only", "/fixtures/art"]) expect(host.textContent).toContain(value);
  for (const [label, section] of [["Company Information", "company"], ["Financial & Tax", "financial"], ["Pricing & Products", "pricing"], ["Production Settings", "production"]]) {
    await click(`Edit ${label}`); expect(edit).toHaveBeenLastCalledWith(section);
  }
});

test("compact header keeps Back and existing actions, uses company contact information and actual primary contact", async () => {
  const back = jest.fn();
  await render(<CustomerHeader customer={customer} layoutMode="full" onBack={back} />);
  expect(host.textContent).not.toContain("Open Customers");
  for (const label of ["Quote", "Order", "Preview Customer Portal", "Edit Company"]) expect(button(label)).toBeTruthy();
  expect(host.querySelector('a[href="mailto:company@example.test"]')).not.toBeNull();
  expect(host.textContent).toContain("Robin Review");
  await click("Back"); expect(back).toHaveBeenCalledTimes(1);
});

test("section edit opens the canonical form, focuses its fields, saves canonical payload and refreshes saved-value reads", async () => {
  const invalidate = jest.spyOn(client, "invalidateQueries");
  await render(<CustomerHeader customer={customer} layoutMode="full" />);
  await click("Edit Pricing & Products");
  expect(document.activeElement?.closest('[data-company-section="pricing"]')).not.toBeNull();
  expect((document.getElementById("notes") as HTMLTextAreaElement).value).toBe("Saved company instructions");
  change("phone", "555-0111");
  await click("Update Company");
  const patch = fetchMock.mock.calls.find(([url, init]) => url === "/api/customers/customer-a" && init?.method === "PATCH");
  expect(patch).toBeDefined();
  expect(JSON.parse(patch![1].body)).toEqual(expect.objectContaining({ phone: "555-0111", notes: "Saved company instructions", billingStreet1: "123 Test St", taxRateOverride: 0.07, paymentTerms: "net_30", alwaysRequireProof: true, blindShipping: true }));
  expect(fetchMock.mock.calls.filter(([url, init]) => url.includes("destinations") && init?.method)).toHaveLength(0);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers/customer-a"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/customers"] });
});

test("unavailable folder lookup cannot erase an existing production destination when editing other company fields", async () => {
  denyFolder = true;
  await render(<CustomerHeader customer={customer} layoutMode="full" />);
  await click("Edit Company");
  expect((document.getElementById("art-output-folder") as HTMLInputElement).disabled).toBe(true);
  await click("Update Company");
  expect(fetchMock.mock.calls.some(([url, init]) => url.includes("destinations") && init?.method)).toBe(false);
});

test("deliberate output-folder edit retains the existing protected destination writer", async () => {
  await render(<CustomerHeader customer={customer} layoutMode="full" />);
  await click("Edit Production Settings");
  expect(document.activeElement?.closest('[data-company-section="production"]')).not.toBeNull();
  change("art-output-folder", "/fixtures/new-art-folder");
  await click("Update Company");
  const writes = fetchMock.mock.calls.filter(([url, init]) => url.includes("destinations") && init?.method);
  expect(writes).toHaveLength(1);
  expect(writes[0][1]).toEqual(expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(JSON.parse(writes[0][1].body)).toEqual({ customerId: customer.id, localPath: "/fixtures/new-art-folder", enabled: true });
});

test("company notes read failure cannot hydrate note history into the company editor", async () => {
  const normalFetch = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url, init) => url.includes("?search=") ? Promise.resolve(response({}, false)) : normalFetch(url, init));
  await render(<CustomerHeader customer={customer} layoutMode="full" />);
  await click("Edit Company");
  expect(document.body.textContent).toContain("Saved company notes could not be loaded");
  expect(document.getElementById("notes")).toBeNull();
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
});

test.each([
  [null, "Create Access", "/api/customers/customer-a/contacts/contact-a/portal-access"],
  ["PENDING_INVITE", "Resend", "/api/customer-portal-access/access-a/resend-invite"],
  ["PENDING_INVITE", "Disable", "/api/customer-portal-access/access-a/cancel-invite"],
  ["ACTIVE", "Reset Password", "/api/customer-portal-access/access-a/reset-password"],
  ["ACTIVE", "Suspend", "/api/customer-portal-access/access-a/suspend"],
  ["ACTIVE", "Disable", "/api/customer-portal-access/access-a/disable"],
  ["SUSPENDED", "Activate", "/api/customer-portal-access/access-a/activate"],
])("unified contact table preserves canonical %s → %s portal operation", async (status, action, path) => {
  if (status) records = [{ id: "access-a", contactId: contact.id, email: contact.email, status }];
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  expect(host.querySelectorAll("table")).toHaveLength(1);
  expect(host.textContent).toContain("Purchasing"); expect(host.textContent).toContain("Primary");
  expect(host.querySelector('[aria-label="Receives Invoices for Robin Review"]')).not.toBeNull();
  if (["Disable", "Reset Password", "Suspend"].includes(action)) {
    act(() => button("Portal actions for Robin Review").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await flush();
    const menuItem = Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => node.textContent?.trim() === action) as HTMLElement;
    expect(menuItem).toBeDefined();
    act(() => menuItem.click()); await flush();
  } else await click(action);
  expect(posts()).toEqual([[path, expect.objectContaining({ credentials: "include", method: "POST" })]]);
});

test("email equality never substitutes for contact linkage and unlinked identities remain visible", async () => {
  records = [{ id: "unlinked-a", contactId: null, email: contact.email, status: "ACTIVE" }];
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  expect(host.textContent).toContain("Unlinked portal identities (1)");
  expect(host.querySelector("tbody")?.textContent).toContain("Not enabled");
  expect(host.querySelector("tbody")?.textContent).not.toContain("Reset Password");
});

test("ambiguous explicit linkage cannot silently choose an identity to mutate", async () => {
  records = ["a", "b"].map(id => ({ id, contactId: contact.id, email: contact.email, status: "ACTIVE" }));
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  expect(host.textContent).toContain("Multiple portal identities linked");
  expect(host.textContent).not.toContain("Reset Password"); expect(posts()).toHaveLength(0);
});

test("portal permission/read failure shows unavailable rather than offering creation", async () => {
  denyPortal = true;
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  expect(host.textContent).toContain("Portal access unavailable");
  expect(host.textContent).not.toContain("Create Access"); expect(posts()).toHaveLength(0);
});


test("company and contacts disclosures default expanded, persist independently, and keep financial identity visible", async () => {
  await render(<><CustomerHeader customer={customer} layoutMode="full" /><ContactsPanel customer={customer} layoutMode="full" /></>);
  const companyToggle = () => button("Company Information");
  const contactsToggle = () => Array.from(host.querySelectorAll("button[aria-expanded]")).find(node => node.textContent?.includes("Contacts & Portal Access")) as HTMLButtonElement;
  expect(companyToggle().getAttribute("aria-expanded")).toBe("true");
  expect(contactsToggle().getAttribute("aria-expanded")).toBe("true");
  await click("Company Information");
  expect(companyToggle().getAttribute("aria-expanded")).toBe("false");
  expect(contactsToggle().getAttribute("aria-expanded")).toBe("true");
  act(() => contactsToggle().click()); await flush();
  expect(localStorage.getItem("titanos.customerDetail.companyExpanded")).toBe("false");
  expect(localStorage.getItem("titanos.customerDetail.contactsExpanded")).toBe("false");
  const summary = host.querySelector('[data-testid="customer-account-summary"]')!;
  for (const label of ["Acct", "Limit", "Terms", "Account Credit", "Outstanding A/R", "Pending Billing", "Credit Exposure", "Open Work", "Available Credit"]) expect(summary.textContent).toContain(label);
  expect(summary.closest("[hidden]")).toBeNull();
  expect(button("Edit Company").closest("[hidden]")).toBeNull();
  await act(async () => root.render(<></>));
  await render(<><CustomerHeader customer={customer} layoutMode="full" /><ContactsPanel customer={customer} layoutMode="full" /></>);
  expect(companyToggle().getAttribute("aria-expanded")).toBe("false");
  expect(contactsToggle().getAttribute("aria-expanded")).toBe("false");
});

test("collapsed contacts show current pending count without background refetch reopening the table", async () => {
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  const toggle = () => Array.from(host.querySelectorAll("button[aria-expanded]")).find(node => node.textContent?.includes("Contacts & Portal Access")) as HTMLButtonElement;
  act(() => toggle().click()); await flush();
  records = [{ id: "access-a", contactId: contact.id, email: contact.email, status: "PENDING_INVITE" }];
  await act(async () => { await client.invalidateQueries({ queryKey: ["/api/customers/customer-a/portal-access"] }); });
  await flush();
  expect(toggle().textContent).toContain("1 contacts · 1 pending invitations");
  expect(toggle().getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector("table")?.closest("[hidden]")).not.toBeNull();
});

test("portal history is available from the keyboard actions menu without changing access", async () => {
  records = [{ id: "access-a", contactId: contact.id, email: contact.email, status: "ACTIVE", createdAt: "2026-01-01", inviteSentAt: "2026-01-02" }];
  await render(<ContactsPanel customer={customer} layoutMode="full" />);
  act(() => button("Portal actions for Robin Review").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await flush();
  const history = Array.from(document.querySelectorAll('[role="menuitem"]')).find(node => node.textContent === "Access History") as HTMLElement;
  act(() => history.click()); await flush();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(contact.email);
  expect(posts()).toHaveLength(0);
});


test("compact contact rows retain invoice recipient updates and existing contact actions", async () => {
  await render(<ContactsPanel customer={{ ...customer, contacts: [{ ...customer.contacts[0], isPrimary: false }] }} layoutMode="full" />);
  const invoiceRecipient = host.querySelector('[aria-label="Receives Invoices for Robin Review"]') as HTMLButtonElement;
  act(() => invoiceRecipient.click()); await flush();
  const invoicePatch = fetchMock.mock.calls.find(([url, init]) => url === "/api/customer-contacts/contact-a" && init?.method === "PATCH");
  expect(JSON.parse(invoicePatch![1].body)).toEqual({ relationshipCustomerId: customer.id, isBilling: false });
  act(() => button("Actions for Robin Review").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await flush();
  const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
  expect(items.map(node => node.textContent?.trim())).toEqual(["Edit Contact", "Make Primary", "Remove from Company"]);
  const makePrimary = items.find(node => node.textContent?.trim() === "Make Primary") as HTMLElement;
  act(() => makePrimary.click()); await flush();
  expect(posts()).toContainEqual(["/api/customers/customer-a/contacts/contact-a/set-primary", expect.objectContaining({ credentials: "include", method: "POST" })]);
});
