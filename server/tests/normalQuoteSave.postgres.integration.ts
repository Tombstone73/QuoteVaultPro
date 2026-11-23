import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { and, eq } from "drizzle-orm";
import type { PgSelectBase } from "drizzle-orm/pg-core";
import express from "express";
import request from "supertest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { assistantQuoteIntakeSessions, auditLogs, customerContacts, customers, organizations, pbv2TreeVersions, products, quoteLineItems, quotes, users } from "@shared/schema";
import { db } from "../db";
import { registerQuoteRoutes } from "../routes/quotes.routes";
import { registerEmailRoutes } from "../routes/email.routes";
import { emailService } from "../emailService";
import { quoteDraftIntakeService } from "../services/assistant/quoteDraftIntakeService";
import { snapshotCustomerData } from "../services/quotes/quoteCustomerSnapshot";
import type { ProofingPolicy } from "@shared/proofApprovalLock";
import { QuotesRepository } from "../storage/quotes.repo";

const created: Array<{ organizationId: string; userId: string }> = [];

async function fixture(proof?: { policy: ProofingPolicy; locked?: boolean; productDefault?: boolean }) {
  const suffix = randomUUID();
  const [organization] = await db.insert(organizations).values({
    name: `Quote save ${suffix}`, slug: `quote-save-${suffix}`,
    settings: proof ? { preferences: { proofing: { policy: proof.policy, proofApprovalLockEnabled: proof.locked } } } : undefined,
  }).returning();
  const [user] = await db.insert(users).values({ email: `quote-save-${suffix}@example.test`, firstName: "Quote", lastName: "Save", role: "admin" }).returning();
  created.push({ organizationId: organization.id, userId: user.id });
  const [product] = await db.insert(products).values({
    organizationId: organization.id, name: "Synthetic product", description: "Disposable test product",
    requiresProofApproval: proof?.productDefault,
  }).returning();
  const [tree] = await db.insert(pbv2TreeVersions).values({ organizationId: organization.id, productId: product.id, status: "ACTIVE", schemaVersion: 2, treeJson: { schemaVersion: 2, status: "ACTIVE", rootNodeIds: [], nodes: {}, edges: [], meta: { pricingV2: { base: { perPieceCents: 1000 } } } } }).returning();
  await db.update(products).set({ pbv2ActiveTreeVersionId: tree.id }).where(eq(products.id, product.id));
  const [quote] = await db.insert(quotes).values({ organizationId: organization.id, userId: user.id, status: "draft", customerName: "Fixture", shippingMethod: "ship", shippingCents: 500, shipToAddress1: "99 Custom Lane", shipToState: "IN" }).returning();
  const [line] = await db.insert(quoteLineItems).values({ quoteId: quote.id, productId: product.id, productName: product.name, width: "1", height: "1", quantity: 1, pbv2SnapshotJson: {}, linePrice: "10", priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "" } }).returning();
  const app = express();
  app.use(express.json());
  const middleware = {
    isAuthenticated: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { user: { id: user.id, role: "admin" } }); next(); },
    isAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
    tenantContext: (req: express.Request, _res: express.Response, next: express.NextFunction) => { Object.assign(req, { organizationId: organization.id, orgRole: "admin" }); next(); },
  };
  registerQuoteRoutes(app, middleware);
  registerEmailRoutes(app, middleware);
  return { app, organization, user, product, tree, quote, line };
}

const lineData = (productId: string, changes: Record<string, unknown> = {}) => ({
  productId, productName: "Synthetic product", width: 1, height: 1, quantity: 1,
  optionSelectionsJson: null, description: null, status: "active", ...changes,
});

async function stored(quoteId: string) {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  const lines = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, quoteId));
  const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "quote"), eq(auditLogs.entityId, quoteId)));
  return { quote, lines, audits };
}

afterEach(async () => {
  for (const row of created.splice(0)) {
    await db.delete(quotes).where(eq(quotes.organizationId, row.organizationId));
    await db.delete(organizations).where(eq(organizations.id, row.organizationId));
    await db.delete(users).where(eq(users.id, row.userId));
  }
});

