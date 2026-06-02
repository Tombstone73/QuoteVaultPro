import {
  isPortalContactEmailLoginManaged,
  normalizePortalProfileUpdatePayload,
} from "../services/portal.service";

describe("portal profile update validation", () => {
  test("normalizes allowed customer, address, and contact fields", () => {
    const payload = normalizePortalProfileUpdatePayload({
      company: { phone: " 555-1212 ", email: " account@example.com " },
      billingAddress: { street1: " 100 Main ", city: " Austin ", state: " TX " },
      shippingAddress: { postalCode: " 78701 ", country: " US " },
      contact: { firstName: " Ada ", lastName: " Lovelace ", phone: " 555-3434 " },
    });

    expect(payload.company?.phone).toBe("555-1212");
    expect(payload.company?.email).toBe("account@example.com");
    expect(payload.billingAddress?.street1).toBe("100 Main");
    expect(payload.shippingAddress?.postalCode).toBe("78701");
    expect(payload.contact?.firstName).toBe("Ada");
    expect(payload.contact?.lastName).toBe("Lovelace");
  });

  test("rejects restricted customer/account fields even when submitted by the client", () => {
    expect(() =>
      normalizePortalProfileUpdatePayload({
        company: { phone: "555-1212", pricingTier: "wholesale" },
      }),
    ).toThrow(/restricted or unsupported/i);

    expect(() =>
      normalizePortalProfileUpdatePayload({
        customerId: "other-customer",
      }),
    ).toThrow(/restricted or unsupported/i);
  });

  test("rejects invalid email values before permanent updates", () => {
    expect(() =>
      normalizePortalProfileUpdatePayload({
        company: { email: "not-an-email" },
      }),
    ).toThrow(/valid email/i);
  });

  test("identifies contact email that is managed by portal login identity", () => {
    expect(
      isPortalContactEmailLoginManaged({
        contactEmail: "portal@example.com",
        loginEmail: "PORTAL@example.com",
      }),
    ).toBe(true);
    expect(
      isPortalContactEmailLoginManaged({
        contactEmail: "alternate@example.com",
        loginEmail: "portal@example.com",
        accessEmail: "portal@example.com",
      }),
    ).toBe(false);
  });
});
