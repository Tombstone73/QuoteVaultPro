import { Pool } from "pg";
import { storage } from "../../server/storage.js";
import { assertDevNumberingWriterDiagnosticEnvironment } from "../../server/lib/devNumberingWriterDiagnosticGuard.js";
import { QuoteApplicationService } from "../../v2/src/modules/sales/quoteApplication.js";
import { OrderApplicationService } from "../../v2/src/modules/sales/orderApplication.js";
import type { OperationContext } from "../../v2/src/application/operation.js";
import type { Capability } from "../../v2/src/authorization/capabilities.js";
import { PostgresQuoteTransactionRunner } from "../../v2/infrastructure/sales/postgresQuoteTransaction.js";
import { PostgresOrderTransactionRunner } from "../../v2/infrastructure/sales/postgresOrderTransaction.js";

const INTENT = "RUN_DEV_NUMBERING_WRITER_DIAGNOSTIC";
// This is intentionally short enough for the legacy label and PO fields,
// both of which have a 64-character storage limit.  The explicit run id and
// writer suffix still make every persistent DEV record unambiguously QA-only.
const QA_PREFIX = "QA - Numbering Writer";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const stableIdentifier = /^[A-Za-z0-9_-]{3,120}$/u;
const runIdPattern = /^[A-Za-z0-9_-]{8,24}$/u;

type Args = Readonly<{
  organizationId: string;
  customerId: string;
  contactId: string;
  staffUserId: string;
  sourceQuoteId: string;
  runId: string;
}>;
type DiscoverArgs = Readonly<{ mode: "discover" }>;
type AuditArgs = Readonly<{ mode: "audit"; runId: string }>;
type Template = Readonly<{
  productId: string;
  productName: string;
  productTypeId: string | null;
  quantity: number;
  selections: Readonly<Record<string, unknown>>;
  dimensions?: Readonly<{ width: string; height: string; unit: "in" | "ft" | "mm" }>;
  legacyPrice: string;
}>;
type Counter = Readonly<{ prefix: string; next: number }>;
type Created = Readonly<{ writer: "compatibility" | "v2"; id: string; number: string }>;

const value = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
};
const requireUuid = (name: string): string => {
  const candidate = value(name);
  if (!candidate || !uuid.test(candidate)) throw new Error(`${name} must be an explicit UUID.`);
  return candidate;
};
const requireIdentifier = (name: string): string => {
  const candidate = value(name);
  if (!candidate || !stableIdentifier.test(candidate)) throw new Error(`${name} must be an explicit stable identifier.`);
  return candidate;
};
const parse = (): Args | DiscoverArgs | AuditArgs => {
  if (value("qa-opt-in") !== INTENT) throw new Error("Explicit DEV QA numbering diagnostic opt-in is required.");
  if (value("mode") === "discover") return { mode: "discover" };
  const runId = value("run-id");
  if (!runId || !runIdPattern.test(runId)) throw new Error("run-id must be an explicit safe QA identifier.");
  if (value("mode") === "audit") return { mode: "audit", runId };
  return {
    organizationId: requireIdentifier("organization-id"),
    customerId: requireUuid("customer-id"),
    contactId: requireUuid("contact-id"),
    staffUserId: requireUuid("staff-user-id"),
    sourceQuoteId: requireUuid("source-quote-id"),
    runId,
  };
};
const out = (payload: unknown): void => console.log(JSON.stringify(payload));
const fail = (message: string): never => { throw new Error(message); };

const diagnosticContext = (organizationId: string, requestId: string): OperationContext => ({
  organizationId,
  // Durable operation ids are persisted in a varchar(64) column.  `request`
  // below is intentionally compact so this remains a distinct but bounded
  // canonical request identity for every QA operation.
  operationId: requestId,
  businessRequest: { id: requestId, payloadFingerprint: "derived-by-canonical-sales-operation" },
  principal: {
    kind: "service",
    organizationId,
    clientId: "dev-qa-numbering-writer-diagnostic",
    capabilities: ["quote.view", "quote.create", "order.view", "order.create"] satisfies readonly Capability[],
  },
});

