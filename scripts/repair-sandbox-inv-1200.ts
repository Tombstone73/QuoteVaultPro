import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";

import { assertExclusiveTenantCandidates } from "../server/lib/financialRepairTenantScope";
import { getRuntimeEnvironmentSummary } from "../server/lib/runtimeEnvironment";

const expected = {
  organizationId: "d51ff3e7-75aa-462f-b0ab-3751bd888306",
  invoiceId: "6856b9d7-23ed-41ea-9873-7d1e6dd8e82e",
  orderId: "fd460a1b-eb49-4597-b433-fa78e410baa3",
  invoiceNumber: 1200,
  invoiceDisplayNumber: "INV-1200",
  orderNumber: "1013",
  orderDisplayNumber: "ORD-1013",
  totalCents: 4400,
  invoiceVersion: 1,
};

function arg(name: string): string | null {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3).trim() || null;
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1]?.trim() || null;
}

export function assertSandboxInvoicePreconditions(invoice: any, order: any, payments: any[]) {
  if (!invoice || !order) throw new Error("Expected Sandbox Invoice and Order were not found together.");
  const identityMatches = invoice.id === expected.invoiceId
    && invoice.organizationId === expected.organizationId
    && invoice.invoiceNumber === expected.invoiceNumber
    && invoice.displayNumber === expected.invoiceDisplayNumber
    && invoice.orderId === expected.orderId
    && order.id === expected.orderId
    && order.organizationId === expected.organizationId
    && String(order.orderNumber) === expected.orderNumber
    && order.displayNumber === expected.orderDisplayNumber;
  if (!identityMatches) throw new Error("Sandbox Invoice/Order identity drift; no correction allowed.");
  if (Number(invoice.totalCents) !== expected.totalCents || Number(invoice.total) !== 44
      || Number(invoice.amountPaid) !== 0 || payments.length !== 0
      || invoice.qbInvoiceId || invoice.externalAccountingId || invoice.importSource
      || invoice.isHistorical || invoice.lastSentAt || invoice.accountingApprovedAt) {
    throw new Error("Sandbox Invoice financial, payment, accounting, or version precondition changed.");
  }
  if (invoice.status === "void" && Number(invoice.balanceDue) === 0 && invoice.lockedReason === "sandbox_test_artifact"
      && Number(invoice.invoiceVersion) === expected.invoiceVersion + 1) {
    return "already_corrected" as const;
  }
  if (invoice.status !== "billed" || Number(invoice.balanceDue) !== 44 || invoice.lockedReason
      || Number(invoice.invoiceVersion) !== expected.invoiceVersion) {
    throw new Error("Sandbox Invoice status/balance differs from the audited $44 billed state.");
  }
  return "needs_correction" as const;
}

export function assertPriorSandboxRepairAudit(events: Array<{ oldValues: unknown; newValues: unknown }>) {
  if (events.length !== 1
      || Number((events[0]!.oldValues as any)?.balanceDueCents) !== 0
      || Number((events[0]!.newValues as any)?.balanceDueCents) !== expected.totalCents) {
    throw new Error("Prior $0-to-$44 integrity-repair audit evidence is missing or changed.");
  }
}

