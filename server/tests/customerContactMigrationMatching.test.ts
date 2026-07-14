import { describe, expect, test } from "@jest/globals";
import {
  isGenericSharedEmail,
  matchCompany,
  matchContact,
  normalizeCompanyName,
  normalizePersonName,
  relationshipFlagsFromInfoFloType,
  type CompanyLike,
  type ContactLike,
  type ExternalIdentityLike,
} from "../services/customerContactMigration/matching";

const companies: CompanyLike[] = [
  {
    id: "cust_qb",
    companyName: "Titan Graphics LLC",
    email: "billing@titangraphics.com",
    phone: "404-555-1111",
    billingStreet1: "10 Print Way",
    billingCity: "Atlanta",
    billingState: "GA",
    billingPostalCode: "30301",
    externalAccountingId: "QB-100",
  },
  {
    id: "cust_other_city",
    companyName: "Titan Graphics Inc",
    email: "orders@titan-other.com",
    phone: "404-555-2222",
    billingStreet1: "99 Vinyl Ave",
    billingCity: "Savannah",
    billingState: "GA",
    billingPostalCode: "31401",
  },
  {
    id: "cust_acme",
    companyName: "ACME Signs",
    email: "ap@acmesigns.com",
    phone: "212-555-1000",
    billingStreet1: "1 Main",
    billingCity: "New York",
    billingState: "NY",
    billingPostalCode: "10001",
  },
];

const contacts: ContactLike[] = [
  {
    id: "person_jane",
    firstName: "Jane",
    lastName: "Rivers",
    email: "Jane.Rivers@Example.com",
    phone: "404-555-0101",
    mobile: "404-555-0199",
    linkedCustomerIds: ["cust_qb"],
  },
  {
    id: "person_accounting",
    firstName: "Pat",
    lastName: "Ledger",
    email: "accounting@titangraphics.com",
    linkedCustomerIds: ["cust_qb"],
  },
  {
    id: "person_move",
    firstName: "Morgan",
    lastName: "Lee",
    email: "morgan@example.com",
    linkedCustomerIds: ["cust_acme", "cust_qb"],
  },
];

const identities: ExternalIdentityLike[] = [
  {
    entityType: "customer",
    entityId: "cust_acme",
    sourceSystem: "infoflo",
    sourceEntityType: "company",
    sourceRecordId: "IF-C-10",
  },
  {
    entityType: "contact",
    entityId: "person_move",
    sourceSystem: "infoflo",
    sourceEntityType: "contact",
    sourceRecordId: "IF-P-20",
  },
];

describe("customer/contact migration matching", () => {
  test("normalizes company legal suffix differences", () => {
    expect(normalizeCompanyName("Titan Graphics, LLC")).toBe("titan graphics");
    expect(normalizeCompanyName("Titan Graphics Incorporated")).toBe("titan graphics");
  });

  test("matches a company by exact QuickBooks customer ID first", () => {
    const result = matchCompany({ name: "Different Name", quickBooksCustomerId: "QB-100" }, companies, identities);
    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("cust_qb");
    expect(result.candidates[0]?.reason).toBe("Existing QuickBooks Customer ID");
  });

  test("does not let normalized name override a different QuickBooks company ID", () => {
    const result = matchCompany({ name: "Titan Graphics LLC", quickBooksCustomerId: "QB-999" }, companies, identities);
    expect(result.status).toBe("ambiguous");
    expect(result.selectedId).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("QuickBooks Customer ID is authoritative");
  });

  test("no-QB source matching a QB-backed company requires reviewed merge", () => {
    const result = matchCompany({ name: "ACME Signs" }, [
      {
        id: "qb_backed_acme",
        companyName: "ACME Signs",
        email: "ap@acmesigns.com",
        phone: "212-555-1000",
        externalAccountingId: "QB-ACME",
      },
    ], []);

    expect(result.status).toBe("ambiguous");
    expect(result.candidates[0]?.reason).toBe("Normalized name requires reviewed QuickBooks identity merge");
  });

  test("matches a rerun company by exact InfoFlo Entry ID", () => {
    const result = matchCompany({ name: "ACME Signs", sourceRecordId: "IF-C-10" }, companies, identities);
    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("cust_acme");
  });

  test("does not auto-merge duplicate normalized company names", () => {
    const result = matchCompany({ name: "Titan Graphics Company" }, companies, identities);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.id).sort()).toEqual(["cust_other_city", "cust_qb"]);
  });

  test("distinguishes duplicate company names in different locations with multi-field evidence", () => {
    const result = matchCompany({
      name: "Titan Graphics",
      phone: "4045552222",
      street1: "99 Vinyl Ave",
      city: "Savannah",
      state: "GA",
      postalCode: "31401",
    }, companies, identities);
    expect(result.status).toBe("ambiguous");
  });

  test("matches a contact by exact normalized non-generic email", () => {
    const result = matchContact({ firstName: "Jane", lastName: "Rivers", email: "jane.rivers@example.com" }, contacts, identities);
    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("person_jane");
  });

  test("does not treat generic shared inboxes as unique person identity", () => {
    expect(isGenericSharedEmail("accounting@titangraphics.com")).toBe(true);
    const result = matchContact({ firstName: "Someone", lastName: "Else", email: "accounting@titangraphics.com" }, contacts, identities);
    expect(result.status).toBe("new");
    expect(result.warnings).toContain("Generic/shared inbox was not used as a unique person identity.");
  });

  test("matches same person moving between companies by InfoFlo identity", () => {
    const result = matchContact({ firstName: "Morgan", lastName: "Lee", sourceRecordId: "IF-P-20", relatedCustomerId: "cust_other_city" }, contacts, identities);
    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("person_move");
  });

  test("matches same person linked to multiple companies by name and related company", () => {
    const result = matchContact({ firstName: "Morgan", lastName: "Lee", relatedCustomerId: "cust_acme" }, contacts, identities);
    expect(result.status).toBe("matched");
    expect(result.selectedId).toBe("person_move");
  });

  test("rejects blank and fake system contacts", () => {
    expect(normalizePersonName("", "", "")).toBeNull();
    expect(normalizePersonName("InfoFlo", "Support")).toBeNull();
    const result = matchContact({ firstName: "InfoFlo", lastName: "Support", email: "support@example.com" }, contacts, identities);
    expect(result.status).toBe("rejected");
  });

  test("maps Main Contact to primary relationship intent", () => {
    expect(relationshipFlagsFromInfoFloType("Main Contact")).toEqual({ isPrimary: true });
    expect(relationshipFlagsFromInfoFloType("Billing")).toEqual({ isPrimary: false });
  });

  test("handles empty database input arrays without throwing", () => {
    expect(matchCompany({ name: "New Co LLC" }, [], []).status).toBe("new");
    expect(matchContact({ firstName: "New", lastName: "Person", email: "new@example.com" }, [], []).status).toBe("new");
  });
});
