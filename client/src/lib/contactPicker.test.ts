import {
  contactMatchesCustomer,
  filterContactsForCustomer,
  getCanonicalContactCustomerId,
  getContactCompanyLabel,
  getContactCustomerConflict,
  getContactDisplayName,
  getContactSecondaryLine,
  resolveOrderCustomerIdFromContact,
  sortContactsForCustomer,
  type ContactPickerContact,
} from "./contactPicker";

describe("contact picker helpers", () => {
  const standalone: ContactPickerContact = {
    id: "contact-standalone",
    customerId: null,
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    phone: "555-0100",
    linkedCustomers: [],
  };

  const attached: ContactPickerContact = {
    id: "contact-attached",
    customerId: "customer-1",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@acme.example",
    customer: { id: "customer-1", companyName: "Acme Signs", status: "active", isPrimary: true },
    linkedCustomers: [{ id: "customer-1", companyName: "Acme Signs", status: "active", isPrimary: true }],
  };

  test("displays standalone contacts without undefined or blank customer labels", () => {
    expect(getContactDisplayName(standalone)).toBe("John Doe");
    expect(getContactCompanyLabel(standalone)).toBe("No customer account");
    expect(getContactSecondaryLine(standalone)).toBe("No customer account - john@example.com");
    expect(getContactSecondaryLine(standalone)).not.toContain("undefined");
  });

  test("displays associated customer context for linked contacts", () => {
    expect(getContactCompanyLabel(attached)).toBe("Acme Signs");
    expect(getContactSecondaryLine(attached)).toBe("Acme Signs - jane@acme.example");
  });

  test("allows standalone contact-only and customer-plus-standalone selection without creating a fake customer", () => {
    expect(contactMatchesCustomer(standalone, null)).toBe(true);
    expect(contactMatchesCustomer(standalone, "customer-1")).toBe(true);
    expect(getContactCustomerConflict(standalone, "customer-1")).toBeNull();
  });

  test("preserves compatible customer-associated contacts and flags incompatible combinations", () => {
    expect(contactMatchesCustomer(attached, "customer-1")).toBe(true);
    expect(getContactCustomerConflict(attached, "customer-1")).toBeNull();
    expect(contactMatchesCustomer(attached, "customer-2")).toBe(false);
    expect(getContactCustomerConflict(attached, "customer-2")).toBe("CONTACT_CUSTOMER_CONFLICT");
  });

  test("resolves a selected linked contact to its canonical customer", () => {
    expect(getCanonicalContactCustomerId(attached)).toBe("customer-1");
    expect(resolveOrderCustomerIdFromContact("customer-previous", attached)).toBe("customer-1");
  });

  test("replaces a stale customer for another linked contact and preserves standalone contacts", () => {
    const otherCustomerContact: ContactPickerContact = {
      ...attached,
      id: "contact-other",
      customerId: "customer-2",
      customer: { id: "customer-2", companyName: "Other Signs", status: "active", isPrimary: true },
      linkedCustomers: [{ id: "customer-2", companyName: "Other Signs", status: "active", isPrimary: true }],
    };

    expect(resolveOrderCustomerIdFromContact("customer-1", otherCustomerContact)).toBe("customer-2");
    expect(resolveOrderCustomerIdFromContact("customer-1", standalone)).toBe("customer-1");
    expect(resolveOrderCustomerIdFromContact("", standalone)).toBe("");
  });

  test("sorts contacts compatible with the selected customer first", () => {
    const otherCustomer = {
      ...attached,
      id: "other",
      customerId: "customer-2",
      customer: { id: "customer-2", companyName: "Other Signs", status: "active" },
      linkedCustomers: [{ id: "customer-2", companyName: "Other Signs", status: "active" }],
    };
    const sorted = sortContactsForCustomer([attached, otherCustomer, standalone], "customer-1");
    expect(sorted.map((contact) => contact.id)).toEqual(["contact-attached", "contact-standalone", "other"]);
  });

  test("strictly scopes a selected customer's picker to active customer links", () => {
    const otherCustomerContact: ContactPickerContact = {
      ...attached,
      id: "other",
      customerId: "customer-2",
      customer: { id: "customer-2", companyName: "Other Signs", status: "active" },
      linkedCustomers: [{ id: "customer-2", companyName: "Other Signs", status: "active" }],
    };

    expect(filterContactsForCustomer([attached, standalone, otherCustomerContact], "customer-1").map((contact) => contact.id))
      .toEqual(["contact-attached"]);
    expect(filterContactsForCustomer([attached, standalone], null).map((contact) => contact.id))
      .toEqual(["contact-attached", "contact-standalone"]);
  });
});
