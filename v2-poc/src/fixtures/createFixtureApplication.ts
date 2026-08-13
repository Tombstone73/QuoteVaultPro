import { InvoiceRepository } from "../billing/invoiceRepository";
import { InMemoryV2Database } from "../infrastructure/inMemoryV2Database";
import { CreateOrderApplicationOperation } from "../orders/createOrder";
import { ReadOrderApplicationQuery } from "../orders/readOrder";
import { V1Pbv2CompatibilityPricingAdapter } from "../pricing/canonicalPricingAdapter";

const standardTree = {
  schemaVersion: 2,
  rootNodeIds: ["finish"],
  nodes: {
    finish: {
      id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish" },
      choices: [
        { value: "standard", label: "Standard" },
        { value: "laminated", label: "Laminated", pricingImpact: [{ mode: "addCents", cents: 50 }] },
      ],
    },
  },
  meta: { pricingV2: { base: { perPieceCents: 1000 } } },
};

export function createFixtureDatabase(): InMemoryV2Database {
  return new InMemoryV2Database({
    memberships: [
      { actorId: "owner-a", organizationId: "org-a", role: "owner" },
      { actorId: "employee-a", organizationId: "org-a", role: "employee" },
      { actorId: "member-a", organizationId: "org-a", role: "member" },
      { actorId: "owner-b", organizationId: "org-b", role: "owner" },
    ],
    customers: [
      { id: "customer-a-taxable", organizationId: "org-a", name: "Alpha Print", taxExempt: false },
      { id: "customer-a-exempt", organizationId: "org-a", name: "Alpha Exempt", taxExempt: true },
      { id: "customer-b", organizationId: "org-b", name: "Bravo Print", taxExempt: false },
    ],
    products: [
      { id: "product-a-taxable", organizationId: "org-a", name: "A-frame sign", activeTreeVersionId: "tree-a-1", treeJson: standardTree, baseUnitPriceCents: 1000, taxable: true },
      { id: "product-a-nontaxable", organizationId: "org-a", name: "Design service", activeTreeVersionId: "tree-a-2", treeJson: standardTree, baseUnitPriceCents: 500, taxable: false },
      { id: "product-b", organizationId: "org-b", name: "Bravo secret", activeTreeVersionId: "tree-b-1", treeJson: standardTree, baseUnitPriceCents: 9999, taxable: true },
    ],
    taxRateBasisPointsByOrganization: { "org-a": 800, "org-b": 500 },
  });
}

export function createFixtureApplication(database = createFixtureDatabase(), invoices = new InvoiceRepository()) {
  return {
    database,
    invoices,
    operation: new CreateOrderApplicationOperation(database, new V1Pbv2CompatibilityPricingAdapter(), invoices),
    readOrder: new ReadOrderApplicationQuery(database, invoices),
  };
}