describe("Quote customer snapshot contracts", () => {
  async function identity(organizationId: string, alwaysRequireProof = false) {
    const [customer] = await db.insert(customers).values({
      organizationId, companyName: "Snapshot Company", phone: "555-0100", email: "company@example.test",
      billingStreet1: "1 Billing Lane", billingStreet2: "Suite B", billingCity: "Billing City",
      billingState: "IN", billingPostalCode: "46001",
      shippingStreet1: "2 Shipping Lane", shippingStreet2: "Dock S", shippingCity: "Shipping City",
      shippingState: "OH", shippingPostalCode: "43001", shippingCountry: "US",
      alwaysRequireProof,
    }).returning();
    const [contact] = await db.insert(customerContacts).values({
      organizationId, customerId: customer.id, firstName: "Selected", lastName: "Contact",
      email: "contact@example.test",
    }).returning();
    return { customer, contact };
  }

  test.each([
    ["pickup", "1 Billing Lane", "Suite B", "Billing City", "IN", "46001"],
    ["ship", "2 Shipping Lane", "Dock S", "Shipping City", "OH", "43001"],
    ["deliver", "2 Shipping Lane", "Dock S", "Shipping City", "OH", "43001"],
  ])("projects the selected contact and customer address fields for %s", async (method, street, suite, city, state, postalCode) => {
    const f = await fixture();
    const { customer, contact } = await identity(f.organization.id);
    expect(await snapshotCustomerData(f.organization.id, customer.id, contact.id, method, "multi_shipment")).toEqual({
      billToName: "Selected Contact", billToCompany: "Snapshot Company", billToAddress1: "1 Billing Lane",
      billToAddress2: "Suite B", billToCity: "Billing City", billToState: "IN", billToPostalCode: "46001",
      billToCountry: "US", billToPhone: "555-0100", billToEmail: "company@example.test",
      shipToName: "Selected Contact", shipToCompany: "Snapshot Company", shipToAddress1: street,
      shipToAddress2: suite, shipToCity: city, shipToState: state, shipToPostalCode: postalCode,
      shipToCountry: "US", shipToPhone: "555-0100", shipToEmail: "company@example.test",
      shippingMethod: method, shippingMode: "multi_shipment",
    });
  });

  test("uses legacy addresses, falls back to billing and defaults missing inputs", async () => {
    const f = await fixture();
    const [customer] = await db.insert(customers).values({
      organizationId: f.organization.id, companyName: "Legacy Company", billingStreet1: "", billingAddress: "Legacy Bill",
      shippingStreet1: "", shippingAddress: "Legacy Ship",
    }).returning();
    const defaultSnapshot = await snapshotCustomerData(f.organization.id, customer.id);
    expect(defaultSnapshot).toMatchObject({
      billToName: "Legacy Company", billToAddress1: "Legacy Bill", billToAddress2: null,
      shipToName: "Legacy Company", shipToAddress1: "Legacy Ship", shipToAddress2: null,
      shippingMethod: "ship", shippingMode: "single_shipment",
    });
    expect(await snapshotCustomerData(f.organization.id, customer.id, randomUUID(), "", null)).toEqual(defaultSnapshot);
    expect(await snapshotCustomerData(f.organization.id, customer.id, null, null, "")).toEqual(defaultSnapshot);

    await db.update(customers).set({ shippingAddress: null, shippingCity: "Incomplete Destination" }).where(eq(customers.id, customer.id));
    expect(await snapshotCustomerData(f.organization.id, customer.id)).toMatchObject({
      shipToAddress1: "Legacy Bill", shipToCity: null, shipToCountry: "US",
    });
    await expect(snapshotCustomerData(randomUUID(), customer.id)).rejects.toThrow(`Customer not found: ${customer.id}`);
  });

  test("reads an uncommitted customer through the supplied transaction", async () => {
    const f = await fixture();
    await db.transaction(async (tx) => {
      const [customer] = await tx.insert(customers).values({
        organizationId: f.organization.id, companyName: "Transaction Customer", billingStreet1: "Transaction Street",
      }).returning();
      const [contact] = await tx.insert(customerContacts).values({
        organizationId: f.organization.id, customerId: customer.id, firstName: "Transaction", lastName: "Contact",
      }).returning();
      await expect(snapshotCustomerData(f.organization.id, customer.id)).rejects.toThrow(`Customer not found: ${customer.id}`);
      expect(await snapshotCustomerData(f.organization.id, customer.id, contact.id, "pickup", null, tx)).toMatchObject({
        billToName: "Transaction Contact", shipToAddress1: "Transaction Street",
      });
    });
  });

  function staffPayload(f: Awaited<ReturnType<typeof fixture>>, customerId: string, contactId?: string) {
    return {
      hasLineItems: true, customerId, contactId, status: "approved", shippingMethod: "deliver",
      discountAmount: 2, shippingCents: 500,
      lineItems: [lineData(f.product.id, {
        quantity: 2, linePrice: 20, pbv2TreeVersionId: f.tree.id, pbv2SnapshotJson: { selectedOptions: [] },
        priceOverride: { mode: "override_total_after_margin", valueCents: 2500 }, overrideReason: "Synthetic override",
      })],
    };
  }

  test("mounted staff POST persists the draft and commercial fields with explicit Ship To precedence", async () => {
    const f = await fixture({ policy: "manual_requested_only", productDefault: true });
    const { customer, contact } = await identity(f.organization.id, true);
    const payload = staffPayload(f, customer.id, contact.id);
    const response = await request(f.app).post("/api/quotes").send({
      ...payload, lineItems: [{ ...payload.lineItems[0], requiresProofApproval: false }],
      shipToAddress1: "Custom Street", shipToAddress2: "", shipToState: null,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { id: expect.any(String), status: "draft", lineItems: [expect.objectContaining({ id: expect.any(String) })] } });
    const persisted = await stored(response.body.data.id);
    expect(persisted.quote).toMatchObject({
      organizationId: f.organization.id, userId: f.user.id, status: "draft", customerId: customer.id, contactId: contact.id,
      billToName: "Selected Contact", billToAddress1: "1 Billing Lane", shipToAddress1: "Custom Street",
      shipToAddress2: "", shipToState: null, shipToCity: "Shipping City",
    });
    expect(persisted.quote.jobNumber).toBeGreaterThan(0);
    expect(persisted.quote.quoteNumber).toBe(persisted.quote.jobNumber);
    expect(persisted.quote.displayNumber).toBe(String(persisted.quote.jobNumber));
    expect(Number(persisted.quote.subtotal)).toBe(25);
    expect(Number(persisted.quote.totalPrice)).toBe(28);
    expect(persisted.lines).toEqual([expect.objectContaining({
      pbv2TreeVersionId: f.tree.id, pbv2SnapshotJson: { selectedOptions: [] },
      overridePriceCents: 2500, overrideReason: "Synthetic override", requiresProofApproval: true,
    })]);
    expect(persisted.audits).toEqual([expect.objectContaining({ actionType: "CREATE" })]);
    const fresh = await request(f.app).get(`/api/quotes/${persisted.quote.id}`);
    expect(fresh.status).toBe(200);
    expect(fresh.body.lineItems).toEqual([expect.objectContaining({ requiresProofApproval: true })]);
  });

  test("mounted staff POST rejects foreign customers and contacts without creating a Quote", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const own = await identity(f.organization.id);
    const other = await identity(foreign.organization.id);
    const wrongCustomer = await request(f.app).post("/api/quotes").send(staffPayload(f, other.customer.id));
    expect(wrongCustomer.status).toBe(404);
    expect(wrongCustomer.body.code).toBe("CUSTOMER_NOT_FOUND");
    const wrongContact = await request(f.app).post("/api/quotes").send(staffPayload(f, own.customer.id, other.contact.id));
    expect(wrongContact.status).toBe(404);
    expect(wrongContact.body.code).toBe("CONTACT_NOT_FOUND");
    const rows = await db.select({ id: quotes.id }).from(quotes).where(eq(quotes.organizationId, f.organization.id));
    expect(rows).toEqual([{ id: f.quote.id }]);
  });

  function assistantInput(f: Awaited<ReturnType<typeof fixture>>, customerId: string, contactId: string) {
    return {
      organizationId: f.organization.id, userId: f.user.id, conversationId: randomUUID(),
      request: { customerId, contactId, shippingMethod: "pickup" as const, lines: [{ productId: f.product.id, width: 24, height: 24, quantity: 2, optionSelections: {} }] },
    };
  }

  test("Assistant draft preserves the reviewed snapshot, fingerprint and customer proof mandate", async () => {
    const f = await fixture({ policy: "manual_requested_only", productDefault: true });
    const { customer, contact } = await identity(f.organization.id, true);
    const input = assistantInput(f, customer.id, contact.id);
    const prepared = await quoteDraftIntakeService.prepareStructuredCreate(input);
    const [session] = await db.select().from(assistantQuoteIntakeSessions).where(eq(assistantQuoteIntakeSessions.conversationId, input.conversationId));
    expect(prepared.cards[0]?.details).toMatchObject({
      shippingMethod: "pickup", billTo: { name: "Selected Contact", address1: "1 Billing Lane" },
      shipTo: { name: "Selected Contact", address1: "1 Billing Lane" },
    });
    const proposalFingerprint = session.proposalFingerprint!;
    expect(prepared.cards[1]?.plan).toMatchObject({ proposalFingerprint });
    expect(await quoteDraftIntakeService.revalidateCreateProposal({
      organizationId: f.organization.id, quoteIntakeSessionId: session.id, expectedProposalFingerprint: proposalFingerprint,
    })).toMatchObject({ valid: true, proposal: { proposalFingerprint } });
    const draft = await quoteDraftIntakeService.createDraft({
      organizationId: f.organization.id, actorUserId: f.user.id, quoteIntakeSessionId: session.id, proposalFingerprint,
      assistantPlanId: randomUUID(), idempotencyKey: randomUUID(), correlationId: randomUUID(),
    });
    expect((await stored(draft.quote.id)).quote).toMatchObject({
      status: "draft", shippingMethod: "pickup", billToName: "Selected Contact", shipToAddress1: "1 Billing Lane",
    });
    expect((await stored(draft.quote.id)).lines).toEqual([expect.objectContaining({ requiresProofApproval: true })]);
    await db.update(customers).set({ billingStreet1: "Changed billing snapshot" }).where(eq(customers.id, customer.id));
    expect((await stored(draft.quote.id)).quote.billToAddress1).toBe("1 Billing Lane");
  });

  test("snapshot read failure is optional for staff POST and legacy PATCH but blocks editor and Assistant", async () => {
    const f = await fixture();
    const { customer, contact } = await identity(f.organization.id);
    const readFailure = new Error("Synthetic snapshot contact read failure");
    const selectPrototype = Object.getPrototypeOf(db.select().from(customerContacts)) as typeof PgSelectBase.prototype;
    const originalThen = selectPrototype.then;
    const snapshotReads = jest.fn();
    const select = jest.spyOn(selectPrototype, "then").mockImplementation(function (
      this: Pick<PgSelectBase<never, never, never>, "toSQL">, resolve, reject,
    ) {
      const { sql, params } = this.toSQL();
      // Match the snapshot's contact read only, leaving tenant identity queries intact.
      if (/from "customer_contacts" where "customer_contacts"\."id" = \$1 limit \$2$/.test(sql) && params[0] === contact.id) {
        snapshotReads();
        return Promise.reject(readFailure).then(resolve, reject);
      }
      return originalThen.call(this, resolve, reject);
    });
    try {
      const created = await request(f.app).post("/api/quotes").send(staffPayload(f, customer.id, contact.id));
      expect(created.status).toBe(200);
      expect((await stored(created.body.data.id)).quote.billToName).toBeNull();

      const original = await stored(f.quote.id);
      const edited = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
        expectedRevision: original.quote.revision, header: { customerId: customer.id, contactId: contact.id },
        lines: { create: [], update: [], delete: [] },
      });
      expect(edited.status).toBe(500);
      expect(await stored(f.quote.id)).toEqual(original);

      const updated = await request(f.app).patch(`/api/quotes/${f.quote.id}`).send({
        customerId: customer.id, contactId: contact.id, expectedRevision: original.quote.revision,
      });
      expect(updated.status).toBe(200);
      expect((await stored(f.quote.id)).quote).toMatchObject({ customerId: customer.id, billToName: null });

      const input = assistantInput(f, customer.id, contact.id);
      await expect(quoteDraftIntakeService.prepareStructuredCreate(input)).rejects.toBe(readFailure);
      const [session] = await db.select().from(assistantQuoteIntakeSessions).where(eq(assistantQuoteIntakeSessions.conversationId, input.conversationId));
      expect(session).toMatchObject({ status: "abandoned", quoteId: null });
      expect(snapshotReads).toHaveBeenCalledTimes(4);
    } finally {
      select.mockRestore();
    }
  });
});

