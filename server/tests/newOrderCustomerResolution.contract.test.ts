import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

import { buildDirectOrderPayloadFromEditorState } from "../../client/src/features/quotes/editor/directOrderPayload";
import { getBestMatchingCustomerContact, sortCustomersForSearch } from "../../client/src/lib/customerSearchRanking";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("new order customer/contact resolution contract", () => {
  test("keeps company ownership while returning the linked contact that matched the customer search", () => {
    const graphicSolutions = {
      id: "graphic-solutions",
      companyName: "Graphic Solutions",
      contacts: [{ id: "rick-clark", firstName: "Rick", lastName: "Clark" }],
    };

    for (const query of ["graphic", "graphic s", "graphic so", "graphic sol", "graphic solu"]) {
      expect(sortCustomersForSearch([
        { id: "weak", companyName: `Metro ${query}` },
        graphicSolutions,
      ], query)[0]?.id).toBe("graphic-solutions");
    }
    expect(getBestMatchingCustomerContact(graphicSolutions, "rick clark")).toMatchObject({ id: "rick-clark" });

    const payload = buildDirectOrderPayloadFromEditorState({
      selectedCustomer: { id: "stale-customer", companyName: "Rick Clark" } as any,
      selectedCustomerId: "graphic-solutions",
      selectedContactId: "rick-clark",
      lineItems: [], subtotal: 0, effectiveTaxRate: 0, taxAmount: 0, effectiveDiscount: 0,
      jobLabel: "", orderPoNumber: "", requestedDueDate: "", orderPromisedDate: "", orderPriority: "normal",
      orderInternalNotes: "", deliveryMethod: "pickup", shippingCents: null, quoteNotes: "",
    });
    expect(payload).toMatchObject({ customerId: "graphic-solutions", contactId: "rick-clark" });
  });

  test("normalizes identity before direct-order tax, snapshot, and persistence work", () => {
    const routes = read("server/routes/orders.routes.ts");
    const editorState = read("client/src/features/quotes/editor/useQuoteEditorState.ts");
    const ordersList = read("client/src/pages/orders.tsx");

    const resolutionIndex = routes.indexOf("const resolvedIdentity = await resolveOrderCustomerContactIds({");
    const taxLookupIndex = routes.indexOf("// Load organization for tax settings");
    expect(resolutionIndex).toBeGreaterThan(-1);
    expect(resolutionIndex).toBeLessThan(taxLookupIndex);
    expect(routes).toContain("orderFields.customerId = resolvedIdentity.customerId;");
    expect(routes).toContain("orderFields.contactId = resolvedIdentity.contactId;");
    expect(editorState).toContain("resolveOrderCustomerIdFromContact(selectedCustomerId, contact)");
    expect(ordersList).toContain("row.customer?.companyName || [row.contact?.firstName, row.contact?.lastName]");
  });
});
