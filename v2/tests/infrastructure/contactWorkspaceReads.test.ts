import { describe, expect, test } from "@jest/globals";
import { PostgresContactWorkspaceReader } from "../../infrastructure/compatibility/postgresContactWorkspaceRead";

const row = { contact_id: "contact-a", first_name: "Ada", last_name: "Lovelace", email: "ada@acme.test", phone: "555-0111", customer_id: "customer-a", customer_name: "Acme", is_primary: true };

describe("Contacts workspace PostgreSQL projection", () => {
  test("uses active tenant-scoped relationship reads, SQL search, bounded list, and an aggregate", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresContactWorkspaceReader({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: text.includes("count(*)") ? [{ total: "1", accounts: "1" }] as T[] : [row] as T[] }; } } as any);
    await expect(reader.list("org-a", "Ada")).resolves.toEqual({ items: [expect.objectContaining({ contactId: "contact-a", customerId: "customer-a", primary: true })], total: 1, accounts: 1 });
    expect(calls).toHaveLength(2);
    for (const call of calls) { expect(call.text).toContain("l.organization_id = $1"); expect(call.text).toContain("customer_contact_links"); expect(call.values).toEqual(["org-a", "%Ada%"]); }
    expect(calls[0]!.text).toContain("LIMIT 500");
  });
  test("reads a Contact only through its active tenant-scoped Customer relationship", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const detailRow = { ...row, display_name: "Acme", company_name: "Acme Printing", billing_street1: "1 Main Street", billing_street2: null, billing_city: "Boston", billing_state: "MA", billing_postal_code: "02110", billing_country: "US", shipping_street1: null, shipping_street2: null, shipping_city: null, shipping_state: null, shipping_postal_code: null, shipping_country: null };
    const responses = [[detailRow], [row]];
    const reader = new PostgresContactWorkspaceReader({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: (responses.shift() ?? []) as T[] }; } } as any);
    await expect(reader.read("org-a", "contact-a")).resolves.toMatchObject({ contactId: "contact-a", customerId: "customer-a", relatedContacts: [{ contactId: "contact-a" }] });
    expect(calls[0]!.text).toContain("l.organization_id = $1 AND ct.id = $2");
    expect(calls[1]!.text).toContain("l.organization_id = $1 AND l.customer_id = $2");
    expect(calls[0]!.values).toEqual(["org-a", "contact-a"]);
  });
});
