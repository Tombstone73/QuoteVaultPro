import { describe, expect, jest, test } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { capabilityIds } from "../../src/authorization/capabilities";
import { V2ApplicationError } from "../../src/errors/applicationError";
import { QuoteConversionApplicationService, createQuoteConversionTrace } from "../../src/modules/sales/quoteConversionApplication";
import { QuoteApplicationService } from "../../src/modules/sales/quoteApplication";
import { OrderApplicationService } from "../../src/modules/sales/orderApplication";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter";
import { composeSalesTax } from "../../src/modules/sales/taxComposition";
import { PostgresCustomerDocumentService } from "../../infrastructure/sales/postgresCustomerDocuments";
import { canRetryPreparedQuoteDeliveryAttempt, loadPreparedQuoteDeliveryEvidenceFromAttempt, persistPreparedQuoteDeliveryAttempt, PostgresQuoteDeliveryService } from "../../infrastructure/sales/postgresQuoteDelivery";
import { serializePreparedQuoteDeliveryEvidence } from "../../infrastructure/sales/preparedQuoteDeliveryEvidence";
import { quoteCommercialSnapshot } from "../../src/modules/sales/contracts";
import { PostgresQuoteTransaction } from "../../infrastructure/sales/postgresQuoteTransaction";
import { publishedQuoteCheckpointSql } from "../../infrastructure/sales/postgresQuotePublication";

