import {
  customerMatchesSearch,
  getCustomerSearchRank,
  sortCustomersForSearch,
  type CustomerSearchCandidate,
} from "./customerSearchRanking";

describe("customer search ranking", () => {
  const graphicSolutions: CustomerSearchCandidate = {
    id: "graphic-solutions",
    companyName: "Graphic Solutions",
    email: "orders@graphicsolutions.example",
  };

  test("prioritizes exact, prefix, word-prefix, and substring company matches", () => {
    const customers: CustomerSearchCandidate[] = [
      { id: "substring", companyName: "Metrographic Printing" },
      { id: "word-prefix", companyName: "Metro Graphic Solutions" },
      graphicSolutions,
      { id: "exact", companyName: "Graphic" },
    ];

    expect(sortCustomersForSearch(customers, "graphic").map((customer) => customer.id)).toEqual([
      "exact",
      "graphic-solutions",
      "word-prefix",
      "substring",
    ]);
    expect(getCustomerSearchRank(graphicSolutions, "graphic sol")).toBe(1);
  });

  test("preserves customer email and linked contact matches below direct company-name matches", () => {
    const contactMatch: CustomerSearchCandidate = {
      id: "contact-match",
      companyName: "Metro Signs",
      contacts: [{ firstName: "Graphic", lastName: "Solutions", email: "rick@example.com" }],
    };

    expect(customerMatchesSearch(contactMatch, "rick")).toBe(true);
    expect(sortCustomersForSearch([contactMatch, graphicSolutions], "graphic").map((customer) => customer.id)).toEqual([
      "graphic-solutions",
      "contact-match",
    ]);
    expect(customerMatchesSearch(graphicSolutions, "orders@graphicsolutions.example")).toBe(true);
  });
});