const safeCore = (number: string): number => {
  const match = number.match(/(\d+)$/u);
  if (!match) fail("A writer returned an invalid display number.");
  return Number(match[1]);
};
const safeDimensions = (value: unknown): Template["dimensions"] => {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { width?: unknown; height?: unknown; unit?: unknown };
  const width = typeof candidate.width === "string" ? candidate.width : "";
  const height = typeof candidate.height === "string" ? candidate.height : "";
  const unit = candidate.unit === "ft" || candidate.unit === "mm" ? candidate.unit : "in";
  return width && height ? { width, height, unit } : undefined;
};
const sourceLineInput = (template: Template) => ({
  productId: template.productId,
  description: QA_PREFIX,
  quantity: template.quantity,
  selections: template.selections,
  ...(template.dimensions ? { dimensions: template.dimensions } : {}),
  selling: { kind: "calculated" as const },
});
const legacyLineInput = (template: Template, label: string, omitTaxAmount = false) => ({
  productId: template.productId,
  productName: template.productName,
  productType: template.productTypeId ?? "wide_roll",
  description: label,
  width: Number(template.dimensions?.width ?? 1),
  height: Number(template.dimensions?.height ?? 1),
  quantity: template.quantity,
  linePrice: template.legacyPrice,
  selectedOptions: [],
  optionSelectionsJson: template.selections,
  specsJson: { qaDiagnostic: true, runLabel: label },
  priceBreakdown: {},
  ...(!omitTaxAmount ? { taxAmount: 0 } : {}),
  isTaxableSnapshot: false,
  requiresPrepress: false,
  requiresProofApproval: false,
  requiresDesign: false,
});