describe("Quote proof persistence", () => {
  async function proofCustomer(f: Awaited<ReturnType<typeof fixture>>, alwaysRequireProof: boolean) {
    const [customer] = await db.insert(customers).values({
      organizationId: f.organization.id, userId: f.user.id, companyName: "Proof policy customer", alwaysRequireProof,
    }).returning();
    return customer;
  }

  test.each<{
    name: string; policy: ProofingPolicy; productDefault: boolean; mandate: boolean; requested?: boolean; locked?: boolean;
    expected: boolean; audited?: boolean;
  }>([
    { name: "manual customer mandate without product default", policy: "manual_requested_only", mandate: true, productDefault: false, expected: true },
    { name: "manual inherited product default", policy: "manual_requested_only", mandate: false, productDefault: true, requested: true, expected: false },
    { name: "manual deliberate request beyond product default", policy: "manual_requested_only", mandate: false, productDefault: false, requested: true, expected: true },
    { name: "automatic product default", policy: "automatic", mandate: false, productDefault: true, expected: true },
    { name: "automatic locked product default", policy: "automatic", mandate: false, productDefault: true, locked: true, requested: false, expected: true },
    { name: "automatic unlocked product override", policy: "automatic", mandate: false, productDefault: true, requested: false, expected: false, audited: true },
    { name: "automatic unchecked customer mandate", policy: "automatic", mandate: true, productDefault: true, requested: false, expected: true },
  ])("saves and audits $name", async ({ policy, productDefault, mandate, requested, locked, expected, audited }) => {
    const f = await fixture({ policy, productDefault, locked });
    const customer = await proofCustomer(f, mandate);
    const created = await request(f.app).post("/api/quotes").send({
      hasLineItems: true, customerId: customer.id,
      lineItems: [lineData(f.product.id, { linePrice: 10, requiresProofApproval: requested })],
    });
    expect(created.status).toBe(200);
    const state = await stored(created.body.data.id);
    expect(state.lines).toEqual([expect.objectContaining({ requiresProofApproval: expected })]);
    const audit = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityId, state.lines[0].id), eq(auditLogs.actionType, "PROOF_APPROVAL_MANUAL_OVERRIDE"),
    ));
    expect(audit).toHaveLength(audited ? 1 : 0);
  });

  test("contact-linked first save and legacy Quick Quote use the resolved customer mandate", async () => {
    const f = await fixture({ policy: "manual_requested_only", productDefault: true });
    const customer = await proofCustomer(f, true);
    const [contact] = await db.insert(customerContacts).values({
      organizationId: f.organization.id, customerId: customer.id, firstName: "Pre-upload", lastName: "Contact",
    }).returning();
    const lineItems = [lineData(f.product.id, { linePrice: 10 })];
    for (const owner of [{ contactId: contact.id }, { source: "customer_quick_quote" }]) {
      const created = await request(f.app).post("/api/quotes").send({ ...owner, hasLineItems: true, lineItems });
      expect(created.status).toBe(200);
      const state = await stored(created.body.data.id);
      expect(state.quote.customerId).toBe(customer.id);
      expect(state.lines).toEqual([expect.objectContaining({ requiresProofApproval: true })]);
    }
  });

  test("editor add/update and the standalone line PATCH preserve the mandate", async () => {
    const f = await fixture({ policy: "manual_requested_only", productDefault: true });
    const customer = await proofCustomer(f, true);
    const added = lineData(f.product.id, { requiresProofApproval: false });
    const prior = await stored(f.quote.id);
    const editor = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: prior.quote.revision, header: { customerId: customer.id },
      lines: { create: [{ clientKey: "new", data: added }], update: [{ id: f.line.id, data: added }], delete: [] },
    });
    expect(editor.status).toBe(200);
    expect((await stored(f.quote.id)).lines.map(line => line.requiresProofApproval)).toEqual([true, true]);
    const patch = await request(f.app).patch(`/api/quotes/${f.quote.id}/line-items/${f.line.id}`).send({ requiresProofApproval: false });
    expect(patch.status).toBe(200);
    expect(patch.body.requiresProofApproval).toBe(true);
    expect((await stored(f.quote.id)).lines.map(line => line.requiresProofApproval)).toEqual([true, true]);
  });

  test("a synthetic foreign customer link cannot supply a mandate at the Quote write boundary", async () => {
    const owner = await fixture({ policy: "manual_requested_only", productDefault: true });
    const foreign = await fixture();
    const customer = await proofCustomer(foreign, true);
    // Bypass the route's existing identity validation only to probe the repository tenant predicate.
    await db.transaction(async (tx) => {
      const repository = new QuotesRepository(tx);
      const created = await repository.createQuote(owner.organization.id, {
        userId: owner.user.id, customerId: customer.id,
        lineItems: [{ productId: owner.product.id, productName: owner.product.name, width: 1, height: 1,
          productType: "wide_roll", displayOrder: 0, pbv2SnapshotJson: {},
          quantity: 1, linePrice: 10, taxAmount: "0", isTaxableSnapshot: true,
          priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "" } }],
      });
      expect(created.lineItems[0].requiresProofApproval).toBe(false);
      const updated = await repository.updateLineItem(created.lineItems[0].id, { requiresProofApproval: true });
      expect(updated.requiresProofApproval).toBe(false);
    });
  });
});

