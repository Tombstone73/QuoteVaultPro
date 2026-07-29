import { describe, expect, test } from "@jest/globals";
import { mapLocalCustomerToQB } from "../lib/quickbooksCustomerMapping";

describe("QuickBooks individual customer mapping", () => {
  test("maps an individual customer with person fields and no fake CompanyName", () => {
    const payload = mapLocalCustomerToQB({
      id: "customer-individual",
      organizationId: "org-1",
      companyName: "Jane Standalone",
      customerType: "individual",
      displayName: "Jane Standalone",
      individualFirstName: "Jane",
      individualLastName: "Standalone",
      sourceContactId: "contact-1",
      email: "jane@example.test",
      phone: "555-0100",
      billingStreet1: "100 Main St",
      billingCity: "Tombstone",
      billingState: "AZ",
      billingPostalCode: "85638",
      billingCountry: "US",
    } as any);

    expect(payload.DisplayName).toBe("Jane Standalone");
    expect(payload.GivenName).toBe("Jane");
    expect(payload.FamilyName).toBe("Standalone");
    expect(payload.PrimaryEmailAddr).toEqual({ Address: "jane@example.test" });
    expect(payload.PrimaryPhone).toEqual({ FreeFormNumber: "555-0100" });
    expect(payload.BillAddr).toMatchObject({
      Line1: "100 Main St",
      City: "Tombstone",
      CountrySubDivisionCode: "AZ",
      PostalCode: "85638",
    });
    expect(payload.CompanyName).toBeUndefined();
  });
});