async function main(): Promise<void> {
  const parsed = parse();
  assertDevNumberingWriterDiagnosticEnvironment();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12, application_name: "dev-qa-numbering-writer-diagnostic" });
  try {
    if ("mode" in parsed && parsed.mode === "discover") {
      const [fixtures, staff] = await Promise.all([
        pool.query<{
          organization_id: string; customer_id: string; contact_id: string; source_quote_id: string; source_quote_number: string;
        }>(`SELECT d.organization_id,d.customer_id,d.contact_id,d.id AS source_quote_id,d.display_number AS source_quote_number
          FROM v2_sales_documents d
          JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
          JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
          WHERE d.document_kind='quote' AND q.delivery_state='not_sent' AND q.acceptance_state='not_accepted' AND q.lifecycle_state='open'
            AND COALESCE(c.display_name,c.company_name,'') LIKE 'DEV QA -%' AND d.purchase_order_number LIKE 'QA - Numbering%'
          ORDER BY d.updated_at DESC,d.id DESC LIMIT 20`),
        pool.query<{ organization_id: string; staff_user_id: string }>(`SELECT membership.organization_id,membership.user_id AS staff_user_id
          FROM user_organizations membership
          WHERE membership.organization_id IN (
            SELECT DISTINCT d.organization_id FROM v2_sales_documents d
            JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
            JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
            WHERE d.document_kind='quote' AND q.delivery_state='not_sent' AND q.acceptance_state='not_accepted' AND q.lifecycle_state='open'
              AND COALESCE(c.display_name,c.company_name,'') LIKE 'DEV QA -%' AND d.purchase_order_number LIKE 'QA - Numbering%'
          ) ORDER BY membership.organization_id,membership.user_id LIMIT 50`),
      ]);
      out({ ok: true, mode: "discover", fixtures: fixtures.rows, staff: staff.rows });
      return;
    }
    if ("mode" in parsed && parsed.mode === "audit") {
      const marker = `%${parsed.runId}%`;
      const [legacyQuotes, legacyOrders, v2Documents] = await Promise.all([
        pool.query<{ id: string; number: string; line_count: string }>(`SELECT q.id,COALESCE(q.display_number,CONCAT('QT-',q.quote_number::text)) AS number,count(li.id)::text AS line_count
          FROM quotes q LEFT JOIN quote_line_items li ON li.quote_id=q.id
          WHERE q.label LIKE $1 GROUP BY q.id,q.display_number,q.quote_number ORDER BY q.id`, [marker]),
        pool.query<{ id: string; number: string; line_count: string }>(`SELECT o.id,COALESCE(o.display_number,CONCAT('ORD-',o.order_number::text)) AS number,count(li.id)::text AS line_count
          FROM orders o LEFT JOIN order_line_items li ON li.order_id=o.id
          WHERE o.label LIKE $1 GROUP BY o.id,o.display_number,o.order_number ORDER BY o.id`, [marker]),
        pool.query<{ id: string; number: string; kind: string; line_count: string; invoice_count: string; route_count: string }>(`SELECT d.id,d.display_number AS number,d.document_kind AS kind,count(DISTINCT l.id)::text AS line_count,
            count(DISTINCT i.id)::text AS invoice_count,count(DISTINCT r.id)::text AS route_count
          FROM v2_sales_documents d
          LEFT JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
          LEFT JOIN v2_billing_invoices i ON i.organization_id=d.organization_id AND i.sales_order_document_id=d.id
          LEFT JOIN v2_route_instances r ON r.organization_id=d.organization_id AND r.order_document_id=d.id
          WHERE d.purchase_order_number LIKE $1 GROUP BY d.id,d.display_number,d.document_kind ORDER BY d.document_kind,d.id`, [marker]),
      ]);
      out({ ok: true, mode: "audit", runId: parsed.runId, legacyQuotes: legacyQuotes.rows, legacyOrders: legacyOrders.rows, v2Documents: v2Documents.rows });
      return;
    }
    const args = parsed;
    const [customer, staff, source] = await Promise.all([
      pool.query<{ id: string; display_name: string | null; company_name: string | null }>("SELECT id,display_name,company_name FROM customers WHERE organization_id=$1 AND id=$2", [args.organizationId, args.customerId]),
      pool.query<{ id: string }>("SELECT u.id FROM users u JOIN user_organizations membership ON membership.user_id=u.id WHERE membership.organization_id=$1 AND u.id=$2", [args.organizationId, args.staffUserId]),
      pool.query<{
        customer_id: string; contact_id: string | null; purchase_order_number: string | null; product_id: string; product_name: string; product_type_id: string | null; quantity: number; resolved_configuration: unknown; selling_line_cents: string;
      }>(`SELECT d.customer_id,d.contact_id,d.purchase_order_number,l.product_id,p.name AS product_name,p.product_type_id,l.quantity,l.resolved_configuration,l.selling_line_cents
        FROM v2_sales_documents d
        JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
        JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
        JOIN products p ON p.organization_id=l.organization_id AND p.id=l.product_id
        WHERE d.organization_id=$1 AND d.id=$2 AND d.document_kind='quote' AND q.delivery_state='not_sent' AND q.acceptance_state='not_accepted' AND q.lifecycle_state='open'
        ORDER BY l.position,l.id LIMIT 1`, [args.organizationId, args.sourceQuoteId]),
    ]);
    const customerName = customer.rows[0]?.display_name ?? customer.rows[0]?.company_name ?? "";
    if (!customer.rows[0] || !customerName.startsWith("DEV QA -")) fail("The supplied Customer is not an explicitly labelled DEV QA fixture.");
    if (!staff.rows[0]) fail("The supplied Staff actor is not a member of the explicit DEV tenant.");
    const sourceRow = source.rows[0];
    if (!sourceRow || sourceRow.customer_id !== args.customerId || sourceRow.contact_id !== args.contactId || !sourceRow.purchase_order_number?.startsWith("QA - Numbering")) {
      fail("The supplied source Quote is not the explicit open QA numbering fixture for this Customer and Contact.");
    }
    const configuration = sourceRow.resolved_configuration as { selections?: unknown; dimensions?: unknown };
    if (!configuration || typeof configuration !== "object" || !configuration.selections || typeof configuration.selections !== "object") {
      fail("The supplied QA Quote line does not have canonical configuration evidence.");
    }
    const template: Template = {
      productId: sourceRow.product_id,
      productName: sourceRow.product_name,
      productTypeId: sourceRow.product_type_id,
      quantity: sourceRow.quantity,
      selections: configuration.selections as Readonly<Record<string, unknown>>,
      ...(safeDimensions(configuration.dimensions) ? { dimensions: safeDimensions(configuration.dimensions) } : {}),
      legacyPrice: (Number(sourceRow.selling_line_cents) / 100).toFixed(2),
    };
    if (!Number.isFinite(Number(template.legacyPrice)) || Number(template.legacyPrice) < 0) fail("The QA source Quote has no safe persisted commercial amount.");

    const readCounter = async (kind: "quote" | "order"): Promise<Counter> => {
      const row = (await pool.query<{ display_prefix: string; next_number: string }>("SELECT display_prefix,next_number::text FROM v2_sales_document_number_counters WHERE organization_id=$1 AND document_kind=$2", [args.organizationId, kind])).rows[0];
      if (!row || !/^\d+$/u.test(row.next_number)) fail(`Canonical ${kind} counter is unavailable.`);
      return { prefix: row.display_prefix, next: Number(row.next_number) };
    };
    const [baselineQuote, baselineOrder] = await Promise.all([readCounter("quote"), readCounter("order")]);
    const quoteService = new QuoteApplicationService(new PostgresQuoteTransactionRunner(pool));
    const orderService = new OrderApplicationService(new PostgresOrderTransactionRunner(pool));
    const request = (kind: string) => `nwd:${args.runId}:${kind}`;

    const createCompatibilityQuote = async (suffix: string, omitTaxAmount = false): Promise<Created> => {
      const label = `${QA_PREFIX} Quote ${args.runId} ${suffix}`;
      const quote = await storage.createQuote(args.organizationId, {
        userId: args.staffUserId,
        customerId: args.customerId,
        contactId: args.contactId,
        source: "dev_numbering_writer_diagnostic",
        status: "draft",
        label,
        lineItems: [legacyLineInput(template, label, omitTaxAmount)] as any,
      });
      if (!quote.id || !quote.displayNumber) fail("Compatibility Quote writer did not return a persisted document identity.");
      return { writer: "compatibility", id: quote.id, number: quote.displayNumber };
    };
    const createV2Quote = async (suffix: string, requestId = request(`quote-${suffix}`)): Promise<Created> => {
      const result = await quoteService.create(diagnosticContext(args.organizationId, requestId), {
        businessRequestId: requestId,
        customerContact: { organizationId: args.organizationId, customerId: args.customerId, contactId: args.contactId },
        purchaseOrderNumber: `${QA_PREFIX} Quote ${args.runId} ${suffix}`,
        terms: { commercialNotes: `${QA_PREFIX}; no delivery or lifecycle transition.` },
        lines: [sourceLineInput(template)],
      });
      if (!result.ok) throw result.error;
      return { writer: "v2", id: result.value.quote.quote.quoteId, number: result.value.quote.number.display };
    };
    const createCompatibilityOrder = async (suffix: string): Promise<Created> => {
      const order = await storage.createOrder(args.organizationId, {
        customerId: args.customerId,
        contactId: args.contactId,
        createdByUserId: args.staffUserId,
        poNumber: `${QA_PREFIX} Order ${args.runId} ${suffix}`,
        label: `${QA_PREFIX} Order ${args.runId} ${suffix}`,
        status: "new",
        notesInternal: `${QA_PREFIX}; deferred production intake; no delivery, payment, or fulfillment.`,
        productionIntakePolicy: "deferred",
        lineItems: [legacyLineInput(template, `${QA_PREFIX} Order ${args.runId} ${suffix}`)] as any,
      });
      if (!order.id || !order.displayNumber) fail("Compatibility Order writer did not return a persisted document identity.");
      return { writer: "compatibility", id: order.id, number: order.displayNumber };
    };
    const createV2Order = async (suffix: string, requestId = request(`order-${suffix}`)): Promise<Created> => {
      const result = await orderService.create(diagnosticContext(args.organizationId, requestId), {
        businessRequestId: requestId,
        customerContact: { organizationId: args.organizationId, customerId: args.customerId, contactId: args.contactId },
        purchaseOrderNumber: `${QA_PREFIX} Order ${args.runId} ${suffix}`,
        terms: { commercialNotes: `${QA_PREFIX}; no delivery, payment, fulfillment, or Production mutation.` },
        lines: [{ ...sourceLineInput(template), clientLineKey: `qa_${suffix.replace(/[^A-Za-z0-9_-]/gu, "_")}` }],
      });
      if (!result.ok) throw result.error;
      return { writer: "v2", id: result.value.order.order.orderId, number: result.value.order.number.display };
    };

    const rollbackProbeLabel = `${QA_PREFIX} Quote ${args.runId} rb`;
    const rollbackProbeBefore = await readCounter("quote");
    let rollbackProbeRejected = false;
    try {
      await createCompatibilityQuote("rb", true);
    } catch {
      rollbackProbeRejected = true;
    }
    const [rollbackProbeAfter, rollbackProbeRows] = await Promise.all([
      readCounter("quote"),
      pool.query<{ count: string }>("SELECT count(*)::text AS count FROM quotes WHERE organization_id=$1 AND label=$2", [args.organizationId, rollbackProbeLabel]),
    ]);
    if (!rollbackProbeRejected || rollbackProbeAfter.next !== rollbackProbeBefore.next || rollbackProbeRows.rows[0]?.count !== "0") {
      fail("Compatibility Quote rollback probe did not atomically reject the invalid line without persisting a header or consuming a number.");
    }

    const compatibilityQuote = await createCompatibilityQuote("c");
    const followingV2Quote = await createV2Quote("v");
    const quoteReplayRequest = request("quote-replay");
    const quoteReplayFirst = await createV2Quote("r", quoteReplayRequest);
    const quoteReplaySecond = await createV2Quote("r", quoteReplayRequest);
    if (quoteReplayFirst.id !== quoteReplaySecond.id || quoteReplayFirst.number !== quoteReplaySecond.number) fail("Quote durable replay created a second logical result.");
    const [concurrentCompatibilityQuote, concurrentV2Quote] = await Promise.all([
      createCompatibilityQuote("cc"),
      createV2Quote("cv"),
    ]);

    const compatibilityOrder = await createCompatibilityOrder("c");
    const followingV2Order = await createV2Order("v");
    const orderReplayRequest = request("order-replay");
    const orderReplayFirst = await createV2Order("r", orderReplayRequest);
    const orderReplaySecond = await createV2Order("r", orderReplayRequest);
    if (orderReplayFirst.id !== orderReplaySecond.id || orderReplayFirst.number !== orderReplaySecond.number) fail("Order durable replay created a second logical result.");
    const [concurrentCompatibilityOrder, concurrentV2Order] = await Promise.all([
      createCompatibilityOrder("cc"),
      createV2Order("cv"),
    ]);

    const quoteRows = [compatibilityQuote, followingV2Quote, quoteReplayFirst, concurrentCompatibilityQuote, concurrentV2Quote];
    const orderRows = [compatibilityOrder, followingV2Order, orderReplayFirst, concurrentCompatibilityOrder, concurrentV2Order];
    const assertUnique = (kind: string, rows: readonly Created[]) => {
      if (new Set(rows.map((row) => row.number)).size !== rows.length) fail(`${kind} diagnostic writers returned a duplicate display number.`);
      if (rows.some((row) => !Number.isSafeInteger(safeCore(row.number)))) fail(`${kind} diagnostic writer returned an invalid number.`);
    };
    assertUnique("Quote", quoteRows);
    assertUnique("Order", orderRows);
    const [finalQuote, finalOrder, duplicateQuoteNumbers, duplicateOrderNumbers, invoicePoReadiness] = await Promise.all([
      readCounter("quote"),
      readCounter("order"),
      pool.query<{ display_number: string }>(`SELECT display_number FROM (
        SELECT display_number FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='quote'
        UNION ALL SELECT COALESCE(display_number, CONCAT('QT-', quote_number::text)) FROM quotes WHERE organization_id=$1
      ) numbers GROUP BY display_number HAVING count(*) > 1`, [args.organizationId]),
      pool.query<{ display_number: string }>(`SELECT display_number FROM (
        SELECT display_number FROM v2_sales_documents WHERE organization_id=$1 AND document_kind='order'
        UNION ALL SELECT COALESCE(display_number, CONCAT('ORD-', order_number::text)) FROM orders WHERE organization_id=$1
      ) numbers GROUP BY display_number HAVING count(*) > 1`, [args.organizationId]),
      pool.query<{ kind: string; ownership: string }>("SELECT document_kind AS kind, ownership FROM v2_document_numbering_readiness WHERE organization_id=$1 AND document_kind IN ('invoice','purchase_order') ORDER BY document_kind", [args.organizationId]).catch(() => ({ rows: [] })),
    ]);
    if (duplicateQuoteNumbers.rows.length || duplicateOrderNumbers.rows.length) fail("A duplicate tenant-visible Quote or Order number exists after diagnostic allocation.");
    if (finalQuote.next <= Math.max(...quoteRows.map((row) => safeCore(row.number))) || finalOrder.next <= Math.max(...orderRows.map((row) => safeCore(row.number)))) fail("A canonical counter did not advance beyond its diagnostic allocations.");

    out({
      ok: true,
      runId: args.runId,
      baseline: { quote: baselineQuote, order: baselineOrder },
      compatibilityFailureRollback: { rejected: true, counterUnchanged: true, noPersistedQuoteHeader: true },
      quotes: { compatibility: compatibilityQuote, followingV2: followingV2Quote, replay: { first: quoteReplayFirst, second: quoteReplaySecond, sameResult: true }, concurrent: [concurrentCompatibilityQuote, concurrentV2Quote] },
      orders: { compatibility: compatibilityOrder, followingV2: followingV2Order, replay: { first: orderReplayFirst, second: orderReplaySecond, sameResult: true }, concurrent: [concurrentCompatibilityOrder, concurrentV2Order] },
      final: { quote: finalQuote, order: finalOrder },
      duplicateTenantVisibleNumbers: { quotes: 0, orders: 0 },
      compatibilityManaged: invoicePoReadiness.rows,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  out({ ok: false, error: error instanceof Error ? error.message : "DEV numbering writer diagnostic failed." });
  process.exitCode = 1;
});
