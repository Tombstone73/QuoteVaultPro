import { describe, expect, test } from "@jest/globals";

import { resolveOrderCustomerIdForContact } from "../orderCustomerResolution";

describe("resolveOrderCustomerIdForContact", () => {
  test("resolves a linked contact to its canonical customer", () => {
    expect(resolveOrderCustomerIdForContact({
      currentCustomerId: null,
      legacyCustomerId: "graphic-solutions",
      linkedCustomers: [{ id: "graphic-solutions", isPrimary: true }],
    })).toBe("graphic-solutions");
  });

  test("replaces a stale customer for a contact linked to another customer", () => {
    expect(resolveOrderCustomerIdForContact({
      currentCustomerId: "customer-a",
      legacyCustomerId: "customer-b",
      linkedCustomers: [{ id: "customer-b", isPrimary: true }],
    })).toBe("customer-b");
  });

  test("keeps a directly selected customer when the contact is also linked to it", () => {
    expect(resolveOrderCustomerIdForContact({
      currentCustomerId: "customer-b",
      legacyCustomerId: "customer-a",
      linkedCustomers: [
        { id: "customer-a", isPrimary: true },
        { id: "customer-b", isPrimary: false },
      ],
    })).toBe("customer-b");
  });

  test("preserves standalone-contact behavior", () => {
    expect(resolveOrderCustomerIdForContact({ currentCustomerId: "customer-a", linkedCustomers: [] })).toBe("customer-a");
    expect(resolveOrderCustomerIdForContact({ currentCustomerId: null, linkedCustomers: [] })).toBeNull();
  });
});