async function main() {
  const targetOrganizationId = expected.organizationId;
  const targetInvoiceId = expected.invoiceId;
  const apply = process.argv.includes("--apply");
  const actorUserId = arg("actor-user-id");
  if (arg("organization-id") !== targetOrganizationId || arg("invoice-id") !== targetInvoiceId) {
    throw new Error("Exact Sandbox organization ID and Invoice UUID are required; document number alone is never an identity.");
  }
  if (apply && (!actorUserId || arg("confirm-organization-id") !== targetOrganizationId || arg("confirm-invoice-id") !== targetInvoiceId)) {
    throw new Error("Apply requires actor user ID and explicit matching organization/invoice confirmations after dry-run review.");
  }
  const runtime = getRuntimeEnvironmentSummary();
  if (runtime.appRuntime !== "production" || runtime.databaseRuntime !== "production-cloud") {
    throw new Error("Refusing correction outside verified MAIN production runtime/database.");
  }
  const [{ db }, schema] = await Promise.all([import("../server/db"), import("../shared/schema")]);
  const { auditLogs, invoices, orders, organizations, payments } = schema;
  const organizationsFound = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(eq(organizations.id, targetOrganizationId));
  const candidates = await db.select({ id: invoices.id, organizationId: invoices.organizationId })
    .from(invoices).where(and(eq(invoices.id, targetInvoiceId), eq(invoices.organizationId, targetOrganizationId)));
  console.log("[sandbox-invoice-correction] target", JSON.stringify({
    organizationId: targetOrganizationId,
    organizationName: organizationsFound[0]?.name ?? null,
    invoiceId: targetInvoiceId,
    candidateCountsByOrganization: Object.fromEntries(candidates.map((row) => [row.organizationId, 1])),
    mode: apply ? "APPLY" : "DRY_RUN",
  }));
  const target = assertExclusiveTenantCandidates(targetOrganizationId, organizationsFound, candidates);
  if (target.organization.name !== "Sandbox Titan Graphics") throw new Error("Target organization name changed; review required.");

  async function readState(executor: any) {
    const [invoice] = await executor.select().from(invoices).where(and(
      eq(invoices.id, targetInvoiceId), eq(invoices.organizationId, targetOrganizationId),
    )).limit(1);
    const [order] = await executor.select().from(orders).where(and(
      eq(orders.id, expected.orderId), eq(orders.organizationId, targetOrganizationId),
    )).limit(1);
    const paymentRows = await executor.select({ id: payments.id }).from(payments).where(and(
      eq(payments.invoiceId, targetInvoiceId), eq(payments.organizationId, targetOrganizationId),
    ));
    const priorRepairEvents = await executor.select({ oldValues: auditLogs.oldValues, newValues: auditLogs.newValues })
      .from(auditLogs).where(and(
        eq(auditLogs.organizationId, targetOrganizationId), eq(auditLogs.entityType, "invoice"),
        eq(auditLogs.entityId, targetInvoiceId), eq(auditLogs.actionType, "invoice_integrity_repair"),
      ));
    assertPriorSandboxRepairAudit(priorRepairEvents);
    const disposition = assertSandboxInvoicePreconditions(invoice, order, paymentRows);
    return { invoice, order, disposition };
  }

  const before = await readState(db);
  console.log("[sandbox-invoice-correction] preflight", JSON.stringify({
    invoiceId: before.invoice.id, orderId: before.order.id, status: before.invoice.status,
    totalCents: before.invoice.totalCents, balanceDue: before.invoice.balanceDue,
    paid: before.invoice.amountPaid, invoiceVersion: before.invoice.invoiceVersion,
    qbInvoiceId: before.invoice.qbInvoiceId, externalAccountingId: before.invoice.externalAccountingId,
    disposition: before.disposition,
  }));
  if (!apply || before.disposition === "already_corrected") return;

  await db.transaction(async (tx) => {
    await tx.execute(sql`select ${invoices.id} from ${invoices} where ${invoices.id} = ${targetInvoiceId} and ${invoices.organizationId} = ${targetOrganizationId} for update`);
    const locked = await readState(tx);
    if (locked.disposition !== "needs_correction" || locked.invoice.updatedAt?.getTime() !== before.invoice.updatedAt?.getTime()) {
      throw new Error("Sandbox Invoice changed after dry-run/preflight; transaction aborted.");
    }
    const updated = await tx.update(invoices).set({
      status: "void", balanceDue: "0.00", lockedReason: "sandbox_test_artifact",
      invoiceVersion: expected.invoiceVersion + 1, accountingUpdatedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(invoices.id, targetInvoiceId), eq(invoices.organizationId, targetOrganizationId),
      eq(invoices.invoiceVersion, expected.invoiceVersion), eq(invoices.status, "billed"),
      eq(invoices.balanceDue, "44.00"),
    )).returning({ id: invoices.id });
    if (updated.length !== 1) throw new Error("Tenant/version-guarded update affected zero or multiple Invoices.");
    await tx.insert(auditLogs).values({
      organizationId: targetOrganizationId,
      userId: actorUserId,
      actionType: "sandbox_test_invoice_tenant_scope_correction",
      entityType: "invoice", entityId: targetInvoiceId, entityName: expected.invoiceDisplayNumber,
      description: "Corrected pre-go-live Sandbox test Invoice after prior repair crossed the live Titan Graphics tenant boundary. No customer receivable exists; no Payment was fabricated. Order and customer records were not changed.",
      oldValues: { status: "billed", balanceDue: "44.00", totalCents: 4400, invoiceVersion: 1 },
      newValues: { status: "void", balanceDue: "0.00", lockedReason: "sandbox_test_artifact", totalCents: 4400, invoiceVersion: 2 },
    });
  });
  const after = await readState(db);
  if (after.disposition !== "already_corrected") throw new Error("Post-commit read did not verify Sandbox correction.");
  console.log("[sandbox-invoice-correction] VERIFIED", JSON.stringify({ invoiceId: after.invoice.id, status: after.invoice.status, balanceDue: after.invoice.balanceDue }));
}

if (process.argv[1]?.includes("repair-sandbox-inv-1200")) {
  main().catch((error) => { console.error("[sandbox-invoice-correction]", error instanceof Error ? error.message : "Unknown failure"); process.exitCode = 1; });
}