const conversionFixture = async (failAt?: string) => {
  const organizationId = "contract-org";
  const customerContact = { organizationId, customerId: "customer-a", contactId: "contact-a" };
  const context: any = { organizationId, operationId: "operation-a", businessRequest: { id: "business-request-a", payloadFingerprint: "request-fingerprint" }, principal: { kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "member-a", capabilities: ["quote.edit", "quote.convert"] } } };
  const resolvedConfiguration: any = { schemaVersion: 1, organizationId, productId: "product-a", pricingConfigurationId: "version-a", pricingConfigurationVersion: "1", pricingConfigurationContentHash: "sha256:version-a", quantity: 2, selections: {}, derivedFacts: {}, productFacts: { measurementMode: "quantity_only" } };
  const pricingResult = await new V2PricingParityAdapter().calculate({ organizationId, resolvedConfiguration, sellableProduct: { organizationId, productId: "product-a", displayName: "Product", lifecycle: "active", requiresDimensions: false, pricingCurrency: "USD", pricingConfiguration: { id: "version-a", version: "1", contentHash: "sha256:version-a" } }, pricingContext: { channel: "staff", effectiveAt: "2026-09-01T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } } as any);
  const line: any = { lineId: "quote-line-a", productId: "product-a", description: "Product", quantity: 2, resolvedConfiguration, pricingResult, sellingPriceDecision: { kind: "calculated", pricingResultId: pricingResult.id, calculatedUnitAmount: pricingResult.calculatedUnitAmount, calculatedLineAmount: pricingResult.calculatedLineAmount, resultingUnitAmount: pricingResult.calculatedUnitAmount, resultingLineAmount: pricingResult.calculatedLineAmount, decidedAt: "2026-09-01T00:00:00.000Z" }, calculatedLineAmount: pricingResult.calculatedLineAmount, sellingLineAmount: pricingResult.calculatedLineAmount, taxability: { taxable: true, source: "product" } };
  const taxComposition = composeSalesTax({ lines: [{ lineId: line.lineId, amountCents: line.sellingLineAmount.cents, taxable: true }], exemption: { exempt: false }, resolution: { status: "resolved", receiptLocation: { country: "US", region: "OR" }, jurisdiction: { jurisdictionId: "jurisdiction-a", name: "Zero rate", receiptLocation: { country: "US", region: "OR" }, rateBasisPoints: 0, active: true, homeBusiness: true } } });
  const sentCheckpoint: any = { schemaVersion: 1, checkpointId: "sent-checkpoint-a", evidenceFingerprint: "sent-fingerprint", organizationId, occurredAt: "2026-09-01T00:00:00.000Z", principal: { principalKind: "staff", subjectId: "staff-a" }, customerPresentation: { customerDisplayName: "Customer", contactDisplayName: "Contact", email: "alex@example.test" }, commercial: { currency: "USD", terms: {}, lines: [line], taxComposition }, sentEvidence: { customerContact, deliveryAttemptId: "delivery-a", recipientEmail: "alex@example.test", documentSha256: `sha256:${"a".repeat(64)}`, documentNumber: "QT-101", documentDate: "2026-09-01", providerMessageId: "provider-a" }, kind: "quote_sent", sourceDocument: { quoteId: "quote-a" } };
  const initial = { quote: { quoteId: "quote-a", organizationId, customerContact, currency: "USD", terms: {}, lines: [line], taxComposition, deliveryState: "sent", acceptanceState: "not_accepted", lifecycleState: "open" }, revision: "1", publishedCheckpointId: sentCheckpoint.checkpointId, publishedEvidenceStatus: "modern", checkpoints: [{ checkpointId: sentCheckpoint.checkpointId, kind: sentCheckpoint.kind, occurredAt: sentCheckpoint.occurredAt }] };
  let state: any = { quoteRead: initial, checkpoints: [sentCheckpoint], orderRead: null, invoice: null, lineage: null, artwork: [] };
  const calls: string[] = [], messages: string[] = [];
  const requests = new Map<string, any>();
  const requestsById = new Map<string, any>();
  const step = (name: string) => { calls.push(name); if (name === failAt) throw Object.assign(new Error("secret customer email token SQL must not be logged"), { code: "23505", constraint: "contract_constraint" }); };
  const customers = { validateContactReference: async () => true, getPresentationIdentity: async () => ({ customerDisplayName: "Customer", contactDisplayName: "Contact" }) };
  const forbidden = async () => { throw new Error("Frozen conversion must not reprice or resolve mutable configuration"); };
  const orderTx: any = {
    customers, pricing: { calculate: forbidden }, products: { resolveActivePricingInput: forbidden, resolveOrderRoutability: async () => { step("routing_resolution"); return { kind: "routable", productName: "Product", routing: { kind: "no_route" } }; } },
    allocateNumber: async () => ({ kind: "order", core: 1000n, display: "ORD-1000" }),
    create: async (input: any) => { step("order_persistence"); state.orderRead = { order: { ...input, commercialState: "open" }, number: input.number, revision: "1" }; },
    materialRequirements: { freeze: async () => { step("material_freeze"); } },
    billing: { createDraftInvoice: async (input: any) => { step("draft_invoice"); state.invoice = input; return { status: "created", invoiceId: "invoice-a" }; } },
    read: async () => state.orderRead, audit: async () => undefined, attribute: async () => undefined,
  };
  const quoteTx: any = {
    customers,
    reserve: async (input: any) => {
      const key = `${input.operation}:${input.businessRequestId}`;
      const previous = requests.get(key);
      if (previous) {
        if (previous.payloadFingerprint !== input.payloadFingerprint) throw Object.assign(new Error("idempotency conflict"), { code: "IDEMPOTENCY_CONFLICT" });
        return { kind: "replay", request: { ...previous, resultJson: structuredClone(previous.resultJson) } };
      }
      const request = { id: `request-${requests.size + 1}`, operation: input.operation, businessRequestId: input.businessRequestId, payloadFingerprint: input.payloadFingerprint, status: "in_progress", resultJson: null };
      requests.set(key, request); requestsById.set(request.id, request);
      return { kind: "new", request };
    }, read: async () => state.quoteRead,
    transition: async (input: any) => { step("acceptance_checkpoint"); state.checkpoints.push(input.checkpoint); state.quoteRead = { ...state.quoteRead, quote: { ...state.quoteRead.quote, acceptanceState: "accepted" }, revision: "2", checkpoints: [...state.quoteRead.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] }; return true; },
    readCheckpoint: async (_org: string, _quote: string, id: string) => state.checkpoints.find((item: any) => item.checkpointId === id),
    appendConvertedCheckpoint: async (input: any) => { step("conversion_link"); state.checkpoints.push(input.checkpoint); state.quoteRead = { ...state.quoteRead, checkpoints: [...state.quoteRead.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] }; },
    createConversionLineage: async (input: any) => { state.lineage = input; state.quoteRead = { ...state.quoteRead, quote: { ...state.quoteRead.quote, convertedOrderId: input.orderId } }; },
    succeedConversion: async (_organizationId: string, requestId: string, _quoteId: string, result: unknown) => { step("durable_request_completed"); const request = requestsById.get(requestId); if (request) { request.status = "succeeded"; request.resultJson = structuredClone(result); } }, audit: async () => undefined, attribute: async () => undefined,
  };
  const artwork: any = { snapshotAccepted: async (...args: unknown[]) => { step("accepted_artwork_snapshot"); state.artwork.push(args); }, carryAcceptedToOrder: async (input: unknown) => { step("artwork_lineage"); state.artwork.push(input); } };
  let transactions = 0;
  const runner: any = { transaction: async (action: any) => {
    transactions++; calls.push("begin"); const before = structuredClone(state);
    try { const result = await action({ quote: quoteTx, order: orderTx, artwork }); calls.push("commit"); return result; }
    catch (error) {
      state = before;
      // Model PostgreSQL JSON decoding in this Jest realm after rollback.
      // Host structuredClone objects are not local plain commercial JSON.
      state.quoteRead = JSON.parse(JSON.stringify(before.quoteRead));
      state.checkpoints = JSON.parse(JSON.stringify(before.checkpoints));
      calls.push("rollback"); throw error;
    }
  } };
  const orders = new OrderApplicationService({ transaction: async () => { throw new Error("Order core must reuse the conversion transaction"); } });
  const service = new QuoteConversionApplicationService(runner, orders);
  const contextFor = (userId: string, capabilities: readonly string[]) => ({ ...context, principal: { ...context.principal, userId, authority: { ...context.principal.authority, membershipId: userId === "staff-a" ? "member-a" : "member-b", capabilities } } });
  return { accept: (expectedRevision = "1", operationContext = context) => service.accept(operationContext, { quoteId: "quote-a", expectedRevision, businessRequestId: "business-request-a" } as any, createQuoteConversionTrace({ requestId: "trace-a", sink: message => messages.push(message) })),
    convert: (sourceCheckpointId: string, operationContext = context) => service.convert(operationContext, { organizationId, quoteId: "quote-a", sourceCheckpointId, expectedStateToken: "2", businessRequestId: "business-request-a" } as any),
    contextFor,
    markAcceptedWithSentSnapshot: () => {
      const accepted = { ...sentCheckpoint, checkpointId: "accepted-checkpoint-a", evidenceFingerprint: "accepted-fingerprint", occurredAt: "2026-09-01T00:00:01.000Z", sourceCheckpointId: sentCheckpoint.checkpointId, kind: "quote_accepted" };
      state.quoteRead = { ...initial, quote: { ...initial.quote, acceptanceState: "accepted" }, revision: "2", checkpoints: [...initial.checkpoints, { checkpointId: accepted.checkpointId, kind: accepted.kind, occurredAt: accepted.occurredAt }] };
      state.checkpoints.push(accepted);
    },
    corruptAcceptedCheckpoint: (kind?: "quote_sent") => {
      const invalidAccepted = { ...sentCheckpoint, checkpointId: "missing-or-invalid", kind: kind ?? "quote_accepted" };
      state.quoteRead = { ...initial, quote: { ...initial.quote, acceptanceState: "accepted" }, revision: "2", checkpoints: [...initial.checkpoints, { kind: "quote_accepted", checkpointId: "missing-or-invalid", occurredAt: "2026-09-01T00:00:01.000Z" }] };
      state.checkpoints = [sentCheckpoint, invalidAccepted];
    },
    changeCurrentQuote: (change: (quote: any) => any) => { state.quoteRead = { ...state.quoteRead, quote: change(state.quoteRead.quote) }; },
    setPublication: (checkpointId: string | null, evidenceStatus: "modern" | "historical" | null = "modern") => { state.quoteRead = { ...state.quoteRead, publishedCheckpointId: checkpointId, publishedEvidenceStatus: evidenceStatus }; },
    clearPublication: () => { delete state.quoteRead.publishedCheckpointId; delete state.quoteRead.publishedEvidenceStatus; },
    corruptReceipt: (change: (receipt: any) => any) => { for (const request of requests.values()) if (request.status === "succeeded") request.resultJson = change(structuredClone(request.resultJson)); },
    appendSent: (checkpoint: any) => { state.checkpoints.push(checkpoint); state.quoteRead = { ...state.quoteRead, checkpoints: [...state.quoteRead.checkpoints, { checkpointId: checkpoint.checkpointId, kind: "quote_sent", occurredAt: checkpoint.occurredAt }] }; },
    removeSentEvidence: () => { state.checkpoints = state.checkpoints.map((checkpoint: any) => { const { sentEvidence: _sentEvidence, ...historical } = checkpoint; return historical; }); },
    state: () => state, transactions: () => transactions, initial, line, sentCheckpoint, calls, messages };
};

const deliveryFixture = () => {
  const organizationId = "contract-org";
  const customerContact = { organizationId, customerId: "customer-a", contactId: "contact-a" };
  const taxComposition: any = { status: "resolved", taxableLineCents: 0, taxCents: 0, finalTotalCents: 0 };
  const quote: any = { quoteId: "quote-send-a", organizationId, customerContact, currency: "USD", terms: {}, lines: [], taxComposition, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" };
  const preparedSnapshot: any = { schemaVersion: 1, organizationId, quoteId: quote.quoteId, expectedRevision: "1", customerContact, commercial: quoteCommercialSnapshot(quote), customerPresentation: { customerDisplayName: "Prepared Customer", contactDisplayName: "Prepared Contact", email: "prepared@example.test" }, recipientEmail: "prepared@example.test", documentSha256: `sha256:${"b".repeat(64)}`, documentNumber: "QT-PREPARED", documentDate: "2026-10-02", organizationPresentation: { name: "Prepared Organization" } };
  const context: any = { organizationId, operationId: "send-operation", businessRequest: { id: "send-request", payloadFingerprint: "send-fingerprint" }, principal: { kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "member-a", capabilities: ["quote.send"] } } };
  let current: any = { quote, number: { core: 101n, display: "QT-PREPARED" }, revision: "1", checkpoints: [] };
  let sentCheckpoint: any;
  const tx: any = {
    customers: { getPresentationIdentity: async () => { throw new Error("Send must not reread mutable CRM presentation after preparation"); } },
    reserve: async () => ({ kind: "new", request: { id: "send-request" } }),
    read: async () => current,
    transition: async (input: any) => { sentCheckpoint = input.checkpoint; current = { ...current, quote: { ...current.quote, deliveryState: "sent" }, revision: "2", checkpoints: [{ checkpointId: sentCheckpoint.checkpointId, kind: sentCheckpoint.kind, occurredAt: sentCheckpoint.occurredAt }] }; return true; },
    audit: async () => undefined, attribute: async () => undefined, succeed: async () => undefined,
  };
  const service = new QuoteApplicationService({ transaction: async (action: any) => action(tx) } as any);
  const input = { businessRequestId: "send-request", quoteId: quote.quoteId, expectedRevision: "1", deliveryAttemptId: "delivery-a", providerMessageId: "provider-a", preparedSnapshot, frozenTaxComposition: taxComposition };
  return {
    send: () => service.recordDelivered(context, input as any),
    context,
    current: () => current,
    sentCheckpoint: () => sentCheckpoint,
    input,
    changeAfterPrepare: (revision = "2") => { current = { ...current, quote: { ...current.quote, customerContact: { ...customerContact, contactId: "contact-b" } }, revision }; },
  };
};

describe("sent Quote preparation evidence", () => {
  test("records the exact prepared Contact, recipient, PDF hash, document number, and date without rereading CRM", async () => {
    const fixture = deliveryFixture();
    const result = await fixture.send();
    expect(result).toMatchObject({ ok: true });
    const checkpoint = fixture.sentCheckpoint();
    expect(checkpoint.sentEvidence).toMatchObject({
      customerContact: fixture.input.preparedSnapshot.customerContact,
      deliveryAttemptId: "delivery-a",
      recipientEmail: "prepared@example.test",
      documentSha256: `sha256:${"b".repeat(64)}`,
      documentNumber: "QT-PREPARED",
      documentDate: "2026-10-02",
      providerMessageId: "provider-a",
    });
    expect(checkpoint.customerPresentation).toEqual(fixture.input.preparedSnapshot.customerPresentation);
  });

  test("rejects a prepare-to-delivery Quote mutation before recording a sent checkpoint", async () => {
    for (const revision of ["1", "2"]) {
      const fixture = deliveryFixture();
      fixture.changeAfterPrepare(revision);
      const result = await fixture.send();
      expect(result).toMatchObject({ ok: false, error: { code: "STALE_STATE" } });
      expect(fixture.sentCheckpoint()).toBeUndefined();
      expect(fixture.current().quote.customerContact.contactId).toBe("contact-b");
    }
  });

  test("provider success followed by a stale Sales append stays uncertain and preserves provider identity", async () => {
    const fixture = deliveryFixture();
    const currentQuote = fixture.current().quote;
    const transitioned: any = { ok: false, error: { code: "STALE_STATE", message: "Quote changed after preparation." } };
    const quoteService: any = {
      read: async () => ({ ok: true, value: { quote: currentQuote, revision: "1", number: { core: 101n, display: "QT-PREPARED" }, checkpoints: [] } }),
      recordDelivered: async (_context: unknown, input: any) => { quoteService.committed = input; return transitioned; },
    };
    const integration = { requireReady: async () => ({}) };
    const service: any = new PostgresQuoteDeliveryService({} as any, quoteService, integration as any);
    const sendCalls: string[] = [];
    const delivery = {
      requestId: "send-request", attemptId: "delivery-a", recipient: "prepared@example.test",
      document: { kind: "quote", number: "QT-PREPARED", issuedAt: "2026-10-02", organization: { name: "Prepared Organization" } },
      pdf: new Uint8Array([1]), preparedEvidence: fixture.input.preparedSnapshot,
      frozenTaxComposition: fixture.input.frozenTaxComposition,
      integration: {},
    };
    let uncertainArgs: unknown[] | undefined;
    let succeeded = false;
    service.documents.quoteRecipient = async () => { sendCalls.push("recipient"); return "prepared@example.test"; };
    service.requireRoutability = async () => { sendCalls.push("routability"); };
    service.prepare = async () => { sendCalls.push("prepare"); return delivery; };
    service.deliver = async () => { sendCalls.push("provider-stub"); return "provider-message-a"; };
    service.uncertain = async (...args: unknown[]) => { uncertainArgs = args; };
    service.succeeded = async () => { succeeded = true; };

    const result = await service.send(fixture.context, { businessRequestId: "send-request", quoteId: currentQuote.quoteId, expectedRevision: "1" });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT", message: "The provider accepted delivery; Quote state needs reconciliation." } });
    expect(sendCalls).toEqual(["prepare", "provider-stub"]);
    expect(quoteService.committed.preparedSnapshot).toEqual(fixture.input.preparedSnapshot);
    expect(uncertainArgs?.slice(0, 3)).toEqual(["contract-org", "send-request", "delivery-a"]);
    expect(uncertainArgs?.[4]).toBe("provider-message-a");
    expect(succeeded).toBe(false);
  });

  test("ambiguous provider response persists intent, becomes uncertain, and never auto-retries", async () => {
    const fixture = deliveryFixture();
    const currentQuote = fixture.current().quote;
    const quoteService: any = {
      read: async () => ({ ok: true, value: { quote: currentQuote, revision: "1", number: { core: 101n, display: "QT-PREPARED" }, checkpoints: [] } }),
      recordDelivered: async () => { throw new Error("Unknown provider outcome must not append a sent checkpoint"); },
    };
    const service: any = new PostgresQuoteDeliveryService({} as any, quoteService, { requireReady: async () => ({}) } as any);
    const delivery = { requestId: "send-request", attemptId: "delivery-a", recipient: "prepared@example.test", document: { kind: "quote", number: "QT-PREPARED", issuedAt: "2026-10-02", organization: { name: "Prepared Organization" } }, pdf: new Uint8Array([1]), preparedEvidence: fixture.input.preparedSnapshot, frozenTaxComposition: fixture.input.frozenTaxComposition, integration: {} };
    let prepareCalls = 0;
    let providerCalls = 0;
    let uncertainArgs: unknown[] | undefined;
    service.documents.quoteRecipient = async () => "prepared@example.test";
    service.requireRoutability = async () => undefined;
    service.prepare = async () => { prepareCalls++; if (prepareCalls > 1) throw new V2ApplicationError("CONFLICT", "persisted uncertain attempt"); return delivery; };
    service.deliver = async () => { providerCalls++; throw new Error("connection reset after request bytes were sent"); };
    service.uncertain = async (...args: unknown[]) => { uncertainArgs = args; };

    const first = await service.send(fixture.context, { businessRequestId: "send-request", quoteId: currentQuote.quoteId, expectedRevision: "1" });
    expect(first).toMatchObject({ ok: false, error: { code: "CONFLICT", message: "Quote delivery outcome is unknown. The Quote was not marked sent; reconcile delivery before trying again." } });
    expect(uncertainArgs?.slice(0, 3)).toEqual(["contract-org", "send-request", "delivery-a"]);
    expect(uncertainArgs).toHaveLength(4);
    const retry = await service.send(fixture.context, { businessRequestId: "send-request", quoteId: currentQuote.quoteId, expectedRevision: "1" });
    expect(retry).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(providerCalls).toBe(1);
    expect(prepareCalls).toBe(2);
  });

  test("prepared attempt evidence is written to and loaded from the durable JSON column", async () => {
    const fixture = deliveryFixture();
    const evidence = fixture.input.preparedSnapshot;
    let persisted: any;
    const client: any = { query: async (sql: string, parameters: unknown[]) => {
      expect(sql).toContain("prepared_evidence_json");
      expect(sql).toContain("$6::jsonb");
      persisted = { id: "delivery-a", organization_id: evidence.organizationId, quote_document_id: evidence.quoteId, operation_request_id: "send-request", recipient_email: evidence.recipientEmail, document_sha256: evidence.documentSha256, prepared_evidence_json: JSON.parse(parameters[5] as string), delivery_state: "pending" };
      return { rows: [persisted] };
    } };
    const row = await persistPreparedQuoteDeliveryAttempt(client, { organizationId: evidence.organizationId, quoteId: evidence.quoteId, requestId: "send-request", recipientEmail: evidence.recipientEmail, preparedEvidence: evidence, principalKind: "staff", principalSubject: "staff-a" });
    expect(loadPreparedQuoteDeliveryEvidenceFromAttempt(row)).toEqual(evidence);
    expect(canRetryPreparedQuoteDeliveryAttempt({ ...row, delivery_state: "failed" }, evidence)).toBe(true);
    expect(canRetryPreparedQuoteDeliveryAttempt({ ...row, delivery_state: "failed", prepared_evidence_json: null }, evidence)).toBe(false);
    expect(canRetryPreparedQuoteDeliveryAttempt({ ...row, delivery_state: "failed" }, { ...evidence, documentNumber: "QT-CHANGED" })).toBe(false);
    expect(loadPreparedQuoteDeliveryEvidenceFromAttempt({ ...row, document_sha256: `sha256:${"d".repeat(64)}` })).toBeNull();
  });
  test.each([408, 500, 503])("provider %s stays uncertain instead of authorizing a duplicate send", async status => {
    const fixture = deliveryFixture();
    const quoteService: any = { read: async () => ({ ok: true, value: fixture.current() }), recordDelivered: async () => { throw new Error("No checkpoint for unknown provider outcome"); } };
    const service: any = new PostgresQuoteDeliveryService({} as any, quoteService, {} as any);
    let sends = 0, unresolved = false;
    service.prepare = async () => {
      if (unresolved) throw new V2ApplicationError("CONFLICT", "A prior delivery is unresolved.");
      return { requestId: "send-request", attemptId: "delivery-a", recipient: "prepared@example.test", document: {}, pdf: new Uint8Array(), preparedEvidence: fixture.input.preparedSnapshot, frozenTaxComposition: fixture.input.frozenTaxComposition, integration: {} };
    };
    service.deliver = async () => { sends++; throw { response: { status } }; };
    service.uncertain = async () => { unresolved = true; };
    service.failed = async () => { throw new Error("An uncertain provider result must not become retryable rejection"); };
    const input = { businessRequestId: "send-request", quoteId: "quote-send-a", expectedRevision: "1" };
    await expect(service.send(fixture.context, input)).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    await expect(service.send(fixture.context, input)).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(sends).toBe(1);
  });

  test("delivery success requires the exact pending attempt, recipient, PDF hash, Quote, and request link", async () => {
    const fixture = deliveryFixture();
    await fixture.send();
    const committedCheckpoint = { ...fixture.sentCheckpoint(), checkpointId: "checkpoint-a" };
    let updateRowCount = 0;
    const statements: Array<{ sql: string; parameters?: unknown[] }> = [];
    const client: any = {
      query: async (sql: string, parameters?: unknown[]) => {
        statements.push({ sql, parameters });
        if (sql.startsWith("SELECT d.id FROM v2_sales_documents")) return { rowCount: 1, rows: [{ id: "quote-send-a" }] };
        if (sql.startsWith("SELECT id,checkpoint_kind,occurred_at,payload")) return { rowCount: 1, rows: [{ payload: committedCheckpoint }] };
        return { rowCount: sql.startsWith("UPDATE v2_sales_quote_delivery_attempts") ? updateRowCount : 1, rows: [] };
      },
      release: () => undefined,
    };
    const requests = { recordAttribution: async () => undefined, succeed: async () => undefined };
    const service: any = new PostgresQuoteDeliveryService({ connect: async () => client } as any, {} as any, {} as any);
    service.requests = requests;
    const hash = fixture.input.preparedSnapshot.documentSha256;
    const preparedEvidenceJson = serializePreparedQuoteDeliveryEvidence(fixture.input.preparedSnapshot);
    const arguments_ = [fixture.context, "send-request", "delivery-a", "quote-send-a", "checkpoint-a", "provider-a", "prepared@example.test", hash, preparedEvidenceJson, { quote: fixture.current() }];

    await expect(service.succeeded(...arguments_)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(statements[1]?.sql).toContain("FOR UPDATE OF d,q");
    const attemptUpdate = statements.find(statement => statement.sql.startsWith("UPDATE v2_sales_quote_delivery_attempts"));
    expect(attemptUpdate?.sql).toContain("quote_document_id=$3 AND operation_request_id=$4 AND delivery_state='pending' AND recipient_email=$7 AND document_sha256=$8 AND prepared_evidence_json=$9::jsonb");
    expect(attemptUpdate?.parameters).toEqual(["contract-org", "delivery-a", "quote-send-a", "send-request", "checkpoint-a", "provider-a", "prepared@example.test", hash, preparedEvidenceJson]);

    statements.length = 0;
    updateRowCount = 1;
    await service.succeeded(...arguments_);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
  });

  test("pre-send and historical document projections use one prepared recipient and frozen PDF identity", async () => {
    const fixture = deliveryFixture();
    const sent = await fixture.send();
    expect(sent.ok).toBe(true);
    const header = {
      id: "quote-send-a", display_number: "QT-LIVE", currency: "USD", purchase_order_number: null,
      requested_due_date: null, commercial_notes: null, customer_name: "Live Customer", customer_email: "live@example.test",
      contact_id: "contact-b", contact_exists: "contact-b", contact_name: "Live Contact", contact_email: "live@example.test",
      requested_fulfillment_method: null, selling_adjustment_cents: "0", selling_adjustment_reason: null,
      commercial_charge: null, tax_composition: fixture.input.frozenTaxComposition, delivery_state: "not_sent",
    };
    const queryCounts = { header: 0 };
    let hasSentCheckpoint = true;
    let unresolvedAttempt = false;
    let sentPayload: any = fixture.sentCheckpoint();
    const client: any = { query: async (sql: string) => {
      if (sql.includes("FROM v2_sales_quote_checkpoints")) return { rows: hasSentCheckpoint ? [{ id: fixture.sentCheckpoint().checkpointId, organization_id: "contract-org", quote_document_id: "quote-send-a", payload: sentPayload,
        occurred_at: new Date("2026-10-03T02:00:00.000Z"), prepared_evidence_json: fixture.input.preparedSnapshot, attempt_id: "delivery-a", recipient_email: "prepared@example.test", document_sha256: `sha256:${"b".repeat(64)}`, provider_message_id: "provider-a" }] : [] };
      if (sql.includes("FROM v2_sales_quote_delivery_attempts") && sql.includes("quote_document_id=$2")) return { rows: unresolvedAttempt ? [{ id: "pending-delivery" }] : [] };
      if (sql.includes("FROM v2_sales_quote_delivery_attempts") && sql.includes("id=$2")) return { rows: [{ id: "delivery-a", organization_id: "contract-org", quote_document_id: "quote-send-a", operation_request_id: "send-request", recipient_email: "prepared@example.test", document_sha256: `sha256:${"b".repeat(64)}`, prepared_evidence_json: fixture.input.preparedSnapshot, delivery_state: "succeeded", quote_checkpoint_id: fixture.sentCheckpoint().checkpointId, provider_message_id: "provider-a" }] };
      if (sql.includes("FROM organizations o LEFT JOIN company_settings")) return { rows: [{ name: "Live Organization" }] };
      if (sql.includes("FROM v2_sales_documents d JOIN")) { queryCounts.header++; return { rows: [header] }; }
      if (sql.includes("FROM v2_sales_document_lines")) return { rows: [] };
      throw new Error(`Unexpected document query: ${sql}`);
    } };
    const documents = new PostgresCustomerDocumentService(client);
    const prepared = await documents.quoteDeliveryInTransaction(client, "contract-org" as any, "quote-send-a" as any);
    expect(queryCounts.header).toBe(1);
    expect(prepared.recipientEmail).toBe("live@example.test");
    expect(prepared.document.customer.email).toBe(prepared.recipientEmail);
    expect(prepared.document.number).toBe("QT-LIVE");
    const historical = await documents.quote("contract-org" as any, "quote-send-a" as any);
    expect(historical).toMatchObject({
      number: "QT-PREPARED", issuedAt: "2026-10-02",
      customer: { displayName: "Prepared Customer", contactName: "Prepared Contact", email: "prepared@example.test" },
      organization: { name: "Prepared Organization" },
    });

    hasSentCheckpoint = true;
    sentPayload = { ...fixture.sentCheckpoint() };
    delete sentPayload.sentEvidence;
    await expect(documents.quote("contract-org" as any, "quote-send-a" as any)).rejects.toMatchObject({ code: "CONFLICT" });

    hasSentCheckpoint = false;
    unresolvedAttempt = true;
    await expect(documents.quote("contract-org" as any, "quote-send-a" as any)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  test("completed send replay requires fresh authority plus exact committed checkpoint/request evidence, never provider preparation", async () => {
    const fixture = deliveryFixture(); const recorded = await fixture.send(); expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    let cached: any = recorded.value, linked = true, connections = 0;
    const client: any = { query: async (sql: string, parameters?: unknown[]) => {
      if (sql === publishedQuoteCheckpointSql) {
        expect(parameters).toEqual(["contract-org", "quote-send-a"]);
        return { rows: [{ id: fixture.sentCheckpoint().checkpointId, organization_id: "contract-org", quote_document_id: "quote-send-a", payload: fixture.sentCheckpoint(),
          prepared_evidence_json: fixture.input.preparedSnapshot, attempt_id: "delivery-a", recipient_email: "prepared@example.test",
          document_sha256: fixture.input.preparedSnapshot.documentSha256, provider_message_id: "provider-a" }] };
      }
      if (sql.startsWith("SELECT id FROM v2_sales_quote_delivery_attempts")) {
        expect(parameters).toEqual(["contract-org", "quote-send-a", "send-request", fixture.sentCheckpoint().checkpointId,
          "delivery-a", "prepared@example.test", fixture.input.preparedSnapshot.documentSha256, "provider-a"]);
        return { rows: linked ? [{ id: "delivery-a" }] : [], rowCount: linked ? 1 : 0 };
      }
      expect(["BEGIN", "COMMIT", "ROLLBACK"]).toContain(sql); return { rows: [], rowCount: 0 };
    }, release: () => {} };
    const read = jest.spyOn(PostgresQuoteTransaction.prototype, "read").mockImplementation(async () => fixture.current());
    const provider = jest.fn(async () => { throw new Error("Replay cannot send provider bytes"); });
    const service: any = new PostgresQuoteDeliveryService({ connect: async () => { connections++; return client; } } as any,
      { read: async () => ({ ok: true, value: fixture.current() }) } as any,
      { requireReady: async () => { throw new Error("Replay cannot prepare an email provider"); } } as any);
    service.requests = { reserve: async () => ({ kind: "replay", request: { id: "send-request", status: "succeeded", resultJson: cached } }) };
    service.deliver = provider;
    try {
      const input = { businessRequestId: "send-request", quoteId: "quote-send-a", expectedRevision: "1" };
      await expect(service.send(fixture.context, input)).resolves.toMatchObject({ ok: true, value: { checkpointId: fixture.sentCheckpoint().checkpointId,
        quote: { publishedCheckpointId: fixture.sentCheckpoint().checkpointId, publishedEvidenceStatus: "modern" } } });
      cached = { ...recorded.value, checkpointId: "uncommitted-checkpoint" };
      await expect(service.send(fixture.context, input)).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      cached = recorded.value; linked = false;
      await expect(service.send(fixture.context, input)).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      const before = connections;
      const revoked = { ...fixture.context, principal: { ...fixture.context.principal, authority: { membershipId: "revoked", capabilities: [] } } };
      await expect(service.send(revoked, input)).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(connections).toBe(before); expect(provider).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });
});

describe("M1.10 Quote to Order conversion contract", () => {
  test("uses the explicit conversion capability rather than order-create authority", () => {
    expect(capabilityIds).toContain("quote.convert");
  });

  test("acceptance creates the accepted checkpoint and canonical Order in one transaction without recalculating pricing", async () => {
    const fixture = await conversionFixture();
    const result = await fixture.accept();
    expect(result).toMatchObject({ ok: true });
    expect(fixture.transactions()).toBe(1);
    const state = fixture.state();
    const [sent, accepted, converted] = state.checkpoints;
    expect(sent).toBe(fixture.sentCheckpoint);
    expect(sent.sentEvidence).toMatchObject({ customerContact: fixture.initial.quote.customerContact, recipientEmail: "alex@example.test", documentSha256: `sha256:${"a".repeat(64)}`, documentNumber: "QT-101", documentDate: "2026-09-01", deliveryAttemptId: "delivery-a" });
    expect(accepted).toMatchObject({ kind: "quote_accepted", sourceDocument: { quoteId: "quote-a" }, commercial: { lines: [fixture.line], taxComposition: fixture.initial.quote.taxComposition } });
    expect(accepted.sourceCheckpointId).toBe(sent.checkpointId);
    expect(accepted.commercial).toEqual(sent.commercial);
    expect(accepted.customerPresentation).toEqual(sent.customerPresentation);
    expect(converted).toMatchObject({ kind: "quote_converted", sourceCheckpointId: accepted.checkpointId, commercial: accepted.commercial });
    expect(converted.sentEvidence).toEqual(sent.sentEvidence);
    const orderLine = state.orderRead.order.lines[0];
    expect(state.orderRead.order.customerContact).toEqual(sent.sentEvidence.customerContact);
    expect(orderLine.lineId).not.toBe(fixture.line.lineId);
    expect(orderLine.pricingResult).toEqual(fixture.line.pricingResult);
    expect(orderLine.resolvedConfiguration).toEqual(fixture.line.resolvedConfiguration);
    expect(state.orderRead.order.taxComposition).toEqual(accepted.commercial.taxComposition);
    expect(state.invoice.salesLines[0].sellingLineAmount).toEqual(fixture.line.sellingLineAmount);
    expect(state.artwork[0]).toEqual(["contract-org", "quote-a", accepted.checkpointId]);
    expect(state.artwork[1].lineMap.get(fixture.line.lineId)).toBe(orderLine.lineId);
    expect(state.lineage).toMatchObject({ sourceCheckpointId: accepted.checkpointId, convertedCheckpointId: converted.checkpointId, orderId: state.orderRead.order.orderId });
    expect(result).toMatchObject({ ok: true, value: { quoteId: "quote-a", sourceCheckpointId: accepted.checkpointId, conversionCheckpointId: converted.checkpointId, orderId: state.orderRead.order.orderId, draftInvoiceId: "invoice-a", orderNumber: "ORD-1000", quote: state.quoteRead } });
    if (result.ok) expect(Object.keys(result.value).sort()).toEqual(["conversionCheckpointId", "draftInvoiceId", "orderId", "orderNumber", "quote", "quoteId", "sourceCheckpointId"]);
    expect(fixture.calls.indexOf("material_freeze")).toBeLessThan(fixture.calls.indexOf("draft_invoice"));
    expect(fixture.calls.at(-1)).toBe("commit");
    expect(fixture.messages).toContain("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=transaction result=committed");
  });

  test("acceptance uses an opaque plaintext trace without changing its response contract", async () => {
    const messages: string[] = [];
    const trace = createQuoteConversionTrace({ requestId: "trace-a", sink: message => messages.push(message) });
    trace.durableRequest("secret-business-request", "new");
    trace.failure("draft_invoice", { code: "23505", constraint: "unsafe customer token SQL", message: "secret email cookie" });
    expect(messages[0]).toMatch(/^V2_QUOTE_CONVERSION_TRACE request=trace-a stage=durable_request result=ok durable=[a-f0-9]{16}$/);
    expect(messages[1]).toBe("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=draft_invoice result=failed class=DATABASE_CONSTRAINT");
    expect(messages.join("\n")).not.toMatch(/secret|customer|email|token|cookie|sql/i);
    const brokenSink = createQuoteConversionTrace({ sink: () => { throw new Error("unavailable"); } });
    expect(() => brokenSink.event("transaction", "rolled_back")).not.toThrow();
  });

  test("an already accepted Quote requires an accepted checkpoint, not missing or sent evidence", async () => {
    for (const kind of [undefined, "quote_sent"] as const) {
      const fixture = await conversionFixture();
      fixture.corruptAcceptedCheckpoint(kind);
      const before = structuredClone(fixture.state());
      await expect(fixture.accept("2")).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(fixture.state()).toEqual(before);
      expect(fixture.calls).toEqual(["begin", "rollback"]);
    }
  });

  test("an already accepted Quote converts from its sent-bound acceptance checkpoint", async () => {
    const fixture = await conversionFixture();
    fixture.markAcceptedWithSentSnapshot();
    const result = await fixture.accept("2");
    expect(result).toMatchObject({ ok: true });
    expect(fixture.state().checkpoints.map((checkpoint: any) => checkpoint.kind)).toEqual(["quote_sent", "quote_accepted", "quote_converted"]);
    expect(fixture.state().checkpoints[1].sourceCheckpointId).toBe(fixture.sentCheckpoint.checkpointId);
  });

  test("direct conversion creates the Order from the sent Contact reference", async () => {
    const fixture = await conversionFixture();
    fixture.markAcceptedWithSentSnapshot();
    const result = await fixture.convert("accepted-checkpoint-a");
    expect(result).toMatchObject({ ok: true });
    expect(fixture.state().orderRead.order.customerContact).toEqual(fixture.sentCheckpoint.sentEvidence.customerContact);
    expect(fixture.state().checkpoints[2].sentEvidence).toEqual(fixture.sentCheckpoint.sentEvidence);
  });

  test("accept replay reauthorizes revoked and different actors before returning its protected result", async () => {
    const fixture = await conversionFixture();
    const first = await fixture.accept();
    expect(first).toMatchObject({ ok: true });
    const before = structuredClone(fixture.state());
    const ownerWritesBefore = fixture.calls.filter((call) => !["begin", "commit", "rollback"].includes(call));

    for (const deniedContext of [fixture.contextFor("staff-a", []), fixture.contextFor("staff-b", [])]) {
      const denied = await fixture.accept("1", deniedContext);
      expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(denied).not.toHaveProperty("value");
      expect(fixture.state()).toEqual(before);
    }
    const replay = await fixture.accept("1", fixture.contextFor("staff-a", ["quote.edit", "quote.convert"]));
    expect(replay).toEqual(first);
    expect(fixture.state()).toEqual(before);
    expect(fixture.calls.filter((call) => !["begin", "commit", "rollback"].includes(call))).toEqual(ownerWritesBefore);
  });

  test("direct-convert replay reauthorizes revoked and different actors before returning its protected result", async () => {
    const fixture = await conversionFixture();
    fixture.markAcceptedWithSentSnapshot();
    const first = await fixture.convert("accepted-checkpoint-a");
    expect(first).toMatchObject({ ok: true });
    const before = structuredClone(fixture.state());
    const ownerWritesBefore = fixture.calls.filter((call) => !["begin", "commit", "rollback"].includes(call));

    for (const deniedContext of [fixture.contextFor("staff-a", []), fixture.contextFor("staff-b", [])]) {
      const denied = await fixture.convert("accepted-checkpoint-a", deniedContext);
      expect(denied).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(denied).not.toHaveProperty("value");
      expect(fixture.state()).toEqual(before);
    }
    const replay = await fixture.convert("accepted-checkpoint-a", fixture.contextFor("staff-a", ["quote.convert"]));
    expect(replay).toEqual(first);
    expect(fixture.state()).toEqual(before);
    expect(fixture.calls.filter((call) => !["begin", "commit", "rollback"].includes(call))).toEqual(ownerWritesBefore);
  });

  test("accepts only the last published commercial and Contact despite internal unsent edits", async () => {
    const changes = [
      (quote: any) => ({ ...quote, jobLabel: "unaccepted unsent label" }),
      (quote: any) => ({ ...quote, terms: { commercialNotes: "unsent revision" } }),
      (quote: any) => ({ ...quote, lines: [{ ...quote.lines[0], description: "unsent revision" }] }),
      (quote: any) => ({ ...quote, taxComposition: { ...quote.taxComposition, finalTotalCents: quote.taxComposition.finalTotalCents + 100 } }),
      (quote: any) => ({ ...quote, customerContact: { ...quote.customerContact, contactId: "different-contact-same-display-name" } }),
    ];
    for (const change of changes) {
      const fixture = await conversionFixture();
      fixture.changeCurrentQuote(change);
      await expect(fixture.accept()).resolves.toMatchObject({ ok: true });
      expect(fixture.state().orderRead.order.customerContact).toEqual(fixture.sentCheckpoint.sentEvidence.customerContact);
      expect(fixture.state().orderRead.order.lines[0].description).toBe(fixture.line.description);
      expect(fixture.state().orderRead.order.jobLabel).toBeUndefined();
      expect(fixture.state().orderRead.order.terms).toEqual(fixture.sentCheckpoint.commercial.terms);
      expect(fixture.state().orderRead.order.taxComposition).toEqual(fixture.sentCheckpoint.commercial.taxComposition);
      expect(fixture.state().checkpoints[0]).toEqual(fixture.sentCheckpoint);
    }
  });

  test("legacy sent evidence without an immutable Customer Contact and document identity fails closed", async () => {
    const fixture = await conversionFixture();
    fixture.removeSentEvidence();
    const before = structuredClone(fixture.state());
    await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.state()).toEqual(before);
    expect(fixture.calls).toEqual(["begin", "rollback"]);
  });
  test("canonical publication selection ignores a newer provider-unconfirmed checkpoint", async () => {
    const fixture = await conversionFixture();
    fixture.appendSent({ ...fixture.sentCheckpoint, checkpointId: "unconfirmed-checkpoint", commercial: { ...fixture.sentCheckpoint.commercial, jobLabel: "UNCONFIRMED_SECRET" } });
    fixture.setPublication(fixture.sentCheckpoint.checkpointId);
    await expect(fixture.accept()).resolves.toMatchObject({ ok: true });
    expect(fixture.state().orderRead.order.jobLabel).toBeUndefined();
    expect(fixture.state().checkpoints[2].sourceCheckpointId).toBe(fixture.sentCheckpoint.checkpointId);
  });
  test("legacy NULL modern evidence and unavailable publication never create acceptance or an Order", async () => {
    for (const [id, evidence] of [["sent-checkpoint-a", "historical"], [null, null], ["wrong-checkpoint", "modern"]] as const) {
      const fixture = await conversionFixture(); fixture.setPublication(id, evidence);
      const before = structuredClone(fixture.state());
      await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
      expect(fixture.state()).toEqual(before); expect(fixture.calls).toEqual(["begin", "rollback"]);
    }
  });
  test("a differing internal line set fails closed until Artwork supplies publication-line coordination", async () => {
    const fixture = await conversionFixture(); fixture.setPublication(fixture.sentCheckpoint.checkpointId);
    fixture.changeCurrentQuote(quote => ({ ...quote, lines: [{ ...quote.lines[0], lineId: "unsent-line" }] }));
    const before = structuredClone(fixture.state());
    await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT", message: expect.stringContaining("Artwork publication-line coordination") } });
    expect(fixture.state()).toEqual(before); expect(fixture.calls).toEqual(["begin", "rollback"]);
  });
  test("sent state and newest checkpoint never substitute for missing committed publication proof", async () => {
    const fixture = await conversionFixture(); fixture.clearPublication();
    const before = structuredClone(fixture.state());
    await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.state()).toEqual(before); expect(fixture.calls).toEqual(["begin", "rollback"]);
  });
  test("not_sent internal revision accepts the qualified last publication and ignores unsent commercial/party fields", async () => {
    const fixture = await conversionFixture();
    fixture.changeCurrentQuote(quote => ({ ...quote, deliveryState: "not_sent", jobLabel: "UNSENT LABEL", customerContact: { ...quote.customerContact, contactId: "contact-internal" },
      lines: [{ ...quote.lines[0], description: "UNSENT LINE" }] }));
    await expect(fixture.accept()).resolves.toMatchObject({ ok: true });
    expect(fixture.state().orderRead.order.customerContact).toEqual(fixture.sentCheckpoint.sentEvidence.customerContact);
    expect(fixture.state().orderRead.order.lines[0].description).toBe(fixture.line.description);
    expect(fixture.state().orderRead.order.taxComposition).toEqual(fixture.sentCheckpoint.commercial.taxComposition);
    expect(fixture.state().orderRead.order.jobLabel).toBeUndefined();
    await expect(fixture.accept()).resolves.toMatchObject({ ok: true });
    expect(fixture.calls.filter(call => call === "order_persistence")).toHaveLength(1);
  });
  test("not_sent alone cannot authorize acceptance without publication, stale CAS, or legal terminal state", async () => {
    for (const variant of ["no-publication", "stale", "declined", "voided"] as const) {
      const fixture = await conversionFixture();
      fixture.changeCurrentQuote(quote => ({ ...quote, deliveryState: "not_sent", ...(variant === "declined" || variant === "voided" ? { lifecycleState: variant } : {}) }));
      if (variant === "no-publication") fixture.clearPublication();
      const before = structuredClone(fixture.state());
      await expect(fixture.accept(variant === "stale" ? "stale-token" : "1")).resolves.toMatchObject({ ok: false, error: { code: variant === "stale" ? "STALE_STATE" : "CONFLICT" } });
      expect(fixture.state()).toEqual(before); expect(fixture.calls).toEqual(["begin", "rollback"]);
    }
  });
  test("current unresolved-tax policy remains enforced for both acceptance and conversion", async () => {
    const acceptFixture = await conversionFixture();
    acceptFixture.changeCurrentQuote(quote => ({ ...quote, deliveryState: "not_sent", taxComposition: { status: "unresolved", reason: "tax_jurisdiction_not_configured", finalTotalCents: 200 } }));
    await expect(acceptFixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(acceptFixture.calls).toEqual(["begin", "rollback"]);
    const convertFixture = await conversionFixture(); convertFixture.markAcceptedWithSentSnapshot();
    convertFixture.changeCurrentQuote(quote => ({ ...quote, deliveryState: "not_sent", taxComposition: { status: "unresolved", reason: "tax_jurisdiction_not_configured", finalTotalCents: 200 } }));
    await expect(convertFixture.convert("accepted-checkpoint-a")).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(convertFixture.calls).toEqual(["begin", "rollback"]);
  });
  test.each(["foreign-quote", "foreign-conversion-checkpoint", "publication-proof-lost"])("receipt replay remains bound to authorized publication: %s", async scenario => {
    const fixture = await conversionFixture(); await expect(fixture.accept()).resolves.toMatchObject({ ok: true });
    if (scenario === "foreign-quote") fixture.corruptReceipt(receipt => ({ ...receipt, quoteId: "another-quote" }));
    if (scenario === "foreign-conversion-checkpoint") fixture.corruptReceipt(receipt => ({ ...receipt, conversionCheckpointId: "another-conversion" }));
    if (scenario === "publication-proof-lost") fixture.clearPublication();
    const before = structuredClone(fixture.state()); fixture.calls.length = 0;
    await expect(fixture.accept()).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.state()).toEqual(before); expect(fixture.calls).toEqual(["begin", "rollback"]);
  });

  test("direct conversion rejects accepted evidence that is not bound to its sent checkpoint", async () => {
    const fixture = await conversionFixture();
    fixture.corruptAcceptedCheckpoint();
    const before = structuredClone(fixture.state());
    await expect(fixture.convert("missing-or-invalid")).resolves.toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(fixture.state()).toEqual(before);
    expect(fixture.calls).toEqual(["begin", "rollback"]);
  });

  test("accepted and converted commercial evidence remains pinned to the sent tax composition", async () => {
    const quote = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const conversion = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    const contracts = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "contracts.ts"), "utf8");

    // The sent checkpoint captures the exact composition committed at the
    // customer-document boundary.  Acceptance and conversion consume that
    // evidence rather than consulting mutable tenant tax settings again.
    expect(quote).toMatch(/quoteCommercialSnapshot\(current\.quote\)/);
    expect(contracts).toMatch(/quote\.taxComposition \? \{ taxComposition: quote\.taxComposition \} : \{\}/);
    expect(conversion).toMatch(/taxComposition: source\.commercial\.taxComposition/);
    expect(conversion).toMatch(/const convertedRaw = \{ \.\.\.source,/);
    expect(conversion).toMatch(/evidenceFingerprint: fingerprint\(convertedRaw\)/);
    expect(conversion).not.toMatch(/composePostgresSalesTax|resolveTaxJurisdiction|TaxSettings/);
  });

  test("duplicating a Quote creates a fresh mutable document without copying its frozen tax snapshot", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteApplication.ts"), "utf8");
    const duplicate = source.slice(source.indexOf("async duplicate("), source.indexOf("async update(", source.indexOf("async duplicate(")));

    expect(duplicate).toMatch(/await tx\.create\(/);
    expect(duplicate).not.toMatch(/taxComposition:/);
    expect(duplicate).not.toMatch(/convertedOrderId/);
  });

  test("the normal Quote HTTP and UI flows do not expose standalone acceptance or conversion", async () => {
    const routes = await readFile(path.join(process.cwd(), "v2", "src", "interfaces", "http", "quoteRoutes.ts"), "utf8");
    const ui = await readFile(path.join(process.cwd(), "v2", "ui", "src", "App.tsx"), "utf8");
    expect(routes).toMatch(/dependencies\.conversion\.accept/);
    expect(routes).not.toMatch(/dependencies\.service\[action\]/);
    expect(ui).toMatch(/Accept Quote &amp; Create Order/);
    expect(ui).not.toMatch(/>Convert to Order</);
  });

  test("the canonical Order core is shared and does not reserve an operation request", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "orderApplication.ts"), "utf8");
    const core = source.slice(source.indexOf("async createFromCommercialSnapshot"), source.indexOf("async read(", source.indexOf("async createFromCommercialSnapshot")));
    expect(core).toMatch(/materialRequirements\.freeze/);
    expect(core.indexOf("materialRequirements.freeze")).toBeLessThan(core.indexOf("createDraftInvoice"));
    expect(core).toMatch(/createDraftInvoice/);
    expect(core).toMatch(/instantiateRoutes/);
    expect(core).toMatch(/resolveOrderRoutability/);
    expect(core).toMatch(/not fully configured for production routing/);
    expect(core).not.toMatch(/\.reserve\(/);
    expect(core).not.toMatch(/\.pricing\.calculate\(/);
  });

  test("Order construction retains bounded persistence-stage diagnostics", async () => {
    for (const stage of ["acceptance_checkpoint", "accepted_artwork_snapshot", "routing_resolution", "order_persistence", "material_freeze", "draft_invoice", "artwork_lineage", "conversion_link", "durable_request_completed"]) {
      const fixture = await conversionFixture(stage);
      await expect(fixture.accept()).resolves.toMatchObject({ ok: false });
      expect(fixture.transactions()).toBe(1);
      expect(fixture.state()).toMatchObject({ quoteRead: fixture.initial, checkpoints: [fixture.sentCheckpoint], orderRead: null, invoice: null, lineage: null, artwork: [] });
      expect(fixture.calls.at(-1)).toBe("rollback");
      expect(fixture.messages).toContain(`V2_QUOTE_CONVERSION_TRACE request=trace-a stage=${stage} result=failed class=DATABASE_CONSTRAINT constraint=contract_constraint detail=error_without_database_code`);
      expect(fixture.messages).toContain("V2_QUOTE_CONVERSION_TRACE request=trace-a stage=transaction result=rolled_back");
      expect(fixture.messages.some(message => /secret customer email token SQL/.test(message))).toBe(false);
      expect(fixture.messages.some(message => /result=committed/.test(message))).toBe(false);
      if (["routing_resolution", "draft_invoice"].includes(stage)) expect(fixture.messages).toContain(`V2_QUOTE_CONVERSION_TRACE request=trace-a stage=${stage} result=started`);
    }
  });

  test("Quote send readiness and send both reject unroutable production lines before a document freeze or provider preparation", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteDelivery.ts"), "utf8");
    const send = source.slice(source.indexOf("async send("), source.indexOf("private async prepare("));
    const prepare = source.slice(source.indexOf("private async prepare("), source.indexOf("private async routability("));

    expect(source).toMatch(/resolveOrderRoutability/);
    expect(source).toMatch(/routability: Readonly<\{ status: "ready" \| "unroutable"/);
    expect(send.indexOf("this.prepare")).toBeLessThan(send.indexOf("this.deliver"));
    expect(prepare).toMatch(/await this\.requireRoutability/);
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("freezeTaxComposition"));
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("integrations.requireReady"));
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("quoteDeliveryInTransaction"));
    expect(prepare.indexOf("requireRoutability")).toBeLessThan(prepare.indexOf("renderCustomerSalesPdf"));
  });

  test("conversion has one same-client orchestration boundary and no V1 or HTTP dependency", async () => {
    const source = await readFile(path.join(process.cwd(), "v2", "src", "modules", "sales", "quoteConversionApplication.ts"), "utf8");
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresQuoteConversionTransaction.ts"), "utf8");
    expect(source).not.toMatch(/express|server\/|v2-poc|PricingService/);
    expect(transaction).toMatch(/BEGIN/);
    expect(transaction).toMatch(/PostgresQuoteTransaction/);
    expect(transaction).toMatch(/PostgresOrderTransaction/);
  });

  test("freezes expected material requirements inside the same PostgreSQL conversion boundary", async () => {
    const transaction = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderTransaction.ts"), "utf8");
    const requirements = await readFile(path.join(process.cwd(), "v2", "infrastructure", "sales", "postgresOrderMaterialRequirements.ts"), "utf8");
    expect(transaction).toMatch(/afterMaterialRequirements/);
    expect(requirements).toMatch(/v2_order_line_material_requirements/);
    expect(requirements).toMatch(/ON CONFLICT\(organization_id,order_line_id,source_definition_id\) DO NOTHING/);
    expect(requirements).toMatch(/resolvedConfiguration\.pricingConfigurationId/);
    expect(requirements).toMatch(/inventoryConsumption/);
  });
});
