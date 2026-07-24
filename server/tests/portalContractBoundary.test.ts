import fs from "node:fs";
import path from "node:path";

import { getPortalScope } from "../services/portal.service";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sourceForExport(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  if (start < 0) throw new Error(`Missing ${exportName}`);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

function portalRequest(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: "portal_user_1" },
    organizationId: "org_1",
    portalCustomerId: "customer_1",
    portalCustomer: {
      id: "customer_1",
      organizationId: "org_1",
      companyName: "Acme Print",
    },
    ...overrides,
  } as any;
}

describe("customer portal contract boundary", () => {
  test("derives portal authority from the authenticated user, organization, and matching customer context", () => {
    expect(getPortalScope(portalRequest())).toMatchObject({
      userId: "portal_user_1",
      organizationId: "org_1",
      customerId: "customer_1",
    });

    expect(() => getPortalScope(portalRequest({ user: undefined }))).toThrow("Portal customer scope is required");
    expect(() => getPortalScope(portalRequest({ organizationId: undefined }))).toThrow("Portal customer scope is required");
    expect(() => getPortalScope(portalRequest({ portalCustomerId: "customer_2" }))).toThrow("Portal customer scope is required");
    expect(() => getPortalScope(portalRequest({ portalCustomer: { id: "customer_1", organizationId: "org_2" } }))).toThrow(
      "Portal customer scope is required",
    );
  });

  test("all customer portal routes use the authenticated portal middleware boundary", () => {
    const routes = read("server/routes/portal.routes.ts");
    const customerRouteLines = routes
      .split("\n")
      .filter((line) => line.trimStart().startsWith("app.") && line.includes('"/api/portal/'))
      .filter((line) => !line.includes('"/api/portal/debug/'));

    expect(customerRouteLines.length).toBeGreaterThan(20);
    for (const line of customerRouteLines) {
      expect(line).toContain("...portalMiddlewares");
    }
    expect(routes).toContain("const portalMiddlewares = [isAuthenticated, portalContext, denyStaffPreviewMutations]");
  });

  test("the canonical contract documents the supported portal surface and explicit exclusions", () => {
    const contract = read("docs/CUSTOMER_PORTAL_CONTRACT.md");

    for (const path of [
      "/api/portal/me",
      "/api/portal/dashboard",
      "/api/portal/profile",
      "/api/portal/invoices/:id/payments/stripe/create-intent",
      "/api/portal/invoices/:id/payments/stripe/confirm",
      "/api/portal/proofs/:id/approve",
      "/api/portal/quotes/:id/approve",
      "/api/portal/quotes/:id/files",
      "/api/portal/orders/:id/files",
    ]) {
      expect(contract).toContain(path);
    }
    expect(contract).toContain("customerId");
    expect(contract).toContain("EPS automatic portal settlement is explicitly out of scope");
    expect(contract).toContain("MCP dependency");
  });

  test("record, file, and action handlers resolve scope before working with portal data", () => {
    const service = read("server/services/portal.service.ts");
    const scopedHandlers = [
      "getPortalSession",
      "getPortalDashboard",
      "getPortalProfile",
      "updatePortalProfile",
      "listPortalInvoices",
      "getPortalInvoice",
      "getPortalInvoicePdf",
      "listPortalOrders",
      "getPortalOrder",
      "listPortalProofs",
      "getPortalProof",
      "listPortalQuotes",
      "getPortalQuote",
      "approvePortalQuote",
      "declinePortalQuote",
      "requestPortalQuoteRevision",
    ];

    for (const handler of scopedHandlers) {
      expect(sourceForExport(service, handler)).toContain("getPortalScope(req)");
    }
  });

  test("file downloads are backend-scoped and never routed through object storage directly from the portal", () => {
    const routes = read("server/routes/portal.routes.ts");
    const service = read("server/services/portal.service.ts");
    const frontend = read("client/src/hooks/usePortal.ts");

    expect(routes).toContain("portalFileDownload(getPortalInvoiceFileDownload)");
    expect(routes).toContain("portalFileDownload(getPortalOrderFileDownload)");
    expect(routes).toContain("portalFileDownload(getPortalQuoteFileDownload)");
    expect(routes).toContain("portalProofFileDownload(getPortalProofFileDownload)");
    expect(service).toContain("loadVisibleOrderAttachments(scope, orderId)");
    expect(service).toContain("loadVisibleQuoteAttachments(scope, quoteId)");
    expect(sourceForExport(service, "getPortalProofFileDownload")).toContain("loadPortalProofRows(scope, proofId)");
    expect(frontend).not.toContain("/api/objects/");
  });

  test("customer file submissions stay inside the portal boundary and are scoped before canonical storage writes", () => {
    const routes = read("server/routes/portal.routes.ts");
    const service = read("server/services/portal.service.ts");

    expect(routes).toContain('app.post("/api/portal/orders/:id/files", ...portalMiddlewares, portalPostById("id", submitPortalOrderFile))');
    expect(routes).toContain('app.post("/api/portal/quotes/:id/files", ...portalMiddlewares, portalPostById("id", submitPortalQuoteFile))');
    expect(service).toContain("const scope = getPortalScope(args.req)");
    expect(service).toContain("getScopedPortalQuoteId(scope, args.entityId)");
    expect(service).toContain("getScopedPortalOrderId(scope, args.entityId)");
    expect(service).toContain("storageApplicationService.finalizeUpload");
    expect(service).toContain('portalFileCategory: "customer_upload"');
    expect(service).toContain('reviewStatus: "pending_review"');
    expect(service).toContain("finalArtwork: false");
  });

  test("quote actions are scoped, serialized, audited, and use the canonical quote conversion service", () => {
    const service = read("server/services/portal.service.ts");

    for (const action of ["approvePortalQuote", "declinePortalQuote", "requestPortalQuoteRevision"]) {
      const actionSource = sourceForExport(service, action);
      expect(actionSource).toContain("getPortalScope(req)");
      expect(actionSource).toContain("lockPortalQuoteAction");
      expect(actionSource).toContain("getScopedPortalQuoteRecord(scope, quoteId)");
      expect(actionSource).toContain("writePortalQuoteAudit");
    }
    expect(sourceForExport(service, "approvePortalQuote")).toContain("storage.convertQuoteToOrder(scope.organizationId, quote.id, scope.userId)");
  });

  test("Stripe payment confirmation verifies server-side Stripe state and scoped metadata before invoice mutation", () => {
    const service = read("server/services/portal.service.ts");
    const createIntent = sourceForExport(service, "createPortalStripePaymentIntent");
    const confirm = sourceForExport(service, "confirmPortalStripePayment");

    expect(createIntent).toContain("getPortalInvoiceForPayment(scope, invoiceId)");
    expect(createIntent).toContain("organizationId: scope.organizationId");
    expect(createIntent).toContain("invoiceId: invoice.id");
    expect(confirm).toContain("getPortalInvoiceForPayment(scope, invoiceId)");
    expect(confirm).toContain("stripe.paymentIntents.retrieve(paymentIntentId");
    expect(confirm).toContain("metadata.organizationId");
    expect(confirm).toContain("metadata.invoiceId");
    expect(confirm).toContain('if (piStatus === "succeeded")');
    expect(confirm).toContain("reconcileSucceededStripePayment");
    expect(confirm).not.toContain("req.body.status");
    expect(confirm).not.toContain("req.body.success");
  });
});
