import { describe, expect, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { capabilityIds } from "../../src/authorization/capabilities";

describe("M1.10 Quote to Order conversion contract", () => {
  test("uses the explicit conversion capability rather than order-create authority", () => {
    expect(capabilityIds).toContain("quote.convert");
  });

  test("acceptance creates the accepted checkpoint and canonical Order in one transaction without recalculating pricing", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    expect(source).toMatch(/async accept\(context: OperationContext, input: QuoteLifecycleInput\)/);
    expect(source).toMatch(/createQuoteLifecycleCheckpoint\(current\.quote, "accept"/);
    expect(source).toMatch(/snapshotAccepted\(context\.organizationId, input\.quoteId, checkpoint\.checkpointId\)/);
    expect(source).toMatch(/convertAccepted\(\{ quote, order, artwork \}, context, reservation\.request\.id, accepted, checkpoint/);
    expect(source).toMatch(/succeedConversion\(context\.organizationId, reservation\.request\.id/);
    expect(source).toMatch(/source\.kind !== "quote_accepted"/);
    expect(source).toMatch(/sourceToOrderLine\.set\(line\.lineId, orderLine\.lineId\)/);
    expect(source).toMatch(/carryAcceptedToOrder/);
    expect(source).toMatch(/createFromCommercialSnapshot/);
    expect(source).not.toMatch(/\.pricing\.calculate\(/);
    expect(source).not.toMatch(/resolveActivePricingInput/);
  });

  test("acceptance uses an opaque plaintext trace without changing its response contract", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    expect(source).toMatch(/V2_QUOTE_CONVERSION_TRACE request=\$\{requestId\} stage=\$\{stage\} result=\$\{result\}/);
    expect(source).toMatch(/durableRequestClassification/);
    expect(source).toMatch(/trace\?\.event\("transaction", "committed"\)/);
    expect(source).toMatch(/trace\?\.event\("transaction", "rolled_back"\)/);
    expect(source).not.toMatch(/V2_QUOTE_CONVERSION_TRACE[\s\S]{0,300}(customer|email|token|cookie|sql)/i);
  });

  test("accepted and converted commercial evidence remains pinned to the sent tax composition", async () => {
    const quote = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const conversion = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");

    // The sent checkpoint captures the exact composition committed at the
    // customer-document boundary.  Acceptance and conversion consume that
    // evidence rather than consulting mutable tenant tax settings again.
    expect(quote).toMatch(/quote\.taxComposition \? \{ taxComposition: quote\.taxComposition \} : \{\}/);
    expect(conversion).toMatch(/taxComposition: source\.commercial\.taxComposition/);
    expect(conversion).toMatch(/commercial: source\.commercial/);
    expect(conversion).not.toMatch(/composePostgresSalesTax|resolveTaxJurisdiction|TaxSettings/);
  });

  test("duplicating a Quote creates a fresh mutable document without copying its frozen tax snapshot", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const duplicate = source.slice(source.indexOf("async duplicate("), source.indexOf("async update(", source.indexOf("async duplicate(")));

    expect(duplicate).toMatch(/await tx\.create\(/);
    expect(duplicate).not.toMatch(/taxComposition:/);
    expect(duplicate).not.toMatch(/convertedOrderId/);
  });

  test("the normal Quote HTTP and UI flows do not expose standalone acceptance or conversion", async () => {
    const routes = await readFile(path.join(process.cwd(), "v2", "src", "interfaces", "http", "quoteRoutes.ts"), "utf8");
    const ui = await readFile(path.join(process.cwd(), "v2", "ui", "src", "App.tsx"), "utf8");
    expect(routes).toMatch(/dependencies\.conversion\.accept/);
    expect(routes).not.toMatch(/dependencies\.service\[action\]/);
    expect(ui).toMatch(/Accept Quote &amp; Create Order/);
    expect(ui).not.toMatch(/>Convert to Order</);
  });

  test("the canonical Order core is shared and does not reserve an operation request", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    const core = source.slice(source.indexOf("async createFromCommercialSnapshot"), source.indexOf("async read(", source.indexOf("async createFromCommercialSnapshot")));
    expect(core).toMatch(/materialRequirements\.freeze/);
    expect(core.indexOf("materialRequirements.freeze")).toBeLessThan(core.indexOf("createDraftInvoice"));
    expect(core).toMatch(/createDraftInvoice/);
    expect(core).toMatch(/instantiateRoutes/);
    expect(core).toMatch(/resolveOrderRoutability/);
    expect(core).toMatch(/not fully configured for production routing/);
    expect(core).not.toMatch(/\.reserve\(/);
    expect(core).not.toMatch(/\.pricing\.calculate\(/);
  });

  test("Order construction retains bounded persistence-stage diagnostics", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    expect(source).toMatch(/trace\?\.event\("routing_resolution", "started"\)/);
    expect(source).toMatch(/trace\?\.event\("draft_invoice", "started"\)/);
    expect(source).toMatch(/trace\?\.failure\(stage, cause\)/);
  });

  test("Quote send readiness and send both reject unroutable production lines before a document freeze or provider preparation", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteDelivery.ts"), "utf8");
    const send = source.slice(source.indexOf("async send("), source.indexOf("private async prepare("));
    const prepare = source.slice(source.indexOf("private async prepare("), source.indexOf("private async routability("));

    expect(source).toMatch(/resolveOrderRoutability/);
    expect(source).toMatch(/routability: Readonly<\{ status: "ready" \| "unroutable"/);
    expect(send).toMatch(/await this\.requireRoutability/);
    expect(send.indexOf("requireRoutability")).toBeLessThan(send.indexOf("integrations.requireReady"));
    expect(send.indexOf("requireRoutability")).toBeLessThan(send.indexOf("this.prepare"));
    expect(prepare).toMatch(/await this\.requireRoutability/);
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("quoteRecipientInTransaction"));
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("renderCustomerSalesPdf"));
  });

  test("conversion has one same-client orchestration boundary and no V1 or HTTP dependency", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteConversionTransaction.ts"), "utf8");
    expect(source).not.toMatch(/express|server\/|v2-poc|PricingService/);
    expect(transaction).toMatch(/BEGIN/);
    expect(transaction).toMatch(/PostgresQuoteTransaction/);
    expect(transaction).toMatch(/PostgresOrderTransaction/);
  });

  test("freezes expected material requirements inside the same PostgreSQL conversion boundary", async () => {
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderTransaction.ts"), "utf8");
    const requirements = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderMaterialRequirements.ts"), "utf8");
    expect(transaction).toMatch(/afterMaterialRequirements/);
    expect(requirements).toMatch(/v2_order_line_material_requirements/);
    expect(requirements).toMatch(/ON CONFLICT\(organization_id,order_line_id,source_definition_id\) DO NOTHING/);
    expect(requirements).toMatch(/resolvedConfiguration\.pricingConfigurationId/);
    expect(requirements).toMatch(/inventoryConsumption/);
  });
});
