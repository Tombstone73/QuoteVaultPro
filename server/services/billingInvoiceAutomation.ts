import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  invoiceLineItems,
  invoices,
  orderLineItems,
  orders,
  organizations,
} from "@shared/schema";
import {
  doesBillingPolicyMatchTrigger,
  resolveBillingInvoiceTriggerPolicyFromOrgPreferences,
  type BillingInvoiceTriggerPolicy,
} from "@shared/billingInvoicePolicy";
import { isCanceledOrder } from "@shared/operationalState";
import { createInvoiceFromOrderInTransaction } from "../invoicesService";

export type BillingInvoiceAutomationStatus =
  | "created"
  | "skipped_policy_mismatch"
  | "skipped_existing_invoice"
  | "failed_controlled_error";

export type BillingInvoiceAutomationResult = {
  status: BillingInvoiceAutomationStatus;
  policy: BillingInvoiceTriggerPolicy;
  trigger: BillingInvoiceTriggerPolicy;
  invoice?: {
    id: string;
    invoiceNumber: number;
    status: string;
    totalCents?: number | null;
  } | null;
  message: string;
  code?: string;
};

export type EnsureDraftInvoiceForOrderTriggerInput = {
  organizationId: string;
  orderId: string;
  trigger: BillingInvoiceTriggerPolicy;
  sourceEvent: string;
  actorUserId?: string | null;
};

function toInvoiceSummary(invoice: any): BillingInvoiceAutomationResult["invoice"] {
  if (!invoice) return null;
  return {
    id: invoice.id,
    invoiceNumber: Number(invoice.invoiceNumber),
    status: String(invoice.status || "draft"),
    totalCents: invoice.totalCents == null ? null : Number(invoice.totalCents),
  };
}

function isAutomationMilestoneUniqueViolation(error: unknown): boolean {
  const err = error as any;
  if (err?.code !== "23505") return false;
  const constraint = String(err?.constraint || err?.message || "");
  return constraint.includes("invoices_automation_milestone_uidx");
}

async function insertBillingAuditEvent(
  tx: any,
  organizationId: string,
  input: {
    actorUserId?: string | null;
    orderId: string;
    invoice?: any;
    actionType: string;
    description: string;
    values: Record<string, unknown>;
  },
) {
  await tx.insert(auditLogs).values({
    organizationId,
    userId: input.actorUserId || null,
    userName: null,
    actionType: input.actionType,
    entityType: "invoice",
    entityId: input.invoice?.id ?? null,
    entityName: input.invoice?.invoiceNumber != null ? String(input.invoice.invoiceNumber) : null,
    description: input.description,
    oldValues: null,
    newValues: {
      orderId: input.orderId,
      invoiceId: input.invoice?.id ?? null,
      invoiceNumber: input.invoice?.invoiceNumber ?? null,
      ...input.values,
    },
    ipAddress: null,
    userAgent: null,
  } as any);
}

export class BillingInvoiceAutomationService {
  constructor(private readonly dbInstance = db) {}

