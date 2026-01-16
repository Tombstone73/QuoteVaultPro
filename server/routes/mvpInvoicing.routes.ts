import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLogs, companySettings, customers, invoiceLineItems, invoices, orders, payments, paymentWebhookEvents, users, manualPaymentMethodSchema } from "../../shared/schema";
import { applyPayment, createInvoiceFromOrder, getInvoiceWithRelations, refreshInvoiceStatus } from "../invoicesService";
import { recomputeOrderBillingStatus } from "../services/orderBillingService";
import { syncSingleInvoiceToQuickBooksForOrganization, syncSinglePaymentToQuickBooksForOrganization } from "../quickbooksService";
import { computeInvoicePaymentRollup, getInvoicePaymentStatusLabel } from "../../shared/rollups/invoicePaymentRollup";
import { createInvoicePaymentIntent, getStripeClient, getStripeWebhookSecret } from "../lib/stripe";
import { generateInvoicePdfBytes } from "../services/invoicePdf";
import { z } from "zod";
import { integrationConnections } from "../../shared/schema";

// Minimal helper (matches server/routes.ts behavior)
function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

function getRequestOrganizationId(req: any): string | undefined {
  return req.organizationId || (req.headers["x-organization-id"] as string);
}

function paymentsDebugLogsEnabled(): boolean {
  return String(process.env.PAYMENTS_DEBUG_LOGS || '').trim() === '1';
}

function logStripeCreateIntentDebug(params: {
  event:
    | 'stripe.create_intent.reuse_pending'
    | 'stripe.create_intent.reconcile_pending_succeeded'
    | 'stripe.create_intent.create_new';
  orgId: string;
  invoiceId: string;
  paymentId: string;
  stripePaymentIntentId: string;
  amountCents: number;
}) {
  if (!paymentsDebugLogsEnabled()) return;
  console.log(
    `event=${params.event} orgId=${params.orgId} invoiceId=${params.invoiceId} paymentId=${params.paymentId} stripePaymentIntentId=${params.stripePaymentIntentId} amountCents=${params.amountCents}`
  );
}

function extractQuickBooksErrorMessage(err: any): { message: string; statusCode: number } {
  const statusCode = Number(err?.statusCode || 500);

  const raw = String(err?.message || err || '').trim();
  if (!raw) return { message: 'QuickBooks sync failed', statusCode };

  // If the message contains embedded JSON (legacy "QuickBooks API error: <status> { ... }") attempt to extract Fault.Error[0].
  const jsonStart = raw.indexOf('{');
  if (jsonStart >= 0) {
    const maybeJson = raw.slice(jsonStart);
    try {
      const parsed = JSON.parse(maybeJson);
      const qbError = parsed?.Fault?.Error?.[0];
      const messagePart = qbError?.Message ? String(qbError.Message) : '';
      const detailPart = qbError?.Detail ? String(qbError.Detail) : '';
      const combined = [messagePart, detailPart].filter(Boolean).join(' - ');
      if (combined) return { message: combined, statusCode };
    } catch {
      // ignore
    }
  }

  return { message: raw.slice(0, 800), statusCode };
}