test("Quote email persists the one accepted recipient list and leaves the saved revision unchanged", async () => {
  const f = await fixture();
  const other = await fixture();
  const transport = jest.spyOn(emailService, "sendQuoteEmail").mockResolvedValue("synthetic-gmail-receipt");
  try {
    const before = await stored(f.quote.id);
    const recipients = { to: ["one@example.test", "two@example.test", "three@example.test"], cc: ["copy@example.test"], bcc: ["blind@example.test"] };
    const endpoint = `/api/quotes/${f.quote.id}/email`;
    const payload = { recipients, subject: "Synthetic quote", body: "Review the attached PDF." };
    expect((await request(other.app).post(endpoint).send(payload)).status).toBe(404);
    const key = randomUUID();
    const send = () => request(f.app).post(endpoint).set("Idempotency-Key", key).send(payload);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][4]?.attachments?.[0].content.subarray(0, 4).toString()).toBe("%PDF");
    const after = await stored(f.quote.id);
    expect(after.quote).toEqual(before.quote);
    expect(after.lines).toEqual(before.lines);
    expect(after.audits.map(entry => entry.actionType).sort()).toEqual(["QUOTE_EMAIL_RECIPIENT", "quote_email_sent"]);
    expect(after.audits.find(entry => entry.actionType === "quote_email_sent")).toMatchObject({
      organizationId: f.organization.id, userId: f.user.id,
      newValues: { recipients, quoteRevision: before.quote.revision, providerMessageId: "synthetic-gmail-receipt", pdfAttached: true },
    });
  } finally { transport.mockRestore(); }
});

