import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { customerStatementPdfFilename, generateCustomerStatementPdfBytes } from "../lib/customerStatementPdf";
import { createInvoicePdfEmailAttachment } from "../services/invoiceEmailAttachment";
import { emailService } from "../emailService";
import { customerStatementEmailLogs, customerStatementSnapshots } from "../../shared/schema";
import { enqueueCustomerStatementEmailDelivery, markInvoiceEmailDeliveryProviderSubmissionStarted, registerCanonicalCustomerStatementEmailSender } from "../services/invoiceBulkEmailQueue.service";
import { getCustomerStatement, getCustomerStatementRecipients, type CustomerStatement } from "../services/customerStatement.service";
import { normalizeExplicitInvoiceRecipientEmails } from "../../shared/invoiceEmailRecipients";

const statementEmailRequestSchema = z.object({
  recipientEmails: z.array(z.string()).min(1).max(20),
  selectedContactIds: z.array(z.string().min(1)).max(100).default([]),
  manualRecipientEmails: z.array(z.string()).max(20).default([]),
  subject: z.string().trim().min(1).max(250),
  message: z.string().trim().min(1).max(10000),
  idempotencyKey: z.string().trim().min(8).max(200),
});

function userId(req: any): string | null { return req.user?.claims?.sub || req.user?.id || null; }
function userName(req: any): string | null { return req.user?.claims?.name || req.user?.name || null; }
function escapeHtml(value: string): string { return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] || character)); }

async function sendFrozenCustomerStatement(input: { organizationId: string; statementSnapshotId: string; userId: string | null; userName: string | null; toEmail: string; deliveryJobId: string; subject?: string | null; message?: string | null }): Promise<{ messageId: string | null }> {
  const [snapshot] = await db.select().from(customerStatementSnapshots).where(and(
    eq(customerStatementSnapshots.id, input.statementSnapshotId),
    eq(customerStatementSnapshots.organizationId, input.organizationId),
  )).limit(1);
  if (!snapshot) throw Object.assign(new Error("The frozen customer statement is no longer available."), { code: "STATEMENT_SNAPSHOT_NOT_FOUND", statusCode: 404 });
  const statement = snapshot.payload as unknown as CustomerStatement;
  // Snapshots queued before the byte-freeze migration retain their historical
  // projection fallback. New jobs always attach the exact stored PDF bytes.
  const pdfBytes = snapshot.pdfBytes ? new Uint8Array(snapshot.pdfBytes) : await generateCustomerStatementPdfBytes(statement);
  const attachment = await createInvoicePdfEmailAttachment({ filename: customerStatementPdfFilename(statement), pdfBytes });
  await markInvoiceEmailDeliveryProviderSubmissionStarted({ organizationId: input.organizationId, deliveryJobId: input.deliveryJobId });
  const messageId = await emailService.sendEmail(input.organizationId, {
    to: input.toEmail,
    subject: input.subject || `${statement.organization.companyName} customer statement`,
    text: input.message || `Hello,\n\nAttached is your customer statement dated ${statement.statementDate}. Current balance due: $${(statement.summary.amountDueCents / 100).toFixed(2)}.\n\nThank you,\n${statement.organization.companyName}`,
    html: `<p>${escapeHtml(input.message || `Hello,\n\nAttached is your customer statement dated ${statement.statementDate}. Current balance due: $${(statement.summary.amountDueCents / 100).toFixed(2)}.\n\nThank you,\n${statement.organization.companyName}`).replace(/\n/g, "<br>")}</p>`,
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
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${customerStatementPdfFilename(statement)}"`);
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
  app.get("/api/customers/:id/current-statement/email-draft", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const statement = await load(req);
      const amountDue = `$${(statement.summary.amountDueCents / 100).toFixed(2)}`;
      return res.json({ success: true, data: {
        subject: `Statement from ${statement.organization.companyName}`,
        message: `Hello,\n\nAttached is your current account statement as of ${statement.statementDate}.\n\nBalance Due: ${amountDue}\n\nThank you,\n${statement.organization.companyName}`,
      } });
    } catch (error: any) { return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to prepare statement email" }); }
  });
  app.post("/api/customers/:id/current-statement/email", middleware.isAuthenticated, middleware.tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: "Missing organization context" });
      const parsed = statementEmailRequestSchema.parse(req.body);
      const recipientEmails = normalizeExplicitInvoiceRecipientEmails(parsed.recipientEmails);
      const idempotencyKey = `statement:${req.params.id}:${parsed.idempotencyKey}`;
      const statement = await getCustomerStatement({ organizationId, customerId: req.params.id });
      let [snapshot] = await db.select().from(customerStatementSnapshots).where(and(
        eq(customerStatementSnapshots.organizationId, organizationId),
        eq(customerStatementSnapshots.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (!snapshot) {
        const pdfBytes = await generateCustomerStatementPdfBytes(statement);
        const inserted = await db.insert(customerStatementSnapshots).values({
          organizationId,
          customerId: req.params.id,
          idempotencyKey,
          statementDate: statement.statementDate,
          payload: statement as any,
          pdfBytes: Buffer.from(pdfBytes),
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
        recipientEmails,
        selectedContactIds: parsed.selectedContactIds,
        manualRecipientEmails: parsed.manualRecipientEmails.length ? normalizeExplicitInvoiceRecipientEmails(parsed.manualRecipientEmails) : [],
        subject: parsed.subject,
        message: parsed.message,
        idempotencyKey,
      });
      return res.status(202).json({ success: true, data: { ...queue, statementSnapshotId: snapshot.id, status: queue.queued ? "queued" : "already_queued" } });
    } catch (error: any) {
      if (error instanceof z.ZodError || error?.message?.includes("recipient email")) return res.status(400).json({ success: false, error: "Select at least one valid customer email recipient." });
      return res.status(error?.statusCode || 500).json({ success: false, error: error?.message || "Unable to queue customer statement email" });
    }
  });
}
