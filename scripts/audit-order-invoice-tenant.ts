import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";

import { scopedFleetInvoice } from "../server/lib/financialRepairTenantScope";
import { computeInvoicePaymentRollup } from "../shared/rollups/invoicePaymentRollup";

const prefix = "--organization-id=";
const organizationId = process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;

function cents(value: unknown) {
  return Math.round(Number(value ?? 0) * 100);
}

async function main() {
  if (!organizationId) throw new Error("Read-only fleet audit requires explicit --organization-id=<uuid>.");
  if (process.argv.includes("--apply")) throw new Error("This fleet audit never applies mutations.");
  const [{ db }, schema, financials] = await Promise.all([import("../server/db"), import("../shared/schema"), import("../server/invoicesService")]);
  const { invoiceLineItems, invoices, orderLineItems, orders, organizations, payments } = schema;
  const target = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(eq(organizations.id, organizationId));
  if (target.length !== 1) throw new Error("Target organization must resolve exactly once by ID.");
  console.log("[order-invoice-audit] target", JSON.stringify({ organizationId, organizationName: target[0]!.name, mode: "DRY_RUN_READ_ONLY" }));

  const roots = await db.select({ invoice: invoices, order: orders })
    .from(invoices)
    .innerJoin(orders, and(eq(orders.id, invoices.orderId), eq(orders.organizationId, organizationId)))
    .where(and(
      scopedFleetInvoice(organizationId),
      sql`lower(${invoices.status}) not in ('void', 'voided')`,
      sql`${invoices.importSource} is null`,
      eq(invoices.isHistorical, false),
    ));
  console.log("[order-invoice-audit] candidateCountsByOrganization", JSON.stringify({ [organizationId]: roots.length }));
  if (roots.some((row) => row.invoice.organizationId !== organizationId || row.order.organizationId !== organizationId)) {
    throw new Error("Cross-organization root row detected; audit refused.");
  }
  const orderLinesById = new Map<string, any[]>();
  const invoiceLinesById = new Map<string, any[]>();
  const paymentsByInvoiceId = new Map<string, any[]>();

  for (let start = 0; start < roots.length; start += 200) {
    const group = roots.slice(start, start + 200);
    const orderIds = group.map((row) => row.order.id);
    const invoiceIds = group.map((row) => row.invoice.id);
    const [orderLines, invoiceLines, paymentRows] = await Promise.all([
      db.select().from(orderLineItems).where(and(
        inArray(orderLineItems.orderId, orderIds),
        sql`exists (select 1 from ${orders} where ${orders.id} = ${orderLineItems.orderId} and ${orders.organizationId} = ${organizationId})`,
      )),
      db.select().from(invoiceLineItems).where(and(
        inArray(invoiceLineItems.invoiceId, invoiceIds),
        sql`exists (select 1 from ${invoices} where ${invoices.id} = ${invoiceLineItems.invoiceId} and ${invoices.organizationId} = ${organizationId})`,
      )),
      db.select().from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds))),
    ]);
    for (const line of orderLines) orderLinesById.set(line.orderId, [...(orderLinesById.get(line.orderId) ?? []), line]);
    for (const line of invoiceLines) invoiceLinesById.set(line.invoiceId, [...(invoiceLinesById.get(line.invoiceId) ?? []), line]);
    for (const payment of paymentRows) {
      if (!payment.invoiceId) continue;
      paymentsByInvoiceId.set(payment.invoiceId, [...(paymentsByInvoiceId.get(payment.invoiceId) ?? []), payment]);
    }
  }

  const summary = { scanned: roots.length, clean: 0, staleLines: 0, missingLines: 0, lineAmountMismatch: 0, headerMismatch: 0, orderInvoiceMismatch: 0, paymentMismatch: 0, historicalReview: 0 };
  const exceptions: any[] = [];
  for (const { invoice, order } of roots) {
    const canonical = financials.buildOrderInvoiceFinancialSnapshot(order, orderLinesById.get(order.id) ?? []);
    const expectedLines = new Map<string, { amount: number; quantity: number }>(canonical.billablePricedLineItems.map((entry: any) => [
      entry.lineItem.id, { amount: entry.pricing.effectiveTotalCents, quantity: entry.pricing.quantity },
    ]));
    const actualLines = invoiceLinesById.get(invoice.id) ?? [];
    const actualIds = new Set(actualLines.map((line) => line.orderLineItemId));
    const seenOrderLineIds = new Set<string>();
    const staleLines = actualLines.filter((line) => {
      if (!line.orderLineItemId || !expectedLines.has(line.orderLineItemId) || seenOrderLineIds.has(line.orderLineItemId)) return true;
      seenOrderLineIds.add(line.orderLineItemId);
      return false;
    });
    const missingLines = Array.from(expectedLines.keys()).filter((id) => !actualIds.has(id));
    const amountMismatch = actualLines.some((line) => {
      const expected = line.orderLineItemId ? expectedLines.get(line.orderLineItemId) : null;
      return expected && (expected.amount !== Number(line.lineTotalCents) || expected.quantity !== Number(line.quantity));
    });
    const lineSum = actualLines.reduce((sum, line) => sum + Number(line.lineTotalCents ?? 0), 0);
    const headerMismatch = lineSum !== invoice.subtotalCents
      || invoice.totalCents !== Math.max(0, lineSum - canonical.discountCents + invoice.taxCents + invoice.shippingCents);
    const orderInvoiceMismatch = cents(order.total) !== invoice.totalCents || canonical.totalCents !== invoice.totalCents;
    const rollup = computeInvoicePaymentRollup({ invoiceTotalCents: invoice.totalCents, payments: (paymentsByInvoiceId.get(invoice.id) ?? []).map((payment) => ({ id: payment.id, status: payment.status, amountCents: payment.amountCents })) });
    const paymentMismatch = cents(invoice.amountPaid) !== rollup.amountPaidCents || cents(invoice.balanceDue) !== rollup.amountDueCents;
    const historicalReview = orderInvoiceMismatch && rollup.amountPaidCents > 0 && Boolean(invoice.issuedAt || invoice.lastSentAt || invoice.accountingApprovedAt);
    if (staleLines.length) summary.staleLines++;
    if (missingLines.length) summary.missingLines++;
    if (amountMismatch) summary.lineAmountMismatch++;
    if (headerMismatch) summary.headerMismatch++;
    if (orderInvoiceMismatch) summary.orderInvoiceMismatch++;
    if (paymentMismatch) summary.paymentMismatch++;
    if (historicalReview) summary.historicalReview++;
    if (!staleLines.length && !missingLines.length && !amountMismatch && !headerMismatch && !orderInvoiceMismatch && !paymentMismatch) {
      summary.clean++;
    } else {
      exceptions.push({ invoiceId: invoice.id, invoiceNumber: invoice.displayNumber || invoice.invoiceNumber,
        orderId: order.id, orderNumber: order.displayNumber || order.orderNumber,
        organizationId, lineSumCents: lineSum, invoiceSubtotalCents: invoice.subtotalCents,
        invoiceTotalCents: invoice.totalCents, canonicalOrderTotalCents: canonical.totalCents,
        staleLineIds: staleLines.map((line) => line.id), missingOrderLineIds: missingLines,
        amountMismatch, headerMismatch, orderInvoiceMismatch, paymentMismatch,
        classification: historicalReview ? "HISTORICAL_REVIEW_REQUIRED" : "INTEGRITY_REVIEW_REQUIRED" });
    }
  }
  console.log("[order-invoice-audit] summary", JSON.stringify(summary));
  console.log("[order-invoice-audit] exceptions", JSON.stringify(exceptions, null, 2));
}

main().catch((error) => { console.error("[order-invoice-audit]", error instanceof Error ? error.message : "Unknown failure"); process.exitCode = 1; });
