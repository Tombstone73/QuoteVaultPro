import { describe, expect, test } from "@jest/globals";
import { PostgresCustomerWorkspaceReader } from "../../infrastructure/compatibility/postgresCustomerWorkspaceRead";

const customer = { id: "customer-a", display_name: "Acme", company_name: "Acme Printing", email: "billing@acme.test", phone: "555-0100", billing_street1: null, billing_street2: null, billing_city: null, billing_state: null, billing_postal_code: null, billing_country: null, shipping_street1: null, shipping_street2: null, shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null };
const linkedContact = { id: "contact-a", first_name: "Ada", last_name: "Lovelace", email: "ada@acme.test", phone: "555-0111" };

describe("M4 Customer workspace PostgreSQL projection", () => {
  test("binds active organization scope, searches canonical Customer/Contact facts, and bounds the catalog", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresCustomerWorkspaceReader({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [{ customer_id: "customer-a", display_name: "Acme", company_name: "Acme Printing", email: "billing@acme.test", phone: "555-0100", contact_id: "contact-a", contact_first_name: "Ada", contact_last_name: "Lovelace", contact_email: "ada@acme.test", contact_phone: "555-0111", contact_is_primary: true }] as T[] }; } } as any);
    await expect(reader.list("org-a", "Ada")).resolves.toMatchObject([{ customerId: "customer-a", primaryContact: { contactId: "contact-a", displayName: "Ada Lovelace", primary: true } }]);
    expect(calls[0]!.text).toContain("c.organization_id = $1");
    expect(calls[0]!.text).toContain("customer_contact_links");
    expect(calls[0]!.text).toContain("l.is_primary DESC");
    expect(calls[0]!.text).toContain("LIMIT 100");
    expect(calls[0]!.values).toEqual(["org-a", "%Ada%"]);
  });
  test("reads Contacts only through the active tenant-scoped Customer relationship", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const responses = [[customer], [customer], [{ ...linkedContact, is_primary: true }]];
    const reader = new PostgresCustomerWorkspaceReader({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: (responses.shift() ?? []) as T[] }; } } as any);
    await expect(reader.read("org-a", "customer-a")).resolves.toMatchObject({ customerId: "customer-a", contacts: [{ contactId: "contact-a", displayName: "Ada Lovelace" }] });
    expect(calls[2]!.text).toContain("l.organization_id = $1 AND l.customer_id = $2");
    expect(calls[2]!.text).toContain("JOIN customers c ON c.organization_id = l.organization_id AND c.id = l.customer_id");
    expect(calls[2]!.text).toContain("l.is_primary DESC");
    expect(calls[2]!.values).toEqual(["org-a", "customer-a"]);
  });
});
