import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";

import { getRuntimeEnvironmentSummary } from "../server/lib/runtimeEnvironment";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1]?.trim() || null) : null;
}

function usage(): never {
  throw new Error("Usage: tsx scripts/repair-order-commercial-financials.ts --organization-id <uuid> (--order-number <number> | --order-id <uuid>) [--actor-user-id <uuid> --apply]");
}

function money(value: unknown): string {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "unavailable";
}

async function main() {
  const apply = process.argv.includes("--apply");
  const organizationId = arg("organization-id");
  const orderId = arg("order-id");
  const orderNumberText = arg("order-number");
  const actorUserId = arg("actor-user-id");
  if (!organizationId || (!!orderId === !!orderNumberText)) usage();
  const orderNumber = orderNumberText == null ? null : Number(orderNumberText);
  if (orderNumberText != null && (!Number.isSafeInteger(orderNumber) || orderNumber! <= 0)) {
    throw new Error("--order-number must be a positive integer.");
  }
  if (apply && !actorUserId) throw new Error("--actor-user-id is required with --apply for audit attribution.");

  const environment = getRuntimeEnvironmentSummary();
  console.log("[order-commercial-repair] environment", JSON.stringify({
    appRuntime: environment.appRuntime,
    apiRuntime: environment.apiRuntime,
    databaseRuntime: environment.databaseRuntime,
    databaseLabel: environment.databaseLabel,
    buildFingerprint: environment.buildFingerprint,
    mode: apply ? "APPLY" : "DRY_RUN",
  }));
  if (environment.databaseRuntime !== "production-cloud" || environment.appRuntime !== "production") {
    throw new Error("Refusing repair: an unambiguous V1 MAIN production runtime and production-cloud database are required.");
  }

  // Dynamic imports deliberately happen after identity validation so this
  // command cannot initialize an unknown database merely to print help/errors.
  const [{ db }, schema, financials] = await Promise.all([
    import("../server/db"),
    import("../shared/schema"),
    import("../server/services/orders/orderTaxCalculationService"),
  ]);
  const { customers, invoiceLineItems, invoices, orderLineItems, orders, payments } = schema;
  const orderPredicate = orderId
    ? and(eq(orders.organizationId, organizationId), eq(orders.id, orderId))
    : and(eq(orders.organizationId, organizationId), eq(orders.orderNumber, orderNumber!));
  const matches = await db.select({
    id: orders.id,
    organizationId: orders.organizationId,
    orderNumber: orders.orderNumber,
    customerId: orders.customerId,
    customerName: customers.companyName,
    subtotal: orders.subtotal,
    discount: orders.discount,
    tax: orders.tax,
    shippingCents: orders.shippingCents,
    total: orders.total,
    fulfillmentStatus: orders.fulfillmentStatus,
    shippingMethod: orders.shippingMethod,
  }).from(orders).leftJoin(customers, eq(customers.id, orders.customerId)).where(orderPredicate);
  if (matches.length !== 1) throw new Error(`Refusing repair: expected exactly one Order match, found ${matches.length}.`);
  const order = matches[0]!;

  async function report(label: string, executor: any) {
    const snapshot = await financials.calculateEditableOrderFinancialSnapshot(executor, { organizationId, orderId: order.id });
    if (!snapshot) throw new Error("Order disappeared during repair.");
    const lineItems = await executor.select({
      id: orderLineItems.id,
      productId: orderLineItems.productId,
      description: orderLineItems.description,
      quantity: orderLineItems.quantity,
      totalPrice: orderLineItems.totalPrice,
      workflowState: orderLineItems.workflowState,
      status: orderLineItems.status,
      parentLineItemId: orderLineItems.parentLineItemId,
      lineItemRole: orderLineItems.lineItemRole,
    }).from(orderLineItems).where(eq(orderLineItems.orderId, order.id));
    const linkedInvoices = await executor.select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      total: invoices.total,
      totalCents: invoices.totalCents,
      balanceDue: invoices.balanceDue,
      amountPaid: invoices.amountPaid,
      issuedAt: invoices.issuedAt,
      lastSentAt: invoices.lastSentAt,
      accountingApprovedAt: invoices.accountingApprovedAt,
    }).from(invoices).where(and(eq(invoices.organizationId, organizationId), eq(invoices.orderId, order.id)));
    const invoiceIds = linkedInvoices.map((invoice: any) => invoice.id);
    const invoiceLines = invoiceIds.length
      ? await executor.select({ invoiceId: invoiceLineItems.invoiceId, orderLineItemId: invoiceLineItems.orderLineItemId, lineTotalCents: invoiceLineItems.lineTotalCents })
        .from(invoiceLineItems).where(inArray(invoiceLineItems.invoiceId, invoiceIds))
      : [];
    const paymentRows = invoiceIds.length
      ? await executor.select({ invoiceId: payments.invoiceId, id: payments.id, status: payments.status, amountCents: payments.amountCents, provider: payments.provider })
        .from(payments).where(and(eq(payments.organizationId, organizationId), inArray(payments.invoiceId, invoiceIds)))
      : [];
    console.log(`[order-commercial-repair] ${label}`, JSON.stringify({
      order: {
        id: order.id,
        number: order.orderNumber,
        customer: order.customerName ?? order.customerId,
        persisted: { subtotal: money(snapshot.order.subtotal), discount: money(snapshot.order.discount), tax: money(snapshot.order.tax), shippingCents: snapshot.order.shippingCents ?? 0, total: money(snapshot.order.total) },
        canonical: { subtotal: money(snapshot.totals.subtotal), tax: money(snapshot.totals.taxAmount), shippingCents: Math.round(snapshot.shipping * 100), total: money(snapshot.total) },
        fulfillment: { method: snapshot.order.shippingMethod, status: snapshot.order.fulfillmentStatus },
      },
      lineItems,
      billableLineIds: snapshot.billableLines.map((line: any) => line.id),
      invoices: linkedInvoices,
      invoiceLines,
      payments: paymentRows,
    }, null, 2));
    return snapshot;
  }

  await report("before", db);
  if (!apply) {
    console.log("[order-commercial-repair] dry run only; rerun with --apply and --actor-user-id after reviewing this report.");
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${orders.id} FROM ${orders} WHERE ${orders.id} = ${order.id} AND ${orders.organizationId} = ${organizationId} FOR UPDATE`);
    const repaired = await financials.recalculateEditableOrderFinancialsInTransaction(tx, { organizationId, orderId: order.id, actorUserId });
    if (!repaired) throw new Error("Order was not found during canonical recalculation.");
  });
  await report("after", db);
}

function redactDiagnostic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[redacted]")
    .replace(/(password|token|secret)=([^\s&]+)/gi, "$1=[redacted]");
}

main().catch((error: any) => {
  console.error("[order-commercial-repair] failed", JSON.stringify({
    name: error instanceof Error ? error.name : typeof error,
    message: redactDiagnostic(error instanceof Error ? error.message : String(error)),
    code: typeof error?.code === "string" || typeof error?.code === "number" ? error.code : null,
    stack: redactDiagnostic(error instanceof Error ? error.stack : null),
  }, null, 2));
  process.exit(1);
});
