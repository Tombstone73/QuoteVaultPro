import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("single Invoice email compose contract", () => {
  test("exposes a tenant-scoped, read-only default compose endpoint", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");
    const start = route.indexOf('app.get("/api/invoices/:id/email-draft"');
    const endpoint = route.slice(start, route.indexOf('// Replays a durably captured provider observation', start));

    expect(start).toBeGreaterThan(-1);
    expect(endpoint).toContain("resolveInvoiceEmailRecipientsForOperations");
    expect(endpoint).toContain("buildInvoiceEmailComposeContext");
    expect(endpoint).not.toContain("createInvoiceEmailLog");
    expect(endpoint).not.toContain("applyInvoiceSendSuccessLifecycle");
    expect(endpoint).not.toContain("emailService.sendEmail");
    expect(endpoint).not.toContain("db.update");
  });

  test("validates and renders staff edits only through the canonical single sender", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");

    expect(route).toContain("subject?: unknown;");
    expect(route).toContain("message?: unknown;");
    expect(route).toContain("const compose = resolveInvoiceEmailCompose");
    expect(route).toContain("subject: compose.subject");
    expect(route).toContain("message: compose.message");
    expect(route).toContain("customizedSubject: compose.customizedSubject");
    expect(route).toContain("customizedMessage: compose.customizedMessage");
    expect(route).not.toContain('startingStatus === "paid") throw');
  });

  test("keeps the durable bulk worker on default canonical content", () => {
    const route = source("server/routes/mvpInvoicing.routes.ts");
    const queue = source("server/services/invoiceBulkEmailQueue.service.ts");

    expect(route).toContain("registerCanonicalInvoiceEmailSender(sendInvoiceEmailForOperations)");
    expect(queue).toContain("canonicalInvoiceEmailSender");
    expect(queue).not.toContain("customizedMessage");
  });
});
