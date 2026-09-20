import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { generateCustomerStatementPdfBytes } from "../lib/customerStatementPdf";
import { createInvoicePdfEmailAttachment } from "../services/invoiceEmailAttachment";
import { emailService } from "../emailService";
import { customerStatementEmailLogs, customerStatementSnapshots } from "../../shared/schema";
import { enqueueCustomerStatementEmailDelivery, markInvoiceEmailDeliveryProviderSubmissionStarted, registerCanonicalCustomerStatementEmailSender } from "../services/invoiceBulkEmailQueue.service";
import { getCustomerStatement, getCustomerStatementRecipients, type CustomerStatement } from "../services/customerStatement.service";

const statementEmailRequestSchema = z.object({
  recipientEmails: z.array(z.string().email()).min(1).max(20),
  idempotencyKey: z.string().trim().min(8).max(200),
});

function userId(req: any): string | null { return req.user?.claims?.sub || req.user?.id || null; }
function userName(req: any): string | null { return req.user?.claims?.name || req.user?.name || null; }
function escapeHtml(value: string): string { return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] || character)); }

async function sendFrozenCustomerStatement(input: { organizationId: string; statementSnapshotId: string; userId: string | null; userName: string | null; toEmail: string; deliveryJobId: string }): Promise<{ messageId: string | null }> {
  const [snapshot] = await db.select().from(customerStatementSnapshots).where(and(
    eq(customerStatementSnapshots.id, input.statementSnapshotId),
    eq(customerStatementSnapshots.organizationId, input.organizationId),
  )).limit(1);
  if (!snapshot) throw Object.assign(new Error("The frozen customer statement is no longer available."), { code: "STATEMENT_SNAPSHOT_NOT_FOUND", statusCode: 404 });
  const statement = snapshot.payload as unknown as CustomerStatement;
  const pdfBytes = await generateCustomerStatementPdfBytes(statement);
  const safeName = statement.customer.companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
  const attachment = await createInvoicePdfEmailAttachment({ filename: `statement-${safeName}-${statement.statementDate}.pdf`, pdfBytes });
  await markInvoiceEmailDeliveryProviderSubmissionStarted({ organizationId: input.organizationId, deliveryJobId: input.deliveryJobId });
  const messageId = await emailService.sendEmail(input.organizationId, {
    to: input.toEmail,
    subject: `${statement.organization.companyName} customer statement`,
    text: `Hello,\n\nAttached is your customer statement dated ${statement.statementDate}. Current balance due: $${(statement.summary.amountDueCents / 100).toFixed(2)}.\n\nThank you,\n${statement.organization.companyName}`,
    html: `<p>Hello,</p><p>Attached is your customer statement dated ${escapeHtml(statement.statementDate)}.</p><p><strong>Current balance due: $${(statement.summary.amountDueCents / 100).toFixed(2)}</strong></p><p>Thank you,<br>${escapeHtml(statement.organization.companyName)}</p>`,
    attachments: [attachment] as any,
    deliveryJobId: input.deliveryJobId,
  });
  await db.insert(customerStatementEmailLogs).values({
    organizationId: input.organizationId,
    statementSnapshotId: snapshot.id,
    recipientEmail: input.toEmail.trim().toLowerCase(),
    status: "sent",
    messageId,
    sentAt: new Date(),
  });
  return { messageId };
}

/** Staff-only current A/R statement. It deliberately uses a distinct endpoint
 * from the legacy customer activity statement to preserve that view's filters. */
export function registerCustomerStatementRoutes(app: Express, middleware: { isAuthenticated: any; tenantContext: any }): void {
  // The worker owns actual delivery. This sender only renders the immutable
  // snapshot that was created before the queue job was enqueued.
  registerCanonicalCustomerStatementEmailSender(sendFrozenCustomerStatement);
  const load = async (req: any) => {
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) throw Object.assign(new Error("Missing organization context"), { statusCode: 500 });
    return getCustomerStatement({ organizationId, customerId: req.params.id });
  };
  app.get("/api/customers/:id/current-statement", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try { return res.json({ success: true, data: await load(req) }); }
    catch (error: any) { return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to build customer statement" }); }
  });
  app.get("/api/customers/:id/current-statement/pdf", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const statement = await load(req);
      const pdf = await generateCustomerStatementPdfBytes(statement);
      const safeName = statement.customer.companyName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "customer";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="statement-${safeName}-${statement.statementDate}.pdf"`);
      return res.send(Buffer.from(pdf));
    } catch (error: any) { return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to render customer statement" }); }
  });
  app.get("/api/customers/:id/current-statement/recipients", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      return res.json({ success: true, data: await getCustomerStatementRecipients({ organizationId, customerId: req.params.id }) });
    } catch (error: any) { return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to resolve statement recipients" }); }
  });
  app.post("/api/customers/:id/current-statement/email", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const parsed = statementEmailRequestSchema.parse(req.body);
      const idempotencyKey = `statement:${req.params.id}:${parsed.idempotencyKey}`;
      const statement = await getCustomerStatement({ organizationId, customerId: req.params.id });
      let [snapshot] = await db.select().from(customerStatementSnapshots).where(and(
        eq(customerStatementSnapshots.organizationId, organizationId),
        eq(customerStatementSnapshots.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (!snapshot) {
        const inserted = await db.insert(customerStatementSnapshots).values({
          organizationId,
          customerId: req.params.id,
          idempotencyKey,
          statementDate: statement.statementDate,
          payload: statement as any,
          createdByUserId: userId(req),
        }).onConflictDoNothing().returning();
        snapshot = inserted[0] || (await db.select().from(customerStatementSnapshots).where(and(
          eq(customerStatementSnapshots.organizationId, organizationId),
          eq(customerStatementSnapshots.idempotencyKey, idempotencyKey),
        )).limit(1))[0];
      }
      if (!snapshot) throw new Error("Unable to create the customer statement delivery snapshot.");
      const queue = await enqueueCustomerStatementEmailDelivery({
        organizationId,
        statementSnapshotId: snapshot.id,
        createdByUserId: userId(req),
        createdByUserName: userName(req),
        recipientEmails: parsed.recipientEmails,
        idempotencyKey,
      });
      return res.status(202).json({ success: true, data: { ...queue, statementSnapshotId: snapshot.id, status: queue.queued ? "queued" : "already_queued" } });
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "Select at least one valid customer email recipient." });
      return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to queue customer statement email" });
    }
  });
}