test("Quote preview, download and email PDF preserve two persisted material selections and their prices", async () => {
  const f = await fixture();
  const foreign = await fixture();
  const transport = jest.spyOn(emailService, "sendQuoteEmail").mockResolvedValue("synthetic-gmail-receipt");
  try {
    await db.update(quotes).set({ quoteNumber: 21121, shippingMethod: "pickup", shippingCents: 0, subtotal: "3900.00", taxableSubtotal: "3900.00",
      taxRate: "0", taxAmount: "0.00", totalPrice: "3900.00" }).where(eq(quotes.id, f.quote.id));
    const line = { quoteId: f.quote.id, productId: f.product.id, productName: "Banner", width: "72", height: "48",
      quantity: 50, isTaxableSnapshot: true, pbv2SnapshotJson: {} };
    const weight = (value: string) => [{ optionId: "banner_weight", optionName: "Banner Weight", value, setupCost: 0, calculatedCost: 0 }];
    await db.update(quoteLineItems).set({ ...line, linePrice: "1500.00", displayOrder: 0, selectedOptions: weight("13oz"),
      priceBreakdown: { basePrice: 1500, optionsPrice: 0, total: 1500, formula: "" } }).where(eq(quoteLineItems.id, f.line.id));
    await db.insert(quoteLineItems).values({ ...line, linePrice: "2400.00", displayOrder: 1, selectedOptions: weight("18oz"),
      priceBreakdown: { basePrice: 2400, optionsPrice: 0, total: 2400, formula: "" } });
    const before = await stored(f.quote.id);
    const path = `/api/quotes/${f.quote.id}`;
    expect((await request(foreign.app).get(path + "/pdf")).status).toBe(404);
    const preview = await request(f.app).get(path + "/pdf");
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("application/pdf");
    expect(preview.headers["content-disposition"]).toBe('inline; filename="Quote-21121.pdf"');
    const download = await request(f.app).get(path + "/pdf?disposition=download");
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toBe('attachment; filename="Quote-21121.pdf"');
    const sent = await request(f.app).post(path + "/email").set("Idempotency-Key", randomUUID())
      .send({ recipientEmail: "fixture@example.test", attachPdf: true });
    expect(sent.status).toBe(200);
    const attachment = transport.mock.calls[0][4]?.attachments?.[0];
    expect(attachment?.filename).toBe("Quote_QT-21121.pdf");
    for (const bytes of [preview.body, download.body, attachment!.content]) {
      const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      try {
        const content = (await (await pdf.getPage(1)).getTextContent()).items.map(item => "str" in item ? item.str : "").join(" ");
        expect(content).toMatch(/\$1,500\.00.*Unit: \$30\.00.*Banner Weight: 13oz.*\$2,400\.00.*Unit: \$48\.00.*Banner Weight: 18oz/);
        expect(content).toMatch(/Subtotal\s+\$3,900\.00\s+Tax\s+\$0\.00\s+Total\s+\$3,900\.00/);
      } finally {
        await pdf.destroy();
      }
    }
    const after = await stored(f.quote.id);
    expect(after.quote).toEqual(before.quote);
    expect(after.lines).toEqual(before.lines);
  } finally {
    transport.mockRestore();
  }
});