export async function registerMvpInvoicingRoutes(
  app: Express,
  deps: {
    isAuthenticated: any;
    tenantContext: any;
  }
) {
  const { isAuthenticated, tenantContext } = deps;

  // ------------------------------------------------------------
  // Stripe: Create PaymentIntent for invoice (full payment only)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/payments/stripe/create-intent", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const [stripeConn] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, 'stripe')))
        .limit(1);

      const stripeAccountId = stripeConn?.externalAccountId ? String(stripeConn.externalAccountId) : null;
      if (!stripeAccountId) {
        return res.status(409).json({
          success: false,
          error: 'Stripe is not connected for this organization.',
          code: 'STRIPE_NOT_CONNECTED',
        });
      }

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ success: false, error: "Missing user" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });

      const status = String(inv.status || '').toLowerCase();
      if (status === 'void') return res.status(400).json({ success: false, error: "Cannot pay a void invoice" });

      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number(inv.totalCents || 0),
        payments: paymentRows.map((p: any) => ({ id: p.id, status: String(p.status || 'succeeded'), amountCents: Number(p.amountCents || 0) })),
      });

      if (rollup.amountDueCents <= 0) return res.status(400).json({ success: false, error: "Invoice is already paid" });

      const currency = String(inv.currency || 'USD');

      // Idempotency: reuse existing pending Stripe payment for the same invoice + amountDue.
      const [existingPending] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.organizationId, organizationId),
            eq(payments.invoiceId, inv.id),
            eq(payments.provider, 'stripe'),
            eq(payments.status, 'pending'),
            eq(payments.amountCents, rollup.amountDueCents)
          )
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);

      if (existingPending) {
        const existingIntentId = (existingPending as any).stripePaymentIntentId ? String((existingPending as any).stripePaymentIntentId) : '';
        if (existingIntentId) {
          try {
            const stripe = getStripeClient();
            const pi = await stripe.paymentIntents.retrieve(existingIntentId, { stripeAccount: stripeAccountId } as any);
            const piStatus = String((pi as any).status || '').toLowerCase();

            // If Stripe already succeeded, reconcile to avoid any double-charge path.
            if (piStatus === 'succeeded') {
              logStripeCreateIntentDebug({
                event: 'stripe.create_intent.reconcile_pending_succeeded',
                orgId: organizationId,
                invoiceId: inv.id,
                paymentId: String((existingPending as any).id),
                stripePaymentIntentId: existingIntentId,
                amountCents: rollup.amountDueCents,
              });

              const now = new Date();
              await db
                .update(payments)
                .set({ status: 'succeeded', paidAt: now, succeededAt: now, updatedAt: now } as any)
                .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));

              await refreshInvoiceStatus(inv.id);
              return res.status(400).json({ success: false, error: 'Invoice is already paid' });
            }

            if (piStatus !== 'canceled' && (pi as any).client_secret) {
              logStripeCreateIntentDebug({
                event: 'stripe.create_intent.reuse_pending',
                orgId: organizationId,
                invoiceId: inv.id,
                paymentId: String((existingPending as any).id),
                stripePaymentIntentId: existingIntentId,
                amountCents: rollup.amountDueCents,
              });

              return res.json({
                success: true,
                data: {
                  clientSecret: String((pi as any).client_secret),
                  paymentId: (existingPending as any).id,
                },
              });
            }

            // Not usable: transition existing row out of pending, then continue to create a new PI.
            const now = new Date();
            await db
              .update(payments)
              .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
              .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));
          } catch (err: any) {
            console.error('[StripeCreateIntent] failed to retrieve existing intent', {
              organizationId,
              invoiceId: inv.id,
              paymentId: (existingPending as any).id,
              stripePaymentIntentId: existingIntentId,
              message: String(err?.message || err),
            });

            const now = new Date();
            await db
              .update(payments)
              .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
              .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));
          }
        } else {
          // Pending row without intent id should not block payment attempts.
          const now = new Date();
          await db
            .update(payments)
            .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
            .where(and(eq(payments.id, (existingPending as any).id), eq(payments.organizationId, organizationId)));
        }
      }

      const idempotencyKey = `${organizationId}:${inv.id}:${rollup.amountDueCents}`;

      const stripe = getStripeClient();
      const pi = await stripe.paymentIntents.create(
        {
          amount: rollup.amountDueCents,
          currency: currency.toLowerCase(),
          description: `Invoice #${inv.invoiceNumber}`,
          automatic_payment_methods: { enabled: true },
          metadata: {
            organizationId,
            invoiceId: inv.id,
            stripeAccountId,
          },
        },
        {
          idempotencyKey,
          stripeAccount: stripeAccountId,
        } as any
      );

      if (!pi.client_secret) throw new Error('Stripe did not return client_secret');

      const paymentIntentId = pi.id;
      const clientSecret = pi.client_secret;

      // If another request already inserted the payment row (Stripe idempotency can cause this), reuse it.
      const [existingByIntent] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
        .limit(1);

      if (existingByIntent && String((existingByIntent as any).status || '').toLowerCase() === 'pending') {
        logStripeCreateIntentDebug({
          event: 'stripe.create_intent.reuse_pending',
          orgId: organizationId,
          invoiceId: inv.id,
          paymentId: String((existingByIntent as any).id),
          stripePaymentIntentId: paymentIntentId,
          amountCents: rollup.amountDueCents,
        });
        return res.json({ success: true, data: { clientSecret, paymentId: (existingByIntent as any).id } });
      }

      const now = new Date();
      const insertedRows = await db
        .insert(payments)
        .values({
          organizationId,
          invoiceId: inv.id,
          provider: 'stripe',
          status: 'pending',
          amount: (rollup.amountDueCents / 100).toFixed(2),
          amountCents: rollup.amountDueCents,
          currency,
          stripePaymentIntentId: paymentIntentId,
          metadata: {
            invoiceId: inv.id,
            organizationId,
            stripeAccountId,
          },
          method: 'credit_card',
          appliedAt: now,
          createdByUserId: userId,
          syncStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        } as any)
        // Backed by 0026_stripe_payments_v1.sql unique index:
        // payments_org_stripe_payment_intent_id_uidx (organization_id, stripe_payment_intent_id)
        .onConflictDoNothing({ target: [payments.organizationId, payments.stripePaymentIntentId] })
        .returning();

      const payment: any | undefined = insertedRows[0] as any;

      if (!payment) {
        const [existingAfterConflict] = await db
          .select()
          .from(payments)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, paymentIntentId)))
          .limit(1);

        if (existingAfterConflict && String((existingAfterConflict as any).status || '').toLowerCase() === 'pending') {
          logStripeCreateIntentDebug({
            event: 'stripe.create_intent.reuse_pending',
            orgId: organizationId,
            invoiceId: inv.id,
            paymentId: String((existingAfterConflict as any).id),
            stripePaymentIntentId: paymentIntentId,
            amountCents: rollup.amountDueCents,
          });
          return res.json({ success: true, data: { clientSecret, paymentId: (existingAfterConflict as any).id } });
        }

        throw new Error('Failed to create payment row');
      }

      logStripeCreateIntentDebug({
        event: 'stripe.create_intent.create_new',
        orgId: organizationId,
        invoiceId: inv.id,
        paymentId: String(payment.id),
        stripePaymentIntentId: paymentIntentId,
        amountCents: rollup.amountDueCents,
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'payment_intent_created',
          entityType: 'invoice',
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: 'Stripe PaymentIntent created',
          newValues: { provider: 'stripe', stripePaymentIntentId: paymentIntentId, amountCents: rollup.amountDueCents } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.json({ success: true, data: { clientSecret, paymentId: payment?.id } });
    } catch (error: any) {
      console.error('[StripeCreateIntent] failed', {
        invoiceId: String(req?.params?.id || ''),
        organizationId: getRequestOrganizationId(req) || null,
        message: String(error?.message || error),
      });
      return res.status(500).json({ success: false, error: error.message || 'Failed to create payment intent' });
    }
  });

  // ------------------------------------------------------------
  // Payments list (invoice-scoped, tenant-scoped)
  // ------------------------------------------------------------
  app.get('/api/invoices/:id/payments', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const rows = await db
        .select({
          payment: payments,
          createdBy: users,
        })
        .from(payments)
        .leftJoin(users, eq(payments.createdByUserId, users.id))
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const data = rows.map((r: any) => {
        const u = r.createdBy as any;
        const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : '';
        return {
          ...(r.payment as any),
          createdBy: u
            ? {
                id: u.id,
                name: name || u.email || null,
                email: u.email || null,
              }
            : null,
        };
      });

      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error fetching invoice payments:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch payments' });
    }
  });

  // ------------------------------------------------------------
  // Invoice PDF v1 (tenant-scoped)
  // ------------------------------------------------------------
  app.get('/api/invoices/:id/pdf', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const invoiceId = String(req.params.id || '').trim();
      if (!invoiceId) return res.status(400).json({ error: 'Missing invoice id' });

      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
        .limit(1);

      if (!inv) return res.status(404).json({ error: 'Invoice not found' });

      let job: { poNumber?: string | null; jobNumber?: string | null } | null = null;
      if ((inv as any).orderId) {
        const [ord] = await db
          .select({
            orderNumber: orders.orderNumber,
            poNumber: orders.poNumber,
          })
          .from(orders)
          .where(and(eq(orders.id, String((inv as any).orderId)), eq(orders.organizationId, organizationId)))
          .limit(1);

        if (ord) {
          job = {
            poNumber: ord.poNumber ?? null,
            jobNumber: ord.orderNumber ?? null,
          };
        }
      }

      const [cust] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.id, (inv as any).customerId), eq(customers.organizationId, organizationId)))
        .limit(1);

      // Company settings are optional; only include branding fields if present.
      const [orgCompany] = await db
        .select()
        .from(companySettings)
        .where(eq(companySettings.organizationId, organizationId))
        .limit(1);

      const lineItems = await db
        .select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, inv.id))
        .orderBy(invoiceLineItems.sortOrder, desc(invoiceLineItems.createdAt));

      const paymentRows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .orderBy(desc(payments.createdAt));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number((inv as any).totalCents || 0),
        payments: paymentRows.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      });

      const statusLabel = getInvoicePaymentStatusLabel({ invoiceStatus: (inv as any).status, rollup });

      const pdfBytes = await generateInvoicePdfBytes({
        invoice: inv as any,
        customer: (cust as any) || null,
        companySettings: (orgCompany as any) || null,
        paymentSummary: {
          amountPaidCents: rollup.amountPaidCents,
          amountDueCents: rollup.amountDueCents,
          statusLabel,
        },
        lineItems: lineItems as any,
        job,
      });

      const invoiceNumber = (inv as any).invoiceNumber ? String((inv as any).invoiceNumber) : inv.id;
      const filename = `invoice-${invoiceNumber}.pdf`;
      const wantsDownload = String(req.query.download || '') === '1';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `${wantsDownload ? 'attachment' : 'inline'}; filename="${filename}"`
      );

      return res.status(200).send(Buffer.from(pdfBytes));
    } catch (error: any) {
      console.error('Error generating invoice PDF:', error);
      return res.status(500).json({ error: error.message || 'Failed to generate PDF' });
    }
  });

  // ------------------------------------------------------------
  // Manual payments v1: Record a non-Stripe payment
  // ------------------------------------------------------------
  app.post('/api/invoices/:id/payments/manual', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: 'Missing user' });

      const body = z
        .object({
          amountCents: z.coerce.number().int().positive(),
          method: manualPaymentMethodSchema,
          appliedAt: z.string().optional(),
          notes: z.string().max(5000).optional(),
          reference: z.string().max(255).optional(),
        })
        .parse(req.body || {});

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const status = String(inv.status || '').toLowerCase();
      if (status === 'void') return res.status(400).json({ error: 'Cannot record payment on a void invoice' });

      const appliedAt = body.appliedAt ? new Date(body.appliedAt) : new Date();
      if (Number.isNaN(appliedAt.getTime())) return res.status(400).json({ error: 'Invalid appliedAt' });

      const amountCents = Math.max(0, Math.round(Number(body.amountCents || 0)));
      if (amountCents <= 0) return res.status(400).json({ error: 'amountCents must be > 0' });

      const currency = String(inv.currency || 'USD');
      const now = new Date();

      const [payment] = await db
        .insert(payments)
        .values({
          organizationId,
          invoiceId: inv.id,
          provider: 'manual',
          status: 'succeeded',
          amount: (amountCents / 100).toFixed(2),
          amountCents,
          currency,
          method: body.method,
          notes: body.notes,
          note: body.notes,
          appliedAt,
          paidAt: appliedAt,
          succeededAt: appliedAt,
          metadata: {
            ...(body.reference ? { reference: body.reference } : {}),
          },
          createdByUserId: userId,
          syncStatus: 'pending',
          createdAt: now,
          updatedAt: now,
        } as any)
        .returning();

      const updatedInvoice = await refreshInvoiceStatus(inv.id);

      const paymentRowsAfter = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number(inv.totalCents || 0),
        payments: paymentRowsAfter.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'manual_payment_recorded',
          entityType: 'invoice',
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: 'Manual payment recorded',
          newValues: {
            paymentId: payment?.id,
            amountCents,
            method: body.method,
            appliedAt: appliedAt.toISOString(),
            reference: body.reference || null,
          } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.json({
        success: true,
        data: {
          payment,
          invoice: updatedInvoice,
          rollup,
        },
      });
    } catch (error: any) {
      if (error?.name === 'ZodError') {
        return res.status(400).json({ error: error.message || 'Invalid request' });
      }
      console.error('Error recording manual payment:', error);
      return res.status(500).json({ error: error.message || 'Failed to record manual payment' });
    }
  });

  // ------------------------------------------------------------
  // Manual payments v1: Void (soft-void) a manual payment
  // ------------------------------------------------------------
  app.post('/api/invoices/:id/payments/:paymentId/void', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: 'Missing organization context' });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: 'Missing user' });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: 'Invoice not found' });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: 'Invoice not found' });

      const paymentId = String(req.params.paymentId || '');
      if (!paymentId) return res.status(400).json({ error: 'Missing paymentId' });

      const [payment] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .limit(1);

      if (!payment) return res.status(404).json({ error: 'Payment not found' });

      const provider = String((payment as any).provider || '').toLowerCase();
      if (provider === 'stripe') return res.status(400).json({ error: 'Stripe payments cannot be voided here' });

      const currentStatus = String((payment as any).status || '').toLowerCase();
      if (currentStatus === 'voided') {
        const updatedInvoice = await refreshInvoiceStatus(inv.id);
        const paymentRowsAfter = await db
          .select()
          .from(payments)
          .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)));

        const rollup = computeInvoicePaymentRollup({
          invoiceTotalCents: Number(inv.totalCents || 0),
          payments: paymentRowsAfter.map((p: any) => ({
            id: p.id,
            status: String(p.status || 'succeeded'),
            amountCents: Number(p.amountCents || 0),
          })),
        });

        return res.json({ success: true, data: { payment, invoice: updatedInvoice, rollup } });
      }

      const now = new Date();
      const nextMetadata = {
        ...((payment as any).metadata || {}),
        voidedAt: now.toISOString(),
        voidedByUserId: userId,
      };

      const [updatedPayment] = await db
        .update(payments)
        .set({
          status: 'voided',
          canceledAt: now,
          metadata: nextMetadata as any,
          updatedAt: now,
        } as any)
        .where(and(eq(payments.id, paymentId), eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)))
        .returning();

      const updatedInvoice = await refreshInvoiceStatus(inv.id);

      const paymentRowsAfter = await db
        .select()
        .from(payments)
        .where(and(eq(payments.invoiceId, inv.id), eq(payments.organizationId, organizationId)));

      const rollup = computeInvoicePaymentRollup({
        invoiceTotalCents: Number(inv.totalCents || 0),
        payments: paymentRowsAfter.map((p: any) => ({
          id: p.id,
          status: String(p.status || 'succeeded'),
          amountCents: Number(p.amountCents || 0),
        })),
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'manual_payment_voided',
          entityType: 'invoice',
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: 'Manual payment voided',
          oldValues: {
            paymentId: (payment as any).id,
            status: (payment as any).status,
            amountCents: Number((payment as any).amountCents || 0),
          } as any,
          newValues: {
            paymentId: (payment as any).id,
            status: 'voided',
            voidedAt: now.toISOString(),
          } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.json({
        success: true,
        data: {
          payment: updatedPayment,
          invoice: updatedInvoice,
          rollup,
        },
      });
    } catch (error: any) {
      console.error('Error voiding manual payment:', error);
      return res.status(500).json({ error: error.message || 'Failed to void payment' });
    }
  });

  // ------------------------------------------------------------
  // Stripe webhook (no auth) - idempotent + fail-soft
  // Uses req.rawBody (captured by express.json verify in server/index.ts)
  // ------------------------------------------------------------
  app.post('/api/payments/stripe/webhook', async (req: any, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') return res.status(400).send('Missing stripe-signature');

    let event: any;
    try {
      const stripe = getStripeClient();
      const webhookSecret = getStripeWebhookSecret();
      const rawBody: Buffer = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody || '');
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error('[StripeWebhook] signature verification failed:', err);
      return res.status(400).send('Invalid signature');
    }

    const provider = 'stripe';
    const eventId = String(event.id);
    const type = String(event.type);
    const receivedAt = new Date();

    const stripeAccountIdFromEvent = event?.account ? String(event.account) : null;

    // Attempt to extract orgId from metadata (if available)
    const obj: any = event?.data?.object;
    const orgFromMetadata = obj?.metadata?.organizationId ? String(obj.metadata.organizationId) : null;

    let resolvedOrganizationId: string | null = orgFromMetadata;
    if (!resolvedOrganizationId && stripeAccountIdFromEvent) {
      const [conn] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.provider, 'stripe'), eq(integrationConnections.externalAccountId, stripeAccountIdFromEvent)))
        .limit(1);
      resolvedOrganizationId = conn?.organizationId ? String(conn.organizationId) : null;
    }

    try {
      await db
        .insert(paymentWebhookEvents)
        .values({
          provider,
          eventId,
          type,
          organizationId: resolvedOrganizationId,
          status: 'received',
          receivedAt,
          payload: event as any,
        } as any)
        .onConflictDoNothing({ target: [paymentWebhookEvents.provider, paymentWebhookEvents.eventId] });

      const [existing] = await db
        .select()
        .from(paymentWebhookEvents)
        .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)))
        .limit(1);

      if (existing?.processedAt && String(existing.status) === 'processed') {
        return res.json({ received: true });
      }

      // Process events
      if (type === 'payment_intent.succeeded') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const invoiceId = pi?.metadata?.invoiceId ? String(pi.metadata.invoiceId) : null;
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const stripeAccountId = stripeAccountIdFromEvent || (pi?.metadata?.stripeAccountId ? String(pi.metadata.stripeAccountId) : null);

        if (!invoiceId || !organizationId) {
          console.error('[StripeWebhook] missing metadata', {
            eventId,
            type,
            stripePaymentIntentId: intentId,
            hasInvoiceId: !!invoiceId,
            hasOrganizationId: !!organizationId,
            hasStripeAccountId: !!stripeAccountId,
          });
          throw new Error('Missing invoiceId/organizationId in PaymentIntent metadata');
        }

        if (stripeAccountId) {
          const [conn] = await db
            .select()
            .from(integrationConnections)
            .where(and(eq(integrationConnections.provider, 'stripe'), eq(integrationConnections.externalAccountId, stripeAccountId)))
            .limit(1);

          if (!conn || String(conn.organizationId) !== String(organizationId)) {
            console.error('[StripeWebhook] stripeAccountId org mismatch', {
              eventId,
              type,
              stripeAccountId,
              organizationId,
              resolvedOrganizationId,
            });
            throw new Error('Stripe account does not match organization');
          }
        }

        const amountCents = Math.max(0, Math.round(Number(pi.amount_received ?? pi.amount ?? 0)));
        const currency = String(pi.currency || 'usd').toUpperCase();
        const now = new Date();

        const matches = await db
          .select()
          .from(payments)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)))
          .limit(2);

        const paymentRow: any = matches[0];

        if (!paymentRow) {
          // Recovery path: insert succeeded payment row if missing
          const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId))).limit(1);
          if (!inv) {
            console.error('[StripeWebhook] invoice not found for succeeded intent', {
              eventId,
              type,
              organizationId,
              invoiceId,
              stripePaymentIntentId: intentId,
            });
            throw new Error('Invoice not found for webhook metadata');
          }

          try {
            await db.insert(payments).values({
              organizationId,
              invoiceId,
              provider: 'stripe',
              status: 'succeeded',
              amount: (amountCents / 100).toFixed(2),
              amountCents,
              currency,
              stripePaymentIntentId: intentId,
              method: 'credit_card',
              paidAt: now,
              succeededAt: now,
              metadata: { paymentIntent: { id: intentId }, stripeAccountId },
              createdByUserId: null,
              syncStatus: 'pending',
              createdAt: now,
              updatedAt: now,
            } as any);
          } catch (insertErr: any) {
            console.error('[StripeWebhook] recovery insert failed', {
              eventId,
              type,
              organizationId,
              invoiceId,
              stripePaymentIntentId: intentId,
              message: String(insertErr?.message || insertErr),
            });
            throw insertErr;
          }
        } else {
          // Idempotent transition
          const currentStatus = String(paymentRow.status || '').toLowerCase();
          if (currentStatus !== 'succeeded') {
            await db
              .update(payments)
              .set({ status: 'succeeded', paidAt: now, succeededAt: now, updatedAt: now } as any)
              .where(eq(payments.id, paymentRow.id));
          }
        }

        // Refresh invoice rollup (status-aware)
        await refreshInvoiceStatus(invoiceId);

        // Best-effort audit
        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: null,
            userName: 'stripe_webhook',
            actionType: 'payment_succeeded',
            entityType: 'invoice',
            entityId: invoiceId,
            entityName: String(invoiceId),
            description: 'Stripe payment succeeded (webhook)',
            newValues: { stripePaymentIntentId: intentId, amountCents } as any,
            createdAt: now,
          } as any);
        } catch {}
      } else if (type === 'payment_intent.payment_failed') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const now = new Date();

        if (!organizationId) {
          console.error('[StripeWebhook] payment_failed missing organizationId', {
            eventId,
            type,
            stripePaymentIntentId: intentId,
            stripeAccountId: stripeAccountIdFromEvent,
          });
          throw new Error('Missing organizationId for payment_failed');
        }

        await db
          .update(payments)
          .set({ status: 'failed', failedAt: now, updatedAt: now } as any)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)));
      } else if (type === 'payment_intent.canceled') {
        const pi: any = obj;
        const intentId = String(pi.id);
        const organizationId = pi?.metadata?.organizationId ? String(pi.metadata.organizationId) : resolvedOrganizationId;
        const now = new Date();

        if (!organizationId) {
          console.error('[StripeWebhook] canceled missing organizationId', {
            eventId,
            type,
            stripePaymentIntentId: intentId,
            stripeAccountId: stripeAccountIdFromEvent,
          });
          throw new Error('Missing organizationId for canceled');
        }

        await db
          .update(payments)
          .set({ status: 'canceled', canceledAt: now, updatedAt: now } as any)
          .where(and(eq(payments.organizationId, organizationId), eq(payments.stripePaymentIntentId, intentId)));
      } else {
        // ignore safely
      }

      await db
        .update(paymentWebhookEvents)
        .set({ status: 'processed', processedAt: new Date() } as any)
        .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)));

      return res.json({ received: true });
    } catch (err: any) {
      console.error('[StripeWebhook] processing failed', {
        eventId,
        type,
        stripeAccountId: stripeAccountIdFromEvent,
        message: String(err?.message || err),
      });
      try {
        await db
          .update(paymentWebhookEvents)
          .set({ status: 'error', error: String(err?.message || err), processedAt: new Date() } as any)
          .where(and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId)));
      } catch {}
      // Return 500 so Stripe retries (idempotency table prevents double-processing)
      return res.status(500).send('Webhook processing failed');
    }
  });

  // ------------------------------------------------------------
  // Invoices: list/detail (tenant-scoped)
  // ------------------------------------------------------------
  app.get("/api/invoices", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const status = req.query.status as string | undefined;
      const customerId = req.query.customerId as string | undefined;
      const orderId = req.query.orderId as string | undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
      const offset = parseInt((req.query.offset as string) || "0", 10);

      const whereClauses: any[] = [eq(invoices.organizationId, organizationId)];
      if (status) whereClauses.push(eq(invoices.status, status));
      if (customerId) whereClauses.push(eq(invoices.customerId, customerId));
      if (orderId) whereClauses.push(eq(invoices.orderId, orderId));

      const rows = await db
        .select()
        .from(invoices)
        .where(and(...whereClauses))
        .limit(limit)
        .offset(offset)
        .orderBy(desc(invoices.issueDate));

      res.json({ success: true, data: rows });
    } catch (error: any) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ error: error.message || "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      if ((rel.invoice as any).organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      res.json({ success: true, data: rel });
    } catch (error: any) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ error: error.message || "Failed to fetch invoice" });
    }
  });

  // ------------------------------------------------------------
  // Preferred: create invoice from order
  // ------------------------------------------------------------
  app.post("/api/orders/:orderId/invoices", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      if (!userId) return res.status(401).json({ error: "Missing user" });

      const { orderId } = req.params;
      const { terms, customDueDate } = req.body || {};

      const invoice = await createInvoiceFromOrder(organizationId, orderId, userId, {
        terms: terms || "due_on_receipt",
        customDueDate: customDueDate ? new Date(customDueDate) : null,
      });

      res.json({ success: true, data: invoice });
    } catch (error: any) {
      console.error("Error creating invoice from order:", error);
      res.status(500).json({ error: error.message || "Failed to create invoice" });
    }
  });

  // ------------------------------------------------------------
  // Bill invoice (draft -> billed), fail-soft QB
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/bill", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const status = String(inv.status || "").toLowerCase();
      if (status !== "draft") return res.status(400).json({ error: "Only draft invoices can be billed" });

      const issuedAt = new Date();
      await db
        .update(invoices)
        .set({ status: "billed", issuedAt, qbSyncStatus: "pending", updatedAt: new Date() } as any)
        .where(eq(invoices.id, inv.id));

      if (inv.orderId) {
        await db
          .update(orders)
          .set({ billingStatus: "billed", updatedAt: sql`now()` as any } as any)
          .where(and(eq(orders.id, inv.orderId), eq(orders.organizationId, organizationId)));
      }

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: "invoice_billed",
          entityType: "invoice",
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: "Invoice billed",
          createdAt: new Date(),
        } as any);
      } catch {}

      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, inv.id);
        await db
          .update(invoices)
          .set({
            qbInvoiceId: qb.qbInvoiceId,
            externalAccountingId: qb.qbInvoiceId,
            qbSyncStatus: "synced",
            qbLastError: null,
            syncStatus: "synced",
            syncError: null,
            syncedAt: new Date(),
            lastQbSyncedVersion: Number(inv.invoiceVersion || 1),
            updatedAt: new Date(),
          } as any)
          .where(eq(invoices.id, inv.id));
      } catch (e: any) {
        await db
          .update(invoices)
          .set({ qbSyncStatus: "failed", qbLastError: String(e?.message || e), syncStatus: "error", syncError: String(e?.message || e), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_failed",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync failed",
            newValues: { error: String(e?.message || e) } as any,
            createdAt: new Date(),
          } as any);
        } catch {}
      }

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error billing invoice:", error);
      res.status(500).json({ error: error.message || "Failed to bill invoice" });
    }
  });

  // ------------------------------------------------------------
  // Retry QB sync (fail-soft)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/retry-qb-sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      await db.update(invoices).set({ qbSyncStatus: "pending", updatedAt: new Date() } as any).where(eq(invoices.id, inv.id));

      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, inv.id);
        await db
          .update(invoices)
          .set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: "synced", qbLastError: null, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastQbSyncedVersion: Number(inv.invoiceVersion || 1), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_retried",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync retried (success)",
            createdAt: new Date(),
          } as any);
        } catch {}
      } catch (e: any) {
        await db
          .update(invoices)
          .set({ qbSyncStatus: "failed", qbLastError: String(e?.message || e), syncStatus: "error", syncError: String(e?.message || e), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_failed",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync retry failed",
            newValues: { error: String(e?.message || e) } as any,
            createdAt: new Date(),
          } as any);
        } catch {}
      }

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error retrying QB sync:", error);
      res.status(500).json({ error: error.message || "Failed to retry QB sync" });
    }
  });

  // ------------------------------------------------------------
  // QuickBooks: explicit sync endpoints (tenant-scoped)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/qb/sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ success: false, error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ success: false, error: "Invoice not found" });

      await db.update(invoices).set({ qbSyncStatus: "pending", updatedAt: new Date() } as any).where(eq(invoices.id, inv.id));

      try {
        const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, inv.id);
        await db
          .update(invoices)
          .set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: "synced", qbLastError: null, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastQbSyncedVersion: Number(inv.invoiceVersion || 1), updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_manual",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync (manual)",
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB invoice sync success:', {
            organizationId,
            invoiceId: inv.id,
            message: String(logErr?.message || logErr),
          });
        }
      } catch (e: any) {
        const extracted = extractQuickBooksErrorMessage(e);
        await db
          .update(invoices)
          .set({ qbSyncStatus: "failed", qbLastError: extracted.message, syncStatus: "error", syncError: extracted.message, updatedAt: new Date() } as any)
          .where(eq(invoices.id, inv.id));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_qb_sync_failed",
            entityType: "invoice",
            entityId: inv.id,
            entityName: String(inv.invoiceNumber),
            description: "QuickBooks invoice sync failed (manual)",
            newValues: { error: extracted.message } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB invoice sync failure:', {
            organizationId,
            invoiceId: inv.id,
            message: String(logErr?.message || logErr),
          });
        }

        return res.status(extracted.statusCode).json({ success: false, error: extracted.message, code: 'QB_INVOICE_SYNC_FAILED' });
      }

      const refreshed = await getInvoiceWithRelations(inv.id);
      res.json({ success: true, data: refreshed });
    } catch (error: any) {
      console.error("Error syncing invoice to QB:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync invoice to QuickBooks" });
    }
  });

  app.post("/api/payments/:id/qb/sync", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const paymentId = String(req.params.id);
      const existing = await db
        .select()
        .from(payments)
        .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)))
        .limit(1);

      const p: any = existing[0];
      if (!p) return res.status(404).json({ success: false, error: "Payment not found" });

      const paymentStatus = String(p.status || '').toLowerCase();
      if (paymentStatus !== 'succeeded') {
        return res.status(400).json({ success: false, error: "Only succeeded payments can be synced to QuickBooks" });
      }

      try {
        const qb = await syncSinglePaymentToQuickBooksForOrganization(organizationId, paymentId);

        // MVP canonical storage note:
        // QuickBooks is currently the only external accounting provider, so payments.externalAccountingId holds qbPaymentId.

        await db
          .update(payments)
          .set({
            externalAccountingId: qb.qbPaymentId,
            syncStatus: 'synced',
            syncError: null,
            syncedAt: new Date(),
            updatedAt: new Date(),
          } as any)
          .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "quickbooks.payment.sync.succeeded",
            entityType: "payment",
            entityId: paymentId,
            entityName: String(p.referenceNumber || paymentId),
            description: "QuickBooks payment sync succeeded (manual)",
            newValues: { qbPaymentId: qb.qbPaymentId } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB payment sync success:', {
            organizationId,
            paymentId,
            message: String(logErr?.message || logErr),
          });
        }

        return res.json({ success: true, data: { qbPaymentId: qb.qbPaymentId } });
      } catch (e: any) {
        const extracted = extractQuickBooksErrorMessage(e);

        await db
          .update(payments)
          .set({
            syncStatus: 'failed',
            syncError: extracted.message,
            updatedAt: new Date(),
          } as any)
          .where(and(eq(payments.id, paymentId), eq(payments.organizationId, organizationId)));

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "quickbooks.payment.sync.failed",
            entityType: "payment",
            entityId: paymentId,
            entityName: String(p.referenceNumber || paymentId),
            description: "QuickBooks payment sync failed (manual)",
            newValues: { error: extracted.message } as any,
            createdAt: new Date(),
          } as any);
        } catch (logErr: any) {
          console.error('Failed to write audit log for QB payment sync failure:', {
            organizationId,
            paymentId,
            message: String(logErr?.message || logErr),
          });
        }

        return res.status(extracted.statusCode).json({ success: false, error: extracted.message, code: 'QB_PAYMENT_SYNC_FAILED' });
      }
    } catch (error: any) {
      console.error("Error syncing payment to QB:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync payment to QuickBooks" });
    }
  });

  // ------------------------------------------------------------
  // Record payment on invoice (invoice-scoped)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/payments", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;
      if (!userId) return res.status(401).json({ error: "Missing user" });

      const rel = await getInvoiceWithRelations(req.params.id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const { amountCents, amount, method, note, notes } = req.body || {};
      const amt = amountCents !== undefined ? Number(amountCents) / 100 : Number(amount);
      if (!amt || !method) return res.status(400).json({ error: "amountCents/amount and method required" });

      const payment = await applyPayment(inv.id, userId, { amount: amt, method, notes: note ?? notes });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: "payment_recorded",
          entityType: "invoice",
          entityId: inv.id,
          entityName: String(inv.invoiceNumber),
          description: "Payment recorded",
          newValues: { amount: amt, method } as any,
          createdAt: new Date(),
        } as any);
      } catch {}

      res.json({ success: true, data: payment });
    } catch (error: any) {
      console.error("Error recording payment:", error);
      res.status(500).json({ error: error.message || "Failed to record payment" });
    }
  });

  // ------------------------------------------------------------
  // Update invoice (financial edits rules) - tenant-scoped
  // ------------------------------------------------------------
  app.patch("/api/invoices/:id", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const { id } = req.params;
      const existingRel = await getInvoiceWithRelations(id);
      if (!existingRel) return res.status(404).json({ error: "Invoice not found" });
      const existing: any = existingRel.invoice;
      if (existing.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const existingStatus = String(existing.status || "").toLowerCase();
      const isPaid = existingStatus === "paid";
      const isVoid = existingStatus === "void";
      const balanceDue = Number(existing.balanceDue || Number(existing.total) - Number(existing.amountPaid));
      const isBilledUnpaid = existingStatus === "billed" && balanceDue > 0;

      const existingInvoiceVersion = Number(existing.invoiceVersion || 1);

      const updates: any = {};
      if (typeof req.body.notesPublic === "string") updates.notesPublic = req.body.notesPublic;
      if (typeof req.body.notesInternal === "string") updates.notesInternal = req.body.notesInternal;
      if (typeof req.body.terms === "string") updates.terms = req.body.terms;

      let nextDueDate: Date | undefined;
      if (typeof req.body.customDueDate === "string") {
        const d = new Date(req.body.customDueDate);
        if (!Number.isNaN(d.getTime())) {
          nextDueDate = d;
          updates.dueDate = d;
        }
      }

      // Customer/customer-visible identity changes
      if (typeof req.body.customerId === "string" && req.body.customerId && req.body.customerId !== existing.customerId) {
        if (isPaid) return res.status(400).json({ error: "Paid invoices are locked" });
        if (isVoid) return res.status(400).json({ error: "Void invoices are locked" });
        updates.customerId = req.body.customerId;
      }

      const financialUpdates: any = {};
      const hasFinancialBody = req.body.subtotalCents !== undefined || req.body.taxCents !== undefined || req.body.shippingCents !== undefined;

      const existingDueMs = existing.dueDate ? new Date(existing.dueDate as any).getTime() : null;
      const nextDueMs = nextDueDate ? nextDueDate.getTime() : null;

      const nextSubtotalCents = req.body.subtotalCents !== undefined ? Number(req.body.subtotalCents) : Number(existing.subtotalCents || 0);
      const nextTaxCents = req.body.taxCents !== undefined ? Number(req.body.taxCents) : Number(existing.taxCents || 0);
      const nextShippingCents = req.body.shippingCents !== undefined ? Number(req.body.shippingCents) : Number(existing.shippingCents || 0);
      const computedNextTotalCents = Math.max(0, Math.round(nextSubtotalCents) + Math.round(nextTaxCents) + Math.round(nextShippingCents));

      const financialOrCustomerVisibleChanged =
        (hasFinancialBody && (
          Math.round(nextSubtotalCents) !== Number(existing.subtotalCents || 0) ||
          Math.round(nextTaxCents) !== Number(existing.taxCents || 0) ||
          Math.round(nextShippingCents) !== Number(existing.shippingCents || 0) ||
          computedNextTotalCents !== Number(existing.totalCents || 0)
        )) ||
        (typeof req.body.customerId === "string" && req.body.customerId && req.body.customerId !== existing.customerId) ||
        (nextDueDate !== undefined && existingDueMs !== nextDueMs);

      const nextInvoiceVersion = financialOrCustomerVisibleChanged ? existingInvoiceVersion + 1 : existingInvoiceVersion;
      if (financialOrCustomerVisibleChanged) {
        updates.invoiceVersion = nextInvoiceVersion;

        if (String(existing.qbSyncStatus || "") === "synced") {
          // Financial/customer-visible changes invalidate previous accounting sync.
          financialUpdates.qbSyncStatus = "needs_resync";
        }
      }

      if (hasFinancialBody) {
        if (isPaid) return res.status(400).json({ error: "Paid invoices are locked" });
        if (isVoid) return res.status(400).json({ error: "Void invoices are locked" });

        financialUpdates.subtotalCents = Math.max(0, Math.round(nextSubtotalCents));
        financialUpdates.taxCents = Math.max(0, Math.round(nextTaxCents));
        financialUpdates.shippingCents = Math.max(0, Math.round(nextShippingCents));
        financialUpdates.totalCents = computedNextTotalCents;
        financialUpdates.subtotal = (financialUpdates.subtotalCents / 100).toFixed(2);
        financialUpdates.tax = (financialUpdates.taxCents / 100).toFixed(2);
        financialUpdates.total = (financialUpdates.totalCents / 100).toFixed(2);
        financialUpdates.balanceDue = String(Math.max(0, Number(financialUpdates.total) - Number(existing.amountPaid)));

        if (!(existingStatus === "draft" || isBilledUnpaid)) {
          return res.status(400).json({ error: "Invoice cannot be financially edited in its current status" });
        }

        if (isBilledUnpaid) {
          financialUpdates.modifiedAfterBilling = true;
          if (!financialUpdates.qbSyncStatus) financialUpdates.qbSyncStatus = "pending";
        }

        try {
          await db.insert(auditLogs).values({
            organizationId,
            userId: userId || null,
            userName,
            actionType: "invoice_financial_edited_after_billing",
            entityType: "invoice",
            entityId: id,
            entityName: String(existing.invoiceNumber),
            description: `Invoice financials updated${isBilledUnpaid ? " (post-billing)" : ""}`,
            oldValues: { subtotalCents: existing.subtotalCents, taxCents: existing.taxCents, shippingCents: existing.shippingCents, totalCents: existing.totalCents } as any,
            newValues: { subtotalCents: financialUpdates.subtotalCents, taxCents: financialUpdates.taxCents, shippingCents: financialUpdates.shippingCents, totalCents: financialUpdates.totalCents } as any,
            createdAt: new Date(),
          } as any);
        } catch {}
      }

      await db.update(invoices).set({ ...updates, ...financialUpdates, updatedAt: new Date() } as any).where(eq(invoices.id, id));

      // Auto-attempt QB sync on billed+unpaid financial edits (fail-soft)
      if (hasFinancialBody && isBilledUnpaid) {
        try {
          const qb = await syncSingleInvoiceToQuickBooksForOrganization(organizationId, id);
          await db
            .update(invoices)
            .set({ qbInvoiceId: qb.qbInvoiceId, externalAccountingId: qb.qbInvoiceId, qbSyncStatus: "synced", qbLastError: null, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastQbSyncedVersion: nextInvoiceVersion, updatedAt: new Date() } as any)
            .where(eq(invoices.id, id));
        } catch (e: any) {
          await db
            .update(invoices)
            .set({ qbSyncStatus: "failed", qbLastError: String(e?.message || e), syncStatus: "error", syncError: String(e?.message || e), updatedAt: new Date() } as any)
            .where(eq(invoices.id, id));
        }
      }

      const refreshed = await getInvoiceWithRelations(id);
      res.json({ success: true, data: refreshed?.invoice ?? null });
    } catch (error: any) {
      console.error("Error updating invoice:", error);
      res.status(500).json({ error: error.message || "Failed to update invoice" });
    }
  });

  // ------------------------------------------------------------
  // Mark invoice as sent (read-only semantics; does not change financial status)
  // ------------------------------------------------------------
  app.post("/api/invoices/:id/mark-sent", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const userName = `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() || req.user?.email;

      const { id } = req.params;
      const via = req.body?.via;
      if (via !== "email" && via !== "manual" && via !== "portal") {
        return res.status(400).json({ error: "Invalid via. Expected 'email' | 'manual' | 'portal'" });
      }

      const rel = await getInvoiceWithRelations(id);
      if (!rel) return res.status(404).json({ error: "Invoice not found" });
      const inv: any = rel.invoice;
      if (inv.organizationId !== organizationId) return res.status(404).json({ error: "Invoice not found" });

      const now = new Date();
      const invoiceVersion = Number(inv.invoiceVersion || 1);

      await db
        .update(invoices)
        .set({ lastSentAt: now, lastSentVia: via, lastSentVersion: invoiceVersion, updatedAt: now } as any)
        .where(eq(invoices.id, id));

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: "invoice.sent",
          entityType: "invoice",
          entityId: id,
          entityName: String(inv.invoiceNumber),
          description: "Invoice marked as sent",
          newValues: { via, invoiceVersion } as any,
          createdAt: now,
        } as any);
      } catch {}

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error marking invoice sent:", error);
      res.status(500).json({ error: error.message || "Failed to mark invoice sent" });
    }
  });

  // ------------------------------------------------------------
  // Orders: billing-ready override / clear override
  // ------------------------------------------------------------
  app.post("/api/orders/:id/billing-ready-override", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const userId = getUserId(req.user);
      const orderId = req.params.id;
      const note = typeof req.body?.note === "string" ? req.body.note : null;

      const now = new Date();

      await db
        .update(orders)
        .set({ billingStatus: "ready", billingReadyAt: now, billingReadyOverride: true, billingReadyOverrideNote: note, billingReadyOverrideAt: now, billingReadyOverrideByUserId: userId || null, updatedAt: sql`now()` as any } as any)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting billing override:", error);
      res.status(500).json({ error: error.message || "Failed to set override" });
    }
  });

  app.post("/api/orders/:id/clear-billing-ready-override", isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ error: "Missing organization context" });

      const orderId = req.params.id;

      await db
        .update(orders)
        .set({ billingReadyOverride: false, billingReadyOverrideNote: null, billingReadyOverrideAt: null, billingReadyOverrideByUserId: null, updatedAt: sql`now()` as any } as any)
        .where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));

      await recomputeOrderBillingStatus({ organizationId, orderId });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error clearing billing override:", error);
      res.status(500).json({ error: error.message || "Failed to clear override" });
    }
  });
}