  private async findExistingAutomationInvoice(
    organizationId: string,
    orderId: string,
    trigger: BillingInvoiceTriggerPolicy,
  ) {
    const [invoice] = await this.dbInstance
      .select()
      .from(invoices)
      .where(and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.orderId, orderId),
        eq(invoices.invoiceCreationSource, "automation"),
        eq(invoices.billingMilestone, trigger),
      ))
      .limit(1);
    return invoice ?? null;
  }

  async getBillingInvoiceTriggerPolicy(organizationId: string): Promise<BillingInvoiceTriggerPolicy> {
    const [org] = await this.dbInstance
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    const preferences = (org?.settings as any)?.preferences;
    return resolveBillingInvoiceTriggerPolicyFromOrgPreferences(preferences);
  }

  async ensureOrderBackedInvoiceForOrderTrigger(
    input: EnsureDraftInvoiceForOrderTriggerInput,
  ): Promise<BillingInvoiceAutomationResult> {
    try {
      return await this.dbInstance.transaction(async (tx) => {
        const [org] = await tx
          .select({ settings: organizations.settings })
          .from(organizations)
          .where(eq(organizations.id, input.organizationId))
          .limit(1);

        const policy = resolveBillingInvoiceTriggerPolicyFromOrgPreferences((org?.settings as any)?.preferences);

        if (!doesBillingPolicyMatchTrigger(policy, input.trigger)) {
          return {
            status: "skipped_policy_mismatch" as const,
            policy,
            trigger: input.trigger,
            invoice: null,
            message: "Billing trigger skipped because organization policy does not match",
          };
        }

        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${input.organizationId}:${input.orderId}`}))`);

        const [order] = await tx
          .select({
            id: orders.id,
            organizationId: orders.organizationId,
            customerId: orders.customerId,
            state: orders.state,
            status: orders.status,
            canceledAt: orders.canceledAt,
            createdByUserId: orders.createdByUserId,
          })
          .from(orders)
          .where(and(eq(orders.id, input.orderId), eq(orders.organizationId, input.organizationId)))
          .limit(1);

        if (!order) {
          return {
            status: "failed_controlled_error" as const,
            policy,
            trigger: input.trigger,
            invoice: null,
            code: "ORDER_NOT_FOUND",
            message: "Order not found for invoice automation",
          };
        }

        if (isCanceledOrder(order)) {
          return {
            status: "failed_controlled_error" as const,
            policy,
            trigger: input.trigger,
            invoice: null,
            code: "ORDER_CANCELLED",
            message: "Cancelled orders cannot be auto-invoiced",
          };
        }

        // Normal Order creation now owns the forward linked-invoice invariant.
        // A later fulfillment trigger must never create a competing invoice.
        const [existingInvoice] = await tx
          .select()
          .from(invoices)
          .where(and(
            eq(invoices.organizationId, input.organizationId),
            eq(invoices.orderId, input.orderId),
            ne(invoices.status, "void"),
          ))
          .limit(1);

        if (existingInvoice) {
          await insertBillingAuditEvent(tx, input.organizationId, {
            actorUserId: input.actorUserId,
            orderId: input.orderId,
            invoice: existingInvoice,
            actionType: "INVOICE_AUTOMATION_SKIPPED_EXISTING",
            description: "Invoice automation skipped because this billing milestone already has an invoice",
            values: {
              trigger: input.trigger,
              policy,
              sourceEvent: input.sourceEvent,
              existingInvoiceStatus: existingInvoice.status,
            },
          });
          return {
            status: "skipped_existing_invoice" as const,
            policy,
            trigger: input.trigger,
            invoice: toInvoiceSummary(existingInvoice),
            message: "Automated Order-backed invoice already exists",
          };
        }

        const billableLineItems = await tx
          .select({ id: orderLineItems.id })
          .from(orderLineItems)
          .where(eq(orderLineItems.orderId, input.orderId));

        if (billableLineItems.length === 0) {
          return {
            status: "failed_controlled_error" as const,
            policy,
            trigger: input.trigger,
            invoice: null,
            code: "NO_BILLABLE_LINE_ITEMS",
            message: "Order has no billable line items for invoice automation",
          };
        }

        const createdByUserId = input.actorUserId || order.createdByUserId;
        const invoice = await createInvoiceFromOrderInTransaction(tx, input.organizationId, input.orderId, createdByUserId, {
          terms: "due_on_receipt",
          customDueDate: null,
          invoiceCreationSource: "automation",
          billingMilestone: input.trigger === "manual_only" ? null : input.trigger,
        });

        const [lineItemCount] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(invoiceLineItems)
          .where(eq(invoiceLineItems.invoiceId, invoice.id));

        const createdInvoice = {
          ...invoice,
          status: invoice.status,
          syncStatus: invoice.syncStatus,
          qbSyncStatus: invoice.qbSyncStatus,
        };

        await insertBillingAuditEvent(tx, input.organizationId, {
          actorUserId: input.actorUserId,
          orderId: input.orderId,
          invoice: createdInvoice,
          actionType: "INVOICE_ORDER_BACKED_AUTO_CREATED",
          description: "Live Order-backed invoice auto-created from fulfillment billing trigger",
          values: {
            trigger: input.trigger,
            policy,
            sourceEvent: input.sourceEvent,
            invoiceLineItemCount: Number(lineItemCount?.count || 0),
            autoSend: false,
            autoPaid: false,
            quickBooksSyncDeferredUntilExplicitQueue: true,
          },
        });

        return {
          status: "created" as const,
          policy,
          trigger: input.trigger,
          invoice: toInvoiceSummary(createdInvoice),
          message: "Order-backed invoice created",
        };
      });
    } catch (error: any) {
      if (isAutomationMilestoneUniqueViolation(error)) {
        const policy = await this.getBillingInvoiceTriggerPolicy(input.organizationId).catch(() => "manual_only" as const);
        const existingInvoice = await this.findExistingAutomationInvoice(input.organizationId, input.orderId, input.trigger);
        if (existingInvoice) {
          return {
            status: "skipped_existing_invoice",
            policy,
            trigger: input.trigger,
            invoice: toInvoiceSummary(existingInvoice),
            message: "Automated draft invoice already exists",
          };
        }
      }
      console.error("[BillingInvoiceAutomation] controlled failure:", {
        organizationId: input.organizationId,
        orderId: input.orderId,
        trigger: input.trigger,
        sourceEvent: input.sourceEvent,
        message: error?.message || String(error),
      });
      const policy = await this.getBillingInvoiceTriggerPolicy(input.organizationId).catch(() => "manual_only" as const);
      return {
        status: "failed_controlled_error",
        policy,
        trigger: input.trigger,
        invoice: null,
        code: "INVOICE_AUTOMATION_FAILED",
        message: error?.message || "Invoice automation failed",
      };
    }
  }
}

export const billingInvoiceAutomationService = new BillingInvoiceAutomationService();
