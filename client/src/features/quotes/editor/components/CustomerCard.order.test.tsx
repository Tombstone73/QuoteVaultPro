import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { TextDecoder, TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

// The selector suites cover searching/link resolution. These adapters exercise
// the identity layout's integration with the existing selector contracts.
jest.mock("@/components/CustomerSelect", () => ({
  CustomerSelect: React.forwardRef(({ label, value, onChange }: any, ref) => {
    React.useImperativeHandle(ref, () => ({ focus() {} }));
    return <label>{label}<select aria-label="Customer" value={value ?? ""}
      onChange={(event) => onChange(event.target.value || null, undefined)}>
      <option value="">Search customers...</option><option value="customer-1">Offset House</option>
    </select></label>;
  }),
}));
jest.mock("@/components/ContactSelect", () => ({
  ContactSelect: ({ label, value, customerId, onChange, disabled }: any) => (
    <label>{label}<select aria-label="Contact" data-customer-id={customerId ?? ""}
      value={value ?? ""} disabled={disabled}
      onChange={(event) => onChange(event.target.value || null, event.target.value ? { id: event.target.value, firstName: "Jane", lastName: "Doe" } : null)}>
      <option value="">Search contacts...</option><option value="contact-1">John Smith</option><option value="contact-2">Jane Doe</option>
    </select></label>
  ),
}));

Object.assign(globalThis, { TextEncoder, TextDecoder });
const { MemoryRouter } = require("react-router-dom");
const { CustomerCard } = require("./CustomerCard");

describe("direct Order customer and job identity", () => {
  let host: HTMLDivElement;
  let root: Root;
  const contact = { id: "contact-1", firstName: "John", lastName: "Smith", email: "john@example.com", phone: "3178495155" };
  const baseProps = () => ({
    selectedCustomerId: "customer-1", selectedCustomer: { id: "customer-1", companyName: "Offset House", email: "account@example.com" } as any,
    selectedContactId: "contact-1", selectedContact: contact, contacts: [contact],
    jobLabel: "Spring signs", requestedDueDate: "2026-10-15", poNumber: "PO-123", promisedDate: "2026-10-16", priority: "normal",
    tags: ["Install"], showOrderFields: true, effectiveTaxRate: 0.07, pricingTier: "default",
    discountPercent: null, markupPercent: null, marginPercent: null, deliveryMethod: "pickup" as const,
    onCustomerChange: jest.fn(), onContactChange: jest.fn(), onContactResolved: jest.fn(),
    onJobLabelChange: jest.fn(), onRequestedDueDateChange: jest.fn(), onPoNumberChange: jest.fn(),
    onPromisedDateChange: jest.fn(), onPriorityChange: jest.fn(), onAddTag: jest.fn(), onRemoveTag: jest.fn(),
  });
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  test("presents selected customer and contact using the Order Detail hierarchy", () => {
    act(() => root.render(<CustomerCard {...baseProps()} />));
    const card = host.querySelector('section[aria-label="Customer and contact"]')!;
    expect(card.className).toContain("sm:grid-cols-2");
    expect(card.className).toContain("p-4");
    expect(card.textContent).toContain("Customer");
    expect(card.textContent).toContain("Contact");
    expect(card.querySelectorAll(".uppercase.tracking-\\[0\\.12em\\]")).toHaveLength(2);
    expect(host.querySelector('select[aria-label="Customer"]')).toBeNull();
    expect(host.querySelector('select[aria-label="Contact"]')).toBeNull();
    expect(host.textContent?.match(/Offset House/g)).toHaveLength(1);
    expect(card.querySelector(".text-lg.font-semibold")?.textContent).toBe("Offset House");
    expect(card.querySelector(".text-base.font-semibold")?.textContent).toBe("John Smith");
    expect(host.querySelector('a[href="mailto:john@example.com"]')?.textContent).toBe("john@example.com");
    expect(host.querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(host.querySelector('a[href="mailto:john@example.com"]')?.className).not.toContain("font-mono");
  });

  test("clearing the customer and changing a contact use the canonical callbacks", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} />));
    expect(host.querySelector('[aria-label="Clear customer"]')).toBeNull();
    act(() => (host.querySelector('button[aria-label="Change customer"]') as HTMLButtonElement).click());
    expect(host.querySelector('select[aria-label="Customer"]')).not.toBeNull();
    const clear = Array.from(host.querySelectorAll("button")).find((button) => /clear customer/i.test(button.getAttribute("aria-label") ?? button.textContent ?? ""));
    expect(clear).toBeDefined();
    act(() => clear!.click());
    expect(props.onCustomerChange).toHaveBeenCalledWith(null, undefined);
    act(() => (host.querySelector('button[aria-label="Change contact"]') as HTMLButtonElement).click());
    const select = host.querySelector('select[aria-label="Contact"]') as HTMLSelectElement;
    act(() => { select.value = "contact-2"; Simulate.change(select); });
    expect(props.onContactChange).toHaveBeenCalledWith("contact-2", expect.objectContaining({ firstName: "Jane", lastName: "Doe" }));
    act(() => (host.querySelector('button[aria-label="Change contact"]') as HTMLButtonElement).click());
    act(() => (host.querySelector('button[aria-label="Clear contact"]') as HTMLButtonElement).click());
    expect(props.onContactChange).toHaveBeenCalledWith(null, null);
  });

  test("presents each entity's own email and phone even when they match", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} selectedCustomer={{ ...props.selectedCustomer, email: "JOHN@example.com ", phone: "(317) 849-5155" }} />));
    expect(host.querySelectorAll('a[href^="mailto:"]')).toHaveLength(2);
    expect(host.querySelectorAll('a[href^="tel:"]')).toHaveLength(2);
  });

  test("supports selecting a contact without a customer account", () => {
    act(() => root.render(<CustomerCard {...baseProps()} selectedCustomerId={null} selectedCustomer={undefined} />));
    expect(host.querySelector('select[aria-label="Customer"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Contact"]')).toBeNull();
    expect(host.textContent).toContain("John Smith");
    act(() => (host.querySelector('button[aria-label="Change contact"]') as HTMLButtonElement).click());
    const select = host.querySelector('select[aria-label="Contact"]') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.dataset.customerId).toBe("");
  });

  test("keeps the existing searchable selectors available for an empty order", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} selectedCustomerId={null} selectedCustomer={undefined} selectedContactId={null} selectedContact={null} />));
    expect(host.querySelector('select[aria-label="Customer"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Contact"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Change customer"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Change contact"]')).toBeNull();
  });

  test("shows the address immediately and has no empty address control", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} selectedCustomer={{ ...props.selectedCustomer, shippingStreet1: "330 Windmill Trail", shippingCity: "Greenwood", shippingPostalCode: "46142-7290" }} />));
    expect(host.textContent).toContain("330 Windmill Trail");
    expect(host.textContent).toContain("Greenwood, 46142-7290");
    expect(host.textContent).not.toContain("Show address");
    act(() => root.render(<CustomerCard {...props} />));
    expect(host.textContent).not.toContain("330 Windmill Trail");
    expect(host.textContent).not.toContain("Show address");
  });

  test("returns to detail presentation after customer and contact changes", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} />));
    act(() => (host.querySelector('button[aria-label="Change customer"]') as HTMLButtonElement).click());
    const customerSelect = host.querySelector('select[aria-label="Customer"]') as HTMLSelectElement;
    act(() => { customerSelect.value = "customer-1"; Simulate.change(customerSelect); });
    expect(props.onCustomerChange).toHaveBeenCalledWith("customer-1", undefined, undefined);
    expect(host.querySelector('select[aria-label="Customer"]')).toBeNull();
    act(() => (host.querySelector('button[aria-label="Change contact"]') as HTMLButtonElement).click());
    const contactSelect = host.querySelector('select[aria-label="Contact"]') as HTMLSelectElement;
    act(() => { contactSelect.value = "contact-2"; Simulate.change(contactSelect); });
    expect(host.querySelector('select[aria-label="Contact"]')).toBeNull();
    act(() => root.render(<CustomerCard {...props} selectedContactId={null} selectedContact={null} />));
    expect(host.querySelector('select[aria-label="Contact"]')).not.toBeNull();
  });

  test("edits job identity and commits flags through existing handlers", () => {
    const props = baseProps();
    act(() => root.render(<CustomerCard {...props} />));
    const edits = [
      ["PO-123", "PO-456", props.onPoNumberChange],
      ["Spring signs", "Fall signs", props.onJobLabelChange],
      ["2026-10-15", "2026-10-20", props.onRequestedDueDateChange],
      ["2026-10-16", "2026-10-21", props.onPromisedDateChange],
    ] as const;
    for (const [current, next, handler] of edits) {
      const input = Array.from(host.querySelectorAll("input")).find((candidate) => candidate.value === current)!;
      expect(input).toBeDefined();
      act(() => { input.value = next; Simulate.change(input); });
      expect(handler).toHaveBeenCalledWith(next);
    }
    const flagInput = Array.from(host.querySelectorAll("input")).find((input) => /flag/i.test(input.placeholder))!;
    act(() => { flagInput.value = "Rush"; Simulate.change(flagInput); });
    act(() => Simulate.keyDown(flagInput, { key: "Enter" }));
    expect(props.onAddTag).toHaveBeenCalledWith("Rush");
  });

  test("saved Quote detail uses Order-style identity without Order-only fields", () => {
    const props = baseProps();
    act(() => root.render(<MemoryRouter><CustomerCard {...props} showOrderFields={false} detailPresentation quoteValidUntil="2026-11-15T00:00:00Z" /></MemoryRouter>));
    expect(host.querySelector('section[aria-label="Customer and contact"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Quote details"]')).not.toBeNull();
    expect(host.querySelector('section[aria-label="Commercial and fulfillment"]')).not.toBeNull();
    expect(host.textContent?.match(/Offset House/g)).toHaveLength(1);
    expect(host.textContent).toContain("John Smith");
    expect(host.querySelector('a[href="/customers/customer-1"]')).not.toBeNull();
    expect(host.querySelector('a[href="/contacts/contact-1"]')).not.toBeNull();
    expect(host.textContent).toContain("2026-11-15");
    expect(host.textContent).not.toContain("PO #");
    expect(host.textContent).not.toContain("Promised date");
    expect(host.querySelector('select[aria-label="Customer"]')).toBeNull();
    act(() => (host.querySelector('button[aria-label="Change customer or contact"]') as HTMLButtonElement).click());
    expect(host.querySelector('select[aria-label="Customer"]')).not.toBeNull();
    expect(host.querySelector('select[aria-label="Contact"]')).not.toBeNull();
    const jobLabel = host.querySelector('#quote-detail-job-label') as HTMLInputElement;
    act(() => { jobLabel.value = "Autumn signs"; Simulate.change(jobLabel); });
    expect(props.onJobLabelChange).toHaveBeenCalledWith("Autumn signs");
  });

  test("locked Quote detail keeps all identity fields read only", () => {
    act(() => root.render(<MemoryRouter><CustomerCard {...baseProps()} showOrderFields={false} detailPresentation readOnly /></MemoryRouter>));
    expect(host.querySelector('button[aria-label="Change customer or contact"]')).toBeNull();
    expect((host.querySelector('#quote-detail-job-label') as HTMLInputElement).readOnly).toBe(true);
    expect((host.querySelector('#quote-detail-due-date') as HTMLInputElement).readOnly).toBe(true);
    expect(host.querySelector('input[placeholder="Add flag…"]')).toBeNull();
  });

  test("saved Quote internal notes occupy the center metadata card", () => {
    act(() => root.render(<MemoryRouter><CustomerCard {...baseProps()} showOrderFields={false} detailPresentation detailInternalNotes={<details data-testid="quote-notes"><summary>Internal Notes</summary></details>} /></MemoryRouter>));
    const metadata = host.querySelector('[aria-label="Quote details"]');
    expect(metadata?.querySelector('[data-testid="quote-notes"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Commercial and fulfillment"] [data-testid="quote-notes"]')).toBeNull();
    expect(metadata?.textContent).not.toContain("PO-123");
    expect(metadata?.textContent).not.toContain("Promised Date");
  });
});