test("concurrent explicit Quote contact saves create only one non-primary contact for the address", async () => {
  const f = await fixture();
  const [customer] = await db.insert(customers).values({ organizationId: f.organization.id, companyName: "Synthetic Buyer" }).returning();
  await db.update(quotes).set({ customerId: customer.id }).where(eq(quotes.id, f.quote.id));
  const transport = jest.spyOn(emailService, "sendQuoteEmail").mockResolvedValue("synthetic-gmail-receipt");
  try {
    const send = (address: string) => request(f.app).post(`/api/quotes/${f.quote.id}/email`).set("Idempotency-Key", randomUUID())
      .send({ recipients: { to: [address] }, saveToCustomerContact: true, attachPdf: false });
    const responses = await Promise.all([send("buyer@example.test"), send("BUYER@example.test")]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses.filter(response => response.body.contactSave.success)).toHaveLength(1);
    const { storage } = await import("../storage");
    const contacts = await storage.getCustomerContacts(customer.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].email?.toLowerCase()).toBe("buyer@example.test");
    expect(contacts[0].isPrimary).toBe(false);
  } finally { transport.mockRestore(); }
});

describe("normal Quote editor save on isolated PostgreSQL", () => {
  test("required-option products reject premature draft creation but configured additions persist and reload", async () => {
    const f = await fixture();
    const treeJson = {
      schemaVersion: 2, status: "ACTIVE", rootNodeIds: ["finish"],
      nodes: { finish: { id: "finish", kind: "question", label: "Finish", input: { type: "select", selectionKey: "finish", required: true }, choices: [{ value: "gloss", label: "Gloss" }] } }, edges: [],
      pricingMatrix: { dimensions: ["finish"], rows: [{ when: { finish: "gloss" }, variables: { base_price: 1000 } }] },
      meta: { pricingV2: { base: { perPieceCents: 1000 } } },
    };
    await db.update(pbv2TreeVersions).set({ treeJson }).where(eq(pbv2TreeVersions.productId, f.product.id));
    const before = await stored(f.quote.id);
    const premature = await request(f.app).post(`/api/quotes/${f.quote.id}/line-items`).set("Idempotency-Key", `${Date.now()}:${randomUUID()}`).send(lineData(f.product.id, { status: "draft" }));
    // The legacy line-create route surfaces this pricing rejection as 500;
    // staging an unconfigured row must never call it in the first place.
    expect(premature.status).toBe(500);
    expect(JSON.stringify(premature.body)).toContain("Select required options before pricing");
    expect(await stored(f.quote.id)).toEqual(before);
    const options = { schemaVersion: 2, selected: { finish: { value: "gloss" } } };
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: {}, lines: { update: [], delete: [], create: [
        { clientKey: "first", data: lineData(f.product.id, { quantity: 3, optionSelectionsJson: options, displayOrder: 1 }) },
        { clientKey: "second", data: lineData(f.product.id, { quantity: 2, optionSelectionsJson: options, displayOrder: 2,
          priceOverride: { mode: "override_total_after_margin", valueCents: 4000 }, priceOverrideMode: "override_total_after_margin", priceOverrideValueCents: 4000, overridePriceCents: 4000 }) },
      ] },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.lines).toHaveLength(3);
    expect(after.lines.find(line => line.id === f.line.id)).toEqual(before.lines[0]);
    for (const createdLine of saved.body.created) {
      const line = after.lines.find(row => row.id === createdLine.id)!;
      expect(line.optionSelectionsJson).toEqual(options);
      expect(line.pbv2SnapshotJson).toBeTruthy();
      expect(line.pbv2TreeVersionId).toBeTruthy();
    }
    const overridden = after.lines.find(row => row.id === saved.body.created.find((row: { clientKey: string }) => row.clientKey === "second").id)!;
    expect(Number(overridden.linePrice)).toBe(40);
    expect(overridden.overridePriceCents).toBe(4000);
    const reopened = await request(f.app).get(`/api/quotes/${f.quote.id}`);
    expect(reopened.status).toBe(200);
    expect(reopened.body.lineItems.map((row: { id: string }) => row.id).sort()).toEqual(after.lines.map(row => row.id).sort());
    expect(reopened.body.lineItems.find((row: { id: string }) => row.id === overridden.id).optionSelectionsJson).toEqual(options);
  });

  test("mixed additions, edits and removals persist atomically and cross-tenant saves are denied", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const [removed] = await db.insert(quoteLineItems).values({ quoteId: f.quote.id, productId: f.product.id, productName: "Remove me", width: "1", height: "1", quantity: 1, pbv2SnapshotJson: {}, linePrice: "10", priceBreakdown: { basePrice: 10, optionsPrice: 0, total: 10, formula: "" } }).returning();
    const before = await stored(f.quote.id);
    const denied = await request(foreign.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: {}, lines: { create: [{ clientKey: "foreign", data: lineData(f.product.id) }], update: [], delete: [] } });
    expect(denied.status).toBe(404);
    expect(await stored(f.quote.id)).toEqual(before);
    const save = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: {}, lines: {
      create: [{ clientKey: "added", data: lineData(f.product.id, { quantity: 4, description: "New line" }) }],
      update: [{ id: f.line.id, data: lineData(f.product.id, { quantity: 2, description: "Existing edit" }) }], delete: [removed.id],
    } });
    expect(save.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.lines).toHaveLength(2);
    expect(after.lines.find(row => row.id === removed.id)).toBeUndefined();
    expect(after.lines.find(row => row.id === f.line.id)).toMatchObject({ quantity: 2, description: "Existing edit" });
    expect(after.lines.find(row => row.id === save.body.created[0].id)).toMatchObject({ quantity: 4, description: "New line" });
    expect(after.audits).toHaveLength(1);
  });

  test("header and existing-line changes commit together; a no-op leaves revision and audit alone", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision,
      header: { customerNotes: "Saved with line", shipToAddress1: "99 Custom Lane" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(f.product.id, { description: "Updated line", productionNotes: "Internal production note" }) }], delete: [] },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.quote.customerNotes).toBe("Saved with line");
    expect(after.quote.shipToAddress1).toBe("99 Custom Lane");
    expect(after.lines[0].description).toBe("Updated line");
    expect(after.lines[0].productionNotes).toBe("Internal production note");
    expect(after.quote.revision).toBeGreaterThan(before.quote.revision);
    expect(after.audits).toHaveLength(1);
    expect(saved.body.quote.revision).toBe(after.quote.revision);
    const noop = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: after.quote.revision, header: { customerNotes: "Saved with line" }, lines: { create: [], update: [], delete: [] } });
    expect(noop.status).toBe(200);
    expect(noop.body.changed).toBe(false);
    const afterNoop = await stored(f.quote.id);
    expect(afterNoop.quote.revision).toBe(after.quote.revision);
    expect(afterNoop.audits).toHaveLength(1);
  });

  test("a failed later line validation rolls back header, lines, revision, and audit", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const failed = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { customerNotes: "Must roll back" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(randomUUID(), { description: "Invalid product" }) }], delete: [] },
    });
    expect(failed.status).toBe(404);
    const after = await stored(f.quote.id);
    expect(after.quote.customerNotes).toBe(before.quote.customerNotes);
    expect(after.quote.revision).toBe(before.quote.revision);
    expect(after.lines).toEqual(before.lines);
    expect(after.audits).toEqual(before.audits);
  });

  test("add and remove with a header edit use canonical totals and one transaction", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { label: "Replacement line" },
      lines: { create: [{ clientKey: "local-new-line", data: lineData(f.product.id) }], update: [], delete: [f.line.id] },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.quote.label).toBe("Replacement line");
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0].id).not.toBe(f.line.id);
    expect(saved.body.created).toEqual([{ clientKey: "local-new-line", id: after.lines[0].id }]);
    expect(Number(after.quote.subtotal)).toBe(Number(after.lines[0].linePrice));
    expect(Number(after.quote.totalPrice)).toBe(Number(after.quote.subtotal) + 5);
    expect(after.audits).toHaveLength(1);
    const retry = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { label: "Replacement line" },
      lines: { create: [{ clientKey: "local-new-line", data: lineData(f.product.id) }], update: [], delete: [f.line.id] },
    });
    expect(retry.status).toBe(409);
    expect((await stored(f.quote.id)).lines).toHaveLength(1);
  });

  test("a header-only save does not rewrite an unchanged line", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { label: "Header only" },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    expect((await stored(f.quote.id)).lines).toEqual(before.lines);
  });

  test("concurrent saves using one reviewed revision accept at most one change", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const save = (customerNotes: string) => request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: revision, header: { customerNotes }, lines: { create: [], update: [], delete: [] } });
    const responses = await Promise.all([save("First"), save("Second")]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await stored(f.quote.id)).audits).toHaveLength(1);
  });

  test("missing or foreign line references reject without a partial header write", async () => {
    const f = await fixture();
    const other = await fixture();
    const before = await stored(f.quote.id);
    const failed = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: { label: "Should not save" }, lines: { create: [], update: [], delete: [randomUUID()] } });
    expect(failed.status).toBe(409);
    const foreign = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: before.quote.revision, header: { label: "Should not save" }, lines: { create: [], update: [], delete: [other.line.id] } });
    expect(foreign.status).toBe(409);
    expect((await stored(f.quote.id)).quote).toEqual(before.quote);
    expect((await stored(other.quote.id)).lines).toHaveLength(1);
  });

  test("a full editor header payload with unchanged values is a true no-op", async () => {
    const f = await fixture();
    const before = await stored(f.quote.id);
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision,
      header: {
        customerId: null, contactId: null, customerName: "Fixture", label: null,
        requestedDueDate: null, shippingMethod: "ship", shippingCents: 500,
        shippingInstructions: null, customerNotes: null, discountAmount: Number(before.quote.discountAmount ?? 0),
        tags: [],
        subtotal: 999999, totalPrice: 999999, source: "internal",
      },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toBe(false);
    const after = await stored(f.quote.id);
    expect(after.quote.revision).toBe(before.quote.revision);
    expect(after.audits).toEqual(before.audits);
    expect(after.lines).toEqual(before.lines);
  });

  test("explicit address clears and due date survive readback", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({ expectedRevision: revision, header: { shipToAddress1: "", shipToState: null, requestedDueDate: "2026-11-15T00:00:00.000Z" }, lines: { create: [], update: [], delete: [] } });
    expect(saved.status).toBe(200);
    const persisted = (await stored(f.quote.id)).quote;
    expect(persisted.shipToAddress1).toBe("");
    expect(persisted.shipToState).toBeNull();
    expect(new Date(String(persisted.requestedDueDate)).toISOString().slice(0, 10)).toBe("2026-11-15");
  });

  test("changing the customer preserves the entire saved custom destination snapshot", async () => {
    const f = await fixture();
    const [customer] = await db.insert(customers).values({
      organizationId: f.organization.id, companyName: "Synthetic new customer",
      shippingStreet1: "Customer default street", shippingCity: "Default City", shippingState: "CA",
    }).returning();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: { customerId: customer.id },
      lines: { create: [], update: [], delete: [] },
    });
    expect(saved.status).toBe(200);
    const persisted = (await stored(f.quote.id)).quote;
    expect(persisted.customerId).toBe(customer.id);
    expect(persisted.billToCompany).toBe("Synthetic new customer");
    expect(persisted.shipToAddress1).toBe("99 Custom Lane");
    expect(persisted.shipToState).toBe("IN");
    expect(persisted.shipToCity).toBeNull();
  });

  test("a locked Quote rejects normal editor saves without changing its lines or audit", async () => {
    const f = await fixture();
    await db.update(quotes).set({ status: "active" }).where(eq(quotes.id, f.quote.id));
    const before = await stored(f.quote.id);
    const response = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: before.quote.revision, header: { label: "Must remain unchanged" },
      lines: { create: [], update: [{ id: f.line.id, data: lineData(f.product.id, { description: "Must remain unchanged" }) }], delete: [] },
    });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("QUOTE_NOT_EDITABLE");
    expect(await stored(f.quote.id)).toEqual(before);
  });

  test("normal save preserves a canonical total price override and recalculates Quote totals", async () => {
    const f = await fixture();
    const revision = (await stored(f.quote.id)).quote.revision;
    const saved = await request(f.app).patch(`/api/quotes/${f.quote.id}/editor-save`).send({
      expectedRevision: revision, header: {}, lines: {
        create: [], delete: [], update: [{ id: f.line.id, data: lineData(f.product.id, {
          priceOverrideMode: "override_total_after_margin", priceOverrideValueCents: 4000,
          overridePriceCents: 4000, priceOverride: { mode: "override_total_after_margin", valueCents: 4000 },
        }) }],
      },
    });
    expect(saved.status).toBe(200);
    const after = await stored(f.quote.id);
    expect(after.lines[0].overridePriceCents).toBe(4000);
    expect(Number(after.lines[0].linePrice)).toBe(40);
    expect((after.lines[0].specsJson as { priceOverride?: { mode?: string } })?.priceOverride?.mode).toBe("override_total_after_margin");
    expect(Number(after.quote.subtotal)).toBe(40);
    expect(Number(after.quote.totalPrice)).toBe(45);
  });
});
