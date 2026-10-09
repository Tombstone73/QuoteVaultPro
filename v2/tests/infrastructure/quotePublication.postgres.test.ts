import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresQuotePublicationRead, assertQuoteResendSchema, publicationEvidenceStatus, readPublishedQuoteCheckpoints } from "../../infrastructure/sales/postgresQuotePublication.js";
import { quoteDeliverySuppression, isAllowedQuoteSuppression, M77F_QUOTE_RECIPIENT } from "../../infrastructure/communications/m77fQaQuoteDeliverySafety.js";
import { M77F_QA_ORGANIZATION_ID } from "../../infrastructure/communications/m77fQaProofDeliverySafety.js";
import { PostgresPortalCommercialRead } from "../../infrastructure/portal/postgresPortalCommercialRead.js";
import { persistPreparedQuoteDeliveryAttempt, PostgresQuoteDeliveryService } from "../../infrastructure/sales/postgresQuoteDelivery.js";
import { PostgresCustomerDocumentService } from "../../infrastructure/sales/postgresCustomerDocuments.js";
import { PostgresQuoteTransaction } from "../../infrastructure/sales/postgresQuoteTransaction.js";
import { renderCustomerSalesPdf } from "../../infrastructure/sales/customerDocumentRenderer.js";
import { parsePreparedQuoteDeliveryEvidence } from "../../infrastructure/sales/preparedQuoteDeliveryEvidence.js";
import { PostgresOperationRequestRepository } from "../../infrastructure/persistence/postgresOperationRequests.js";
import { V2PricingParityAdapter } from "../../src/modules/pricing/v2PricingAdapter.js";
import { composeSalesTax } from "../../src/modules/sales/taxComposition.js";
import { QuoteConversionApplicationService } from "../../src/modules/sales/quoteConversionApplication.js";
import { OrderApplicationService } from "../../src/modules/sales/orderApplication.js";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { composePostgresSalesTax } from "../../infrastructure/sales/postgresSalesTaxComposition.js";
import { QuoteApplicationService } from "../../src/modules/sales/quoteApplication.js";
import { quoteCommercialSnapshot } from "../../src/modules/sales/contracts.js";
import { createQuotePublicationDiagnostics } from "../../infrastructure/sales/quotePublicationDiagnostics.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import express from "express";
import httpRequest from "supertest";
import { createQuoteRouter } from "../../src/interfaces/http/quoteRoutes.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
const db = new PGlite();
let checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const client: any = { query: async (sql: string, values?: unknown[]) => { const value = await db.query(sql, values); return { ...value, rowCount: value.affectedRows }; }, release: () => {} };
const pool: any = { query: client.query, connect: async () => client };
const principal: any = { kind: "portal", organizationId: "org-a", customerId: "customer-a" };
const originalPrincipal = structuredClone(principal);
const documents: any = new PostgresCustomerDocumentService(pool);
const publication = new PostgresQuotePublicationRead(pool, documents);
const portal = new PostgresPortalCommercialRead(pool, publication);
const requests = new PostgresOperationRequestRepository();
const request = async (id: string, organizationId = "org-a", operation = "sales.quote.delivery.v1") => db.query(
  "INSERT INTO v2_operation_requests(id,organization_id,operation,business_request_id,payload_fingerprint,initiated_principal_kind,initiated_principal_subject) VALUES($1,$2,$3,$1,'inert-fingerprint','staff','staff-a')", [id, organizationId, operation]);
const hash = `sha256:${"a".repeat(64)}`;
const configuration: any = { schemaVersion: 1, organizationId: "org-a", productId: "product-a", pricingConfigurationId: "version-a", pricingConfigurationVersion: "1", pricingConfigurationContentHash: "sha256:version-a", quantity: 2, selections: {}, derivedFacts: {}, productFacts: { measurementMode: "quantity_only" } };
const pricingResult = await new V2PricingParityAdapter().calculate({ organizationId: "org-a", resolvedConfiguration: configuration,
  sellableProduct: { organizationId: "org-a", productId: "product-a", displayName: "Product", lifecycle: "active", requiresDimensions: false, pricingCurrency: "USD", pricingConfiguration: { id: "version-a", version: "1", contentHash: "sha256:version-a" } },
  pricingContext: { channel: "staff", effectiveAt: "2026-10-03T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } } as any);
const frozenLine = { lineId: "line-a", productId: "product-a", quantity: 2, resolvedConfiguration: configuration, pricingResult,
  sellingPriceDecision: { kind: "calculated", pricingResultId: pricingResult.id, calculatedUnitAmount: pricingResult.calculatedUnitAmount, calculatedLineAmount: pricingResult.calculatedLineAmount,
    resultingUnitAmount: pricingResult.calculatedUnitAmount, resultingLineAmount: pricingResult.calculatedLineAmount, decidedAt: "2026-10-03T00:00:00.000Z" },
  calculatedLineAmount: pricingResult.calculatedLineAmount, sellingLineAmount: pricingResult.calculatedLineAmount, taxability: { taxable: true, source: "product" } };
const frozenTax = composeSalesTax({ lines: [{ lineId: "line-a", amountCents: 200, taxable: true }], charges: [{ kind: "handling", cents: 30 }], exemption: { exempt: false },
  resolution: { status: "resolved", receiptLocation: { country: "US", region: "OR" }, jurisdiction: { jurisdictionId: "tax-a", name: "Fixture tax", receiptLocation: { country: "US", region: "OR" }, rateBasisPoints: 750, active: true, homeBusiness: true } } });
const evidence = (id: string, customer = "customer-a", description = "Published original", contact = "contact-a") => ({
  schemaVersion: 1, organizationId: "org-a", quoteId: "quote-a", expectedRevision: id,
  customerContact: { organizationId: "org-a", customerId: customer, contactId: contact },
  commercial: { jobLabel: description, currency: "USD", terms: { commercialNotes: description },
    lines: [{ ...frozenLine, description }], commercialCharge: { kind: "handling", cents: 30 },
    taxComposition: frozenTax },
  customerPresentation: { customerDisplayName: customer, contactDisplayName: contact }, organizationPresentation: { name: "Frozen shop" },
  recipientEmail: `${contact}@example.invalid`, documentSha256: hash, documentNumber: "QT-1", documentDate: "2026-10-03",
});
const checkpoint = (id: string, prepared: ReturnType<typeof evidence>) => ({ schemaVersion: 1, organizationId: "org-a", checkpointId: `cp-${id}`,
  evidenceFingerprint: hash, principal: { principalKind: "staff", subjectId: "staff-a" },
  occurredAt: `2026-10-03T14:0${id}:00.000Z`, kind: "quote_sent", sourceDocument: { quoteId: "quote-a" },
  commercial: prepared.commercial, customerPresentation: prepared.customerPresentation, organizationPresentation: prepared.organizationPresentation,
  sentEvidence: { customerContact: prepared.customerContact, deliveryAttemptId: `attempt-${id}`, recipientEmail: prepared.recipientEmail,
    documentSha256: prepared.documentSha256, documentNumber: prepared.documentNumber, documentDate: prepared.documentDate, providerMessageId: `provider-${id}` } });
const seedCheckpoint = async (id: string, value: unknown) => db.query("INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,payload,occurred_at) VALUES($1,'org-a','quote-a',$2,'quote_sent',$3::jsonb,$4)", [`cp-${id}`, Number(id), JSON.stringify(value), `2026-10-03T14:0${id}:00.000Z`]);
const prepare = async (id: string, prepared: ReturnType<typeof evidence>) => {
  await request(`request-${id}`);
  const result = await persistPreparedQuoteDeliveryAttempt(client, { organizationId: "org-a", quoteId: "quote-a" as any,
    requestId: `request-${id}`, recipientEmail: prepared.recipientEmail, preparedEvidence: prepared as any, principalKind: "staff", principalSubject: "staff-a" });
  // Match the database-generated identity in the immutable checkpoint.
  const cp = checkpoint(id, prepared); cp.sentEvidence.deliveryAttemptId = result.id;
  await db.query("UPDATE v2_sales_quote_details SET tax_composition=$1::jsonb WHERE document_id='quote-a'", [JSON.stringify(prepared.commercial.taxComposition)]);
  await db.exec("BEGIN");
  try {
    equal(await new PostgresQuoteTransaction(client).transition({ organizationId: "org-a" as any, quoteId: "quote-a" as any,
      expectedRevision: Number(id), kind: "send", checkpoint: cp as any, operationRequestId: `request-${id}`, frozenTaxComposition: prepared.commercial.taxComposition as any }), true);
    await db.exec("COMMIT");
  } catch (cause) { await db.exec("ROLLBACK"); throw cause; }
  return { result, cp };
};
const finalize = async (id: string, attemptId: string, prepared: ReturnType<typeof evidence>, failReceipt = false) => {
  const delivery: any = new PostgresQuoteDeliveryService(pool, {} as any, {} as any);
  if (failReceipt) delivery.requests = { recordAttribution: requests.recordAttribution.bind(requests), succeed: async (...args: Parameters<typeof requests.succeed>) => {
    await requests.succeed(...args); throw new Error("inert receipt commit failure");
  } };
  await delivery.succeeded({ organizationId: "org-a", principal: { kind: "staff", organizationId: "org-a", userId: "staff-a" } },
    `request-${id}`, attemptId, "quote-a", `cp-${id}`, `provider-${id}`, prepared.recipientEmail, prepared.documentSha256, JSON.stringify(prepared),
    { checkpointId: `cp-${id}`, quote: { quote: { quoteId: "quote-a", organizationId: "org-a", customerContact: prepared.customerContact }, number: { core: 1n, display: "QT-1" }, revision: id, checkpoints: [] } });
};
try {
  // Diagnostics retain structure, never driver/provider text or document contents.
  {
    const logs: any[] = [];
    const context: any = { organizationId: "b6f969b2-dda3-4133-9d75-c417dabb8f3a" };
    const quoteId = "781faaa6-4036-43e0-bfb5-66e502404f37";
    const businessRequestId = "M7QA:059355e8-c883-4a63-826d-779e9f1cc45b";
    const logger = { log: (level: string, event: string, value: unknown) => logs.push({ level, event, value }) };
    const trace = createQuotePublicationDiagnostics(context, { quoteId, businessRequestId }, logger as any);
    trace.stage("prepare_tax");
    const cause = Object.assign(new Error('SQL parameters: password=private-password; Authorization: Bearer private-token; customer@example.com; private-document'), { code: "23502", detail: "Failing row contains private-row-values", query: "SELECT private-sql", parameters: ["private-parameter"] });
    cause.stack = `Error: ${cause.message}\n    at privateDocumentFunction (/private/home/v2/infrastructure/sales/postgresQuoteDelivery.ts:326:7)\n    at leaked (/private/home/customer-private-file.js:1:2)\n    at secret (https://example.invalid/?token=private-token)`;
    trace.failure(cause);
    equal(logs.length, 1); equal(logs[0].level, "error"); equal(logs[0].event, "v2.quote.publication.unexpected_failure");
    equal(logs[0].value.organizationId, context.organizationId); equal(logs[0].value.resourceId, quoteId);
    equal(logs[0].value.businessRequestIdHash, createHash("sha256").update(businessRequestId).digest("hex"));
    equal(logs[0].value.stage, "prepare_tax"); equal(logs[0].value.exceptionClass, "Error"); equal(logs[0].value.sqlstate, "23502");
    equal(logs[0].value.errorMessage, "PostgreSQL error 23502; original message redacted");
    equal(logs[0].value.stackLocations, ["v2/infrastructure/sales/postgresQuoteDelivery.ts:326:7"]);
    assert.doesNotMatch(JSON.stringify(logs), /private-|privateDocumentFunction|customer@example|M7QA:|Authorization|password=|Bearer/); checks++;
    trace.failure(cause); equal(logs.length, 1);
    trace.stage("qa_reconciliation"); trace.failure(new TypeError("private-token is not a function"));
    equal(logs.length, 2); equal(logs[1].value.operationId, logs[0].value.operationId);
    equal(logs[1].value.errorMessage, "Method is not callable; expression redacted");
    trace.failure(new V2ApplicationError("CONFLICT", "Expected safe reconciliation")); equal(logs.length, 2);
    const hostile = new Proxy({}, { get: () => { throw Error("private-getter-secret"); } });
    trace.failure(hostile); equal(logs[2].value.exceptionClass, "UnknownException");
    const unsafe = createQuotePublicationDiagnostics({ organizationId: "password=private-password" } as any, { quoteId: "private-document", businessRequestId: "private-business-key" }, logger as any);
    unsafe.failure({ name: "private-customer-name", message: "private-document", code: "private-token", stack: "private-document" });
    equal(logs.at(-1).value.organizationId, "redacted_non_uuid"); equal(logs.at(-1).value.resourceId, "redacted_non_uuid");
    equal(logs.at(-1).value.exceptionClass, "UnknownException"); equal(logs.at(-1).value.sqlstate, undefined);
    assert.doesNotMatch(JSON.stringify(logs), /private-/); checks++;
    createQuotePublicationDiagnostics(context, { quoteId, businessRequestId }, { log: () => { throw Error("sink failed"); } }).failure(cause);
    checks++;

    // Unexpected errors still return the original safe boundary result, even if logging fails.
    const staff: any = { kind: "staff", organizationId: context.organizationId, userId: "staff-a", authority: { membershipId: "fixture-member", capabilities: ["quote.send"] } };
    const operation: any = { ...context, principal: staff, operationId: "fixture-http", businessRequest: { id: businessRequestId, payloadFingerprint: "inert" } };
    const input: any = { quoteId, businessRequestId, expectedRevision: "1" };
    const failedRead: any = new PostgresQuoteDeliveryService({} as any, { read: async () => { throw cause; } } as any, {} as any, logger as any);
    const result = await failedRead.send(operation, input);
    equal(result.ok, false); if (!result.ok) { equal(result.error.code, "INTERNAL_ERROR"); equal(result.error.publicMessage, "Quote delivery could not be completed."); }
    equal(logs.at(-1).value.stage, "quote_read");
    const app = express().use(express.json()).use(`/v2/organizations/:organizationId/quotes`, createQuoteRouter({
      principals: { principal: async () => staff }, service: {} as any, formReads: {} as any, delivery: failedRead,
    }));
    const response = await httpRequest(app).post(`/v2/organizations/${context.organizationId}/quotes/${quoteId}/send`).send({ businessRequestId, expectedRevision: "1" }).expect(500);
    equal(response.body, { ok: false, error: { code: "INTERNAL_ERROR", message: "Quote delivery could not be completed." } });
    assert.doesNotMatch(JSON.stringify(response.body), /private-|23502|stack|prepare_/); checks++;
    const sinkFailure = new PostgresQuoteDeliveryService({} as any, { read: async () => { throw cause; } } as any, {} as any, { log: () => { throw Error("sink failure"); } });
    const sinkResult = await sinkFailure.send(operation, input);
    equal(sinkResult.ok, false); if (!sinkResult.ok) equal(sinkResult.error.publicMessage, "Quote delivery could not be completed.");
    const preparation: any = new PostgresQuoteDeliveryService({ connect: async () => ({ query: async () => { throw cause; }, release: () => {} }) } as any, { read: async () => ({ ok: true, value: { quote: { customerContact: { customerId: "customer-a" } } } }) } as any, {} as any, logger as any);
    const connection: any = new PostgresQuoteDeliveryService({ connect: async () => { throw cause; } } as any, { read: async () => ({ ok: true, value: { quote: { customerContact: { customerId: "customer-a" } } } }) } as any, {} as any, logger as any);
    const connectionResult = await connection.send(operation, input);
    equal(connectionResult.ok, false); if (!connectionResult.ok) equal(connectionResult.error.code, "INTERNAL_ERROR");
    equal(logs.at(-1).value.stage, "prepare_connection");
    const preparationResult = await preparation.send(operation, input);
    equal(preparationResult.ok, false); if (!preparationResult.ok) equal(preparationResult.error.code, "INTERNAL_ERROR");
    equal(logs.at(-1).value.stage, "prepare_begin");
    const rollbackCause = Object.assign(new Error("private-rollback-values"), { code: "40P01" });
    const rollbackLogs = logs.length;
    const failedRollback = new PostgresQuoteDeliveryService({ connect: async () => ({ query: async (sql: string) => { throw sql === "ROLLBACK" ? rollbackCause : cause; }, release: () => {} }) } as any, { read: async () => ({ ok: true, value: { quote: { customerContact: { customerId: "customer-a" } } } }) } as any, {} as any, logger as any);
    equal((await failedRollback.send(operation, input)).ok, false);
    equal(logs.slice(rollbackLogs).map(entry => entry.value.stage), ["prepare_begin", "prepare_rollback"]);
    equal(logs.at(-1).value.sqlstate, "40P01"); equal(logs.at(-1).value.operationId, logs.at(-2).value.operationId);
    const recoveryCause = Object.assign(new Error("private-recovery-sql-values"), { code: "42501" });
    const providerCause = Object.assign(new Error("private-provider-token"), { response: { status: 401, data: { error: "invalid_grant", token: "private-token" } } });
    const provider: any = new PostgresQuoteDeliveryService({} as any, { read: async () => ({ ok: true, value: { quote: { customerContact: { customerId: "customer-a" } } } }) } as any, { markReauth: async () => { throw recoveryCause; } } as any, logger as any);
    provider.prepare = async () => ({ requestId: "request-a", attemptId: "attempt-a", recipient: "provider-fixture@example.invalid", integration: {} });
    provider.deliver = async () => { throw providerCause; };
    const recoveryLogs = logs.length;
    const providerOrganization = "11111111-1111-4111-8111-111111111111";
    const recoveredResult = await provider.send({ ...operation, organizationId: providerOrganization, principal: { ...staff, organizationId: providerOrganization } }, input);
    equal(recoveredResult.ok, false); if (!recoveredResult.ok) equal(recoveredResult.error.publicMessage, "Quote delivery could not be completed.");
    equal(logs.slice(recoveryLogs).map(entry => entry.value.stage), ["provider_delivery", "delivery_reconciliation"]);
    equal(logs.at(-1).value.sqlstate, "42501"); equal(logs.at(-1).value.operationId, logs.at(-2).value.operationId);
    assert.doesNotMatch(JSON.stringify(logs), /private-/); checks++;
    const beforeExpected = logs.length;
    const expected = new PostgresQuoteDeliveryService({} as any, { read: async () => { throw new V2ApplicationError("CONFLICT", "Expected safe reconciliation"); } } as any, {} as any, logger as any);
    const expectedResult = await expected.send(operation, input);
    equal(expectedResult.ok, false); if (!expectedResult.ok) equal(expectedResult.error.code, "CONFLICT"); equal(logs.length, beforeExpected);
  }
  await db.exec(`CREATE TABLE organizations(id varchar PRIMARY KEY); CREATE TABLE users(id varchar PRIMARY KEY);
    CREATE TABLE v2_sales_documents(id varchar,organization_id varchar,revision bigint DEFAULT 1,updated_at timestamptz DEFAULT now());
    INSERT INTO v2_sales_documents(id,organization_id) VALUES('quote-a','org-a');
    CREATE TABLE v2_sales_quote_details(document_id varchar,organization_id varchar,acceptance_state varchar DEFAULT 'not_accepted',lifecycle_state varchar DEFAULT 'open',delivery_state varchar DEFAULT 'not_sent',tax_composition jsonb,updated_at timestamptz DEFAULT now(),PRIMARY KEY(document_id,organization_id));
    CREATE TABLE v2_sales_quote_checkpoints(id varchar,organization_id varchar,quote_document_id varchar,checkpoint_sequence int,checkpoint_kind varchar,payload jsonb,occurred_at timestamptz,schema_version int,principal_kind varchar,principal_subject varchar,staff_actor_user_id varchar,operation_request_id varchar,source_checkpoint_id varchar,evidence_fingerprint varchar,PRIMARY KEY(id,organization_id,quote_document_id));
    CREATE TABLE v2_sales_quote_conversions(organization_id varchar,quote_document_id varchar,order_document_id varchar);
    CREATE TABLE v2_audit_events(organization_id varchar,operation_request_id varchar,operation varchar,event_type varchar,resource_type varchar,resource_id varchar,principal_kind varchar,principal_subject varchar,staff_actor_user_id varchar,changes jsonb);
    INSERT INTO organizations VALUES('org-a'),('org-b'); INSERT INTO users VALUES('staff-a'); INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES('quote-a','org-a'),('draft-only','org-a');`);
  const migration = (name: string) => readFileSync(`server/db/migrations_v2/${name}`, "utf8");
  await db.exec(migration("0180_v2_foundation_persistence.sql"));
  await db.exec(migration("0229_v2_sales_customer_delivery_evidence.sql"));
  // Genuine legacy NULL row is created before real 0299. It is never backfilled.
  await request("legacy-request");
  await db.exec("INSERT INTO v2_sales_quote_delivery_attempts(id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,initiated_principal_kind,initiated_principal_subject) VALUES('legacy-attempt','org-a','quote-a','legacy-request','legacy@example.invalid','" + hash + "','staff','staff-a')");
  for (const variant of ["old", "fixed"]) {
    const id = `lost-${variant}-historical`;
    await db.query("INSERT INTO v2_sales_documents(id,organization_id) VALUES($1,'org-a')", [id]);
    await db.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,'org-a')", [id]);
    await request(`${id}-legacy`);
    await db.query("INSERT INTO v2_sales_quote_delivery_attempts(id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,initiated_principal_kind,initiated_principal_subject) VALUES($1,'org-a',$2,$3,'legacy@example.invalid',$4,'staff','staff-a')", [`${id}-attempt`, id, `${id}-legacy`, hash]);
  }
  await db.exec(migration("0299_v2_sales_quote_delivery_prepared_evidence.sql"));
  await db.exec(migration("0304_v2_quote_suppressed_publication.sql"));
  const immutable = migration("0187_v2_sales_commercial_persistence.sql");
  await db.exec(immutable.slice(immutable.indexOf("CREATE OR REPLACE FUNCTION v2_reject_sales_quote_checkpoint_mutation"), immutable.indexOf("CREATE TABLE v2_sales_quote_conversions")));
  await assert.rejects(() => assertQuoteResendSchema(client), /resend schema is unavailable/); checks++;
  // Anticipated COORDINATOR migration contract only, not proof of an assigned migration.
  await db.exec("DROP INDEX v2_sales_quote_delivery_attempts_one_success_uidx; CREATE UNIQUE INDEX v2_sales_quote_delivery_attempts_checkpoint_success_uidx ON v2_sales_quote_delivery_attempts(organization_id,quote_document_id,quote_checkpoint_id) WHERE delivery_state='succeeded'");
  await assertQuoteResendSchema(client); checks++;
  equal(await portal.getQuote(principal, "draft-only"), null);
  equal((await portal.listQuotes(principal)).items, []);
  const firstEvidence = evidence("1");
  const first = await prepare("1", firstEvidence);
  equal(await publication.get("org-a", "customer-a", "quote-a"), null,);
  await finalize("1", first.result.id, firstEvidence);
  const published = await portal.getQuote(principal, "quote-a");
  equal(published?.lines[0].description, "Published original"); equal(published?.total.cents, 247);
  equal(published?.evidenceStatus, "modern"); equal(published?.checkpointId, "cp-1");
  assert.ok((await documents.quoteCheckpointPdf("org-a", "quote-a", "cp-1")).byteLength > 100); checks++;
  equal(await documents.quoteCheckpointPdfEvidence("org-a", "quote-a", "cp-1"), "checkpoint-preview");
  equal((await portal.getQuotePdf(principal, "quote-a", "cp-1"))?.evidence, "checkpoint-preview");
  await assert.rejects(() => documents.quoteCheckpointPdf("org-b", "quote-a", "cp-1"), /Committed Quote publication was not found/); checks++;
  const revisionBeforeDuplicate = (await db.query("SELECT revision FROM v2_sales_documents WHERE id='quote-a'")).rows;
  await db.exec("BEGIN");
  await assert.rejects(() => new PostgresQuoteTransaction(client).transition({ organizationId: "org-a" as any, quoteId: "quote-a" as any,
    expectedRevision: 1, kind: "send", checkpoint: first.cp as any, operationRequestId: "request-1", frozenTaxComposition: firstEvidence.commercial.taxComposition as any }), /expected document revision/); checks++;
  await db.exec("ROLLBACK"); equal((await db.query("SELECT revision FROM v2_sales_documents WHERE id='quote-a'")).rows, revisionBeforeDuplicate);
  const originalRows = (await db.query("SELECT * FROM v2_sales_quote_checkpoints WHERE id='cp-1'")).rows;
  const secondEvidence = evidence("2", "customer-a", "Explicit resend", "contact-b");
  const second = await prepare("2", secondEvidence);
  equal((await portal.getQuote(principal, "quote-a"))?.checkpointId, "cp-1",);
  await assert.rejects(() => documents.quoteCheckpointPdf("org-a", "quote-a", "cp-2"), /Committed Quote publication was not found/); checks++;
  equal(await portal.getQuotePdf(principal, "quote-a", "cp-2"), null);
  equal((await new PostgresQuoteTransaction(client).readPublishedCheckpoints("org-a" as any, "quote-a" as any)).map(cp => cp.checkpointId), ["cp-1"]);
  await db.exec("UPDATE v2_sales_quote_details SET acceptance_state='accepted' WHERE document_id='quote-a'");
  await assert.rejects(() => finalize("2", second.result.id, secondEvidence), /can no longer advance after acceptance/); checks++;
  equal((await portal.getQuote(principal, "quote-a"))?.checkpointId, "cp-1");
  await db.exec("UPDATE v2_sales_quote_details SET acceptance_state='not_accepted' WHERE document_id='quote-a'");
  await assert.rejects(() => finalize("2", second.result.id, secondEvidence, true), /inert receipt commit failure/); checks++;
  equal((await db.query<{ delivery_state: string }>("SELECT delivery_state FROM v2_sales_quote_delivery_attempts WHERE id=$1", [second.result.id])).rows[0].delivery_state, "pending");
  equal((await portal.getQuote(principal, "quote-a"))?.checkpointId, "cp-1");
  equal((await documents.quote("org-a", "quote-a")).lines[0].description, "Published original");
  await assert.rejects(() => documents.fromCheckpoint(pool, "org-a", "quote-a", { payload: second.cp }), /not bound to a committed successful publication/); checks++;
  await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='uncertain',completed_at=now(),failure_message='lost provider response' WHERE id=$1", [second.result.id]);
  equal((await portal.getQuote(principal, "quote-a"))?.lines[0].description, "Published original");
  await assert.rejects(() => documents.quoteCheckpointPdf("org-a", "quote-a", "cp-2"), /Committed Quote publication was not found/); checks++;
  await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='failed' WHERE id=$1", [second.result.id]);
  equal((await portal.getQuote(principal, "quote-a"))?.checkpointId, "cp-1");
  await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='uncertain' WHERE id=$1", [second.result.id]);
  // Do not reconcile or retry the uncertain attempt; a separate inert success
  // fixture models a later explicitly reconciled/new request with new evidence.
  const thirdEvidence = evidence("3", "customer-a", "New published revision", "contact-c");
  const third = await prepare("3", thirdEvidence); await finalize("3", third.result.id, thirdEvidence);
  equal((await portal.getQuote(principal, "quote-a"))?.checkpointId, "cp-3");
  equal((await portal.getQuote(principal, "quote-a", "cp-1"))?.lines[0].description, "Published original");
  equal((await portal.getQuote(principal, "quote-a", "cp-2")), null);
  equal((await db.query("SELECT * FROM v2_sales_quote_checkpoints WHERE id='cp-1'")).rows, originalRows);
  await assert.rejects(() => db.exec("UPDATE v2_sales_quote_checkpoints SET payload='{}' WHERE id='cp-1'"), /immutable/); checks++;
  equal(await publication.get("org-b", "customer-a", "quote-a"), null);
  equal(await publication.get("org-a", "customer-b", "quote-a"), null);
  const fourthEvidence = evidence("4", "customer-b", "Customer B publication", "contact-d");
  const fourth = await prepare("4", fourthEvidence); await finalize("4", fourth.result.id, fourthEvidence);
  equal(await portal.getQuote(principal, "quote-a"), null,);
  equal(await portal.getQuotePdf(principal, "quote-a", "cp-1"), null);
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.history.length, 1);
  equal(await publication.get("org-a", "customer-b", "quote-a", "cp-1"), null);
  equal(await portal.getQuotePdf({ ...principal, customerId: "customer-b" }, "quote-a", "cp-1"), null);
  const legacyEvidence = evidence("5", "customer-b", "Legacy frozen semantics", "legacy");
  const legacyCp = checkpoint("5", legacyEvidence); legacyCp.sentEvidence.deliveryAttemptId = "legacy-attempt";
  legacyCp.sentEvidence.providerMessageId = "legacy-provider";
  await seedCheckpoint("5", legacyCp);
  await db.exec("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='succeeded',completed_at=now(),provider_message_id='legacy-provider',quote_checkpoint_id='cp-5' WHERE id='legacy-attempt'");
  await requests.succeed(client, "org-a", "legacy-request", { resourceType: "quote", resourceId: "quote-a", resultJson: {
    checkpointId: "cp-5", quote: { quote: { organizationId: "org-a", quoteId: "quote-a", customerContact: legacyEvidence.customerContact },
      number: { core: "1", display: "QT-1" }, publishedEvidenceStatus: "modern" },
  } });
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.evidenceStatus, "historical");
  equal((await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='legacy-attempt'")).rows[0].prepared_evidence_json, null);
  const historical = await documents.fromCheckpoint(pool, "org-a", "quote-a", { payload: legacyCp, occurred_at: new Date(legacyCp.occurredAt) });
  equal(historical.organization.name, "Frozen shop"); equal(historical.lines[0].description, "Legacy frozen semantics");
  const unsafeLegacy = structuredClone(legacyCp); delete (unsafeLegacy as any).organizationPresentation;
  await assert.rejects(() => documents.fromCheckpoint(pool, "org-a", "quote-a", { payload: unsafeLegacy }), /Historical Quote evidence is incomplete/); checks++;
  const wrongTenantCheckpoint = structuredClone(legacyCp); wrongTenantCheckpoint.organizationId = "org-b";
  await assert.rejects(() => documents.fromCheckpoint(pool, "org-a", "quote-a", { payload: wrongTenantCheckpoint }), /does not match its organization/); checks++;
  const legacyRowsBeforeResend = (await db.query("SELECT * FROM v2_sales_quote_checkpoints WHERE id='cp-5'")).rows;
  // A saved internal edit advances the mutable revision only. Explicit resend
  // creates new 0299 evidence rather than rewriting the historical NULL.
  await db.exec("UPDATE v2_sales_documents SET revision=6 WHERE id='quote-a'");
  const recoveryPacket = evidence("6", "customer-b", "Modern legacy recovery", "modern-contact");
  const recoveryPdf = await renderCustomerSalesPdf({ kind: "quote", number: recoveryPacket.documentNumber, issuedAt: recoveryPacket.documentDate,
    organization: recoveryPacket.organizationPresentation, customer: { displayName: "customer-b", contactName: "modern-contact", email: recoveryPacket.recipientEmail },
    lines: [{ description: "Modern legacy recovery", quantity: 2, configuration: "", unitCents: 100, totalCents: 200 }],
    currency: "USD", lineSubtotalCents: 200, adjustmentCents: 0, chargeCents: 30, taxCents: 17, totalCents: 247, notes: "Modern legacy recovery" });
  const modernRecoveryEvidence = { ...recoveryPacket, documentPdfBase64: Buffer.from(recoveryPdf).toString("base64"), documentSha256: `sha256:${createHash("sha256").update(recoveryPdf).digest("hex")}` };
  assert.ok(parsePreparedQuoteDeliveryEvidence(modernRecoveryEvidence)); checks++;
  equal(parsePreparedQuoteDeliveryEvidence({ ...modernRecoveryEvidence, documentPdfBase64: Buffer.from("%PDF-forged attachment").toString("base64") }), null);
  const modernRecovery = await prepare("6", modernRecoveryEvidence);
  await assert.rejects(() => db.query("UPDATE v2_sales_quote_delivery_attempts SET prepared_evidence_json=jsonb_set(prepared_evidence_json,'{documentPdfBase64}',to_jsonb($2::text)) WHERE id=$1", [modernRecovery.result.id, Buffer.from("%PDF-replacement").toString("base64")]), /immutable/); checks++;
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.checkpointId, "cp-5");
  await finalize("6", modernRecovery.result.id, modernRecoveryEvidence);
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.evidenceStatus, "modern");
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.checkpointId, "cp-6");
  equal(await documents.quoteCheckpointPdfEvidence("org-a", "quote-a", "cp-6"), "archived-pdf");
  const downloadedPdf = await documents.quoteCheckpointPdf("org-a", "quote-a", "cp-6");
  equal(Buffer.from(downloadedPdf), Buffer.from(recoveryPdf));
  equal(`sha256:${createHash("sha256").update(downloadedPdf).digest("hex")}`, modernRecoveryEvidence.documentSha256);
  equal(Buffer.from(await documents.quotePdf("org-a", "quote-a")), Buffer.from(recoveryPdf));
  const customerDownload = await portal.getQuotePdf({ ...principal, customerId: "customer-b" }, "quote-a", "cp-6");
  equal(customerDownload?.evidence, "archived-pdf"); equal(Buffer.from(customerDownload!.bytes), Buffer.from(recoveryPdf));
  const completedReceipt = (await db.query<any>("SELECT * FROM v2_operation_requests WHERE id='request-6'")).rows[0];
  equal(completedReceipt.status, "succeeded"); equal(completedReceipt.operation, "sales.quote.delivery.v1");
  equal(completedReceipt.result_resource_type, "quote"); equal(completedReceipt.result_resource_id, "quote-a");
  equal(completedReceipt.result_json.checkpointId, "cp-6");
  equal(completedReceipt.result_json.quote.publishedCheckpointId, "cp-6");
  equal(completedReceipt.result_json.quote.publishedEvidenceStatus, "modern");
  const restoreReceipt = async () => db.query("UPDATE v2_operation_requests SET status='succeeded',operation=$2,result_resource_type=$3,result_resource_id=$4,result_json=$5::jsonb,completed_at=$6 WHERE id=$1",
    ["request-6", completedReceipt.operation, completedReceipt.result_resource_type, completedReceipt.result_resource_id, JSON.stringify(completedReceipt.result_json), completedReceipt.completed_at]);
  const receiptFailures: readonly [string, string][] = [
    ["NULL receipt", "result_json=NULL"],
    ["in-progress", "status='in_progress',completed_at=NULL"],
    ["retryable", "status='retryable_failure'"],
    ["permanent", "status='permanent_failure'"],
    ["wrong operation", "operation='sales.quote.send.v1'"],
    ["wrong resource type", "result_resource_type='order'"],
    ["wrong resource ID", "result_resource_id='another-quote'"],
    ["missing resource binding", "result_resource_id=NULL"],
    ["missing checkpoint result", "result_json=result_json-'checkpointId'"],
    ["wrong checkpoint result", "result_json=jsonb_set(result_json,'{checkpointId}','\"cp-1\"')"],
    ["wrong result tenant", "result_json=jsonb_set(result_json,'{quote,quote,organizationId}','\"org-b\"')"],
    ["wrong result Quote", "result_json=jsonb_set(result_json,'{quote,quote,quoteId}','\"another-quote\"')"],
    ["contradictory publication marker", "result_json=jsonb_set(result_json,'{quote,publishedCheckpointId}','\"cp-1\"')"],
  ];
  for (const [name, change] of receiptFailures) {
    await restoreReceipt(); await db.exec(`UPDATE v2_operation_requests SET ${change} WHERE id='request-6'`);
    // Red control: the prior attempt-only SQL selects the newest archived
    // packet for every bad receipt below. The desired exclusion assertion
    // actually fails against that old predicate, without editing runtime code.
    const oldSelector = await db.query<any>("SELECT cp.id,a.prepared_evidence_json FROM v2_sales_quote_checkpoints cp JOIN v2_sales_quote_delivery_attempts a ON a.organization_id=cp.organization_id AND a.quote_document_id=cp.quote_document_id AND a.quote_checkpoint_id=cp.id WHERE cp.organization_id=$1 AND cp.quote_document_id=$2 AND cp.checkpoint_kind='quote_sent' AND a.delivery_state='succeeded' ORDER BY cp.checkpoint_sequence DESC", ["org-a", "quote-a"]);
    equal(oldSelector.rows[0].id, "cp-6");
    equal(Buffer.from(oldSelector.rows[0].prepared_evidence_json.documentPdfBase64, "base64"), Buffer.from(recoveryPdf));
    assert.throws(() => assert.notEqual(oldSelector.rows[0].id, "cp-6"), assert.AssertionError, `P1 old selector must fail: ${name}`); checks++;
    const selected = await publication.get("org-a", "customer-b", "quote-a");
    equal(selected?.checkpointId, "cp-5");
    equal(selected?.history.some(item => item.checkpointId === "cp-6"), false);
    equal((await publication.list("org-a", "customer-b")).items.find(item => item.quoteId === "quote-a")?.checkpointId, "cp-5");
    equal(await publication.get("org-a", "customer-b", "quote-a", "cp-6"), null);
    equal(await portal.getQuotePdf({ ...principal, customerId: "customer-b" }, "quote-a", "cp-6"), null);
    equal((await new PostgresQuoteTransaction(client).readPublishedCheckpoints("org-a" as any, "quote-a" as any)).some(cp => cp.checkpointId === "cp-6"), false);
    await assert.rejects(() => documents.quoteCheckpointPdf("org-a", "quote-a", "cp-6"), /Committed Quote publication was not found/, name); checks++;
    await assert.rejects(() => documents.quoteCheckpointPdfEvidence("org-a", "quote-a", "cp-6"), /Committed Quote publication was not found/, name); checks++;
    const rejectedAcceptance = { ...modernRecovery.cp, checkpointId: "unqualified-acceptance", kind: "quote_accepted", sourceCheckpointId: "cp-6" };
    equal(await new PostgresQuoteTransaction(client).transition({ organizationId: "org-a" as any, quoteId: "quote-a" as any,
      expectedRevision: 7, kind: "accept", checkpoint: rejectedAcceptance as any, operationRequestId: "request-6" }), false);
  }
  await restoreReceipt();
  // Missing completion is physically forbidden; do not weaken the real M0
  // constraint or the tenant FK just to construct an orphan receipt fixture.
  await assert.rejects(() => db.exec("UPDATE v2_operation_requests SET completed_at=NULL WHERE id='request-6'"), /completion_chk/); checks++;
  await assert.rejects(() => db.exec("DELETE FROM v2_operation_requests WHERE id='request-6'"), /foreign key/); checks++;
  equal((await publication.get("org-a", "customer-b", "quote-a"))?.checkpointId, "cp-6");
  equal(Buffer.from((await publication.pdf("org-a", "customer-b", "quote-a", "cp-6"))!.bytes), Buffer.from(recoveryPdf));
  equal((await db.query("SELECT * FROM v2_sales_quote_checkpoints WHERE id='cp-5'")).rows, legacyRowsBeforeResend);
  equal((await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='legacy-attempt'")).rows[0].prepared_evidence_json, null);
  const newerPacket = { ...evidence("1", "customer-b", "Newer first publication", "new-contact"), quoteId: "quote-new", documentNumber: "QT-NEW" };
  await db.exec("INSERT INTO v2_sales_documents(id,organization_id) VALUES('quote-new','org-a'); INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES('quote-new','org-a')");
  await request("request-new");
  await db.query("UPDATE v2_sales_quote_details SET tax_composition=$1::jsonb WHERE document_id='quote-new'", [JSON.stringify(newerPacket.commercial.taxComposition)]);
  const newAttempt = await persistPreparedQuoteDeliveryAttempt(client, { organizationId: "org-a", quoteId: "quote-new" as any, requestId: "request-new",
    recipientEmail: newerPacket.recipientEmail, preparedEvidence: newerPacket as any, principalKind: "staff", principalSubject: "staff-a" });
  const newCheckpoint = { ...checkpoint("7", newerPacket), checkpointId: "cp-new", sourceDocument: { quoteId: "quote-new" },
    sentEvidence: { ...checkpoint("7", newerPacket).sentEvidence, deliveryAttemptId: newAttempt.id, providerMessageId: "provider-new" } };
  equal(await new PostgresQuoteTransaction(client).transition({ organizationId: "org-a" as any, quoteId: "quote-new" as any,
    expectedRevision: 1, kind: "send", checkpoint: newCheckpoint as any, operationRequestId: "request-new", frozenTaxComposition: newerPacket.commercial.taxComposition as any }), true);
  const newDelivery: any = new PostgresQuoteDeliveryService(pool, {} as any, {} as any);
  await newDelivery.succeeded({ organizationId: "org-a", principal: { kind: "staff", organizationId: "org-a", userId: "staff-a" } },
    "request-new", newAttempt.id, "quote-new", "cp-new", "provider-new", newerPacket.recipientEmail, newerPacket.documentSha256, JSON.stringify(newerPacket),
    { checkpointId: "cp-new", quote: { quote: { quoteId: "quote-new", organizationId: "org-a" }, number: { core: 2n, display: "QT-NEW" }, revision: "2", checkpoints: [] } });
  equal((await publication.list("org-a", "customer-b")).items.map(item => item.quoteId), ["quote-new", "quote-a"]);
  const afterNew = Buffer.from(JSON.stringify({ occurredAt: newCheckpoint.occurredAt, id: "quote-new" })).toString("base64url");
  equal((await publication.list("org-a", "customer-b", afterNew)).items.map(item => item.quoteId), ["quote-a"]);
  // Complete the real Quote read adapter's fields. The internal revision is
  // deliberately not_sent; this fixture must not rely on the mutable flag or
  // reset production Artwork lifecycle guards to authorize publication.
  await db.exec(`ALTER TABLE v2_sales_documents ADD COLUMN document_kind varchar DEFAULT 'quote',ADD COLUMN business_number bigint DEFAULT 1,ADD COLUMN display_number varchar DEFAULT 'QT-1',ADD COLUMN customer_id varchar DEFAULT 'customer-internal',ADD COLUMN contact_id varchar DEFAULT 'contact-internal',ADD COLUMN purchase_order_number varchar,ADD COLUMN requested_due_date date,ADD COLUMN currency varchar DEFAULT 'USD',ADD COLUMN terms_json jsonb DEFAULT '{}',ADD COLUMN tax_context_reference varchar,ADD COLUMN sales_representative_id varchar,ADD COLUMN commercial_notes varchar DEFAULT 'UNSENT INTERNAL NOTES',ADD COLUMN job_label varchar DEFAULT 'UNSENT INTERNAL LABEL';
    ALTER TABLE v2_sales_quote_details ADD COLUMN expires_at timestamptz,ADD COLUMN requested_fulfillment_method varchar,ADD COLUMN requested_destination jsonb,ADD COLUMN fulfillment_instructions varchar,ADD COLUMN selling_adjustment_cents bigint DEFAULT 0,ADD COLUMN selling_adjustment_reason varchar,ADD COLUMN commercial_charge jsonb;
    ALTER TABLE v2_sales_quote_conversions ADD COLUMN source_checkpoint_id varchar,ADD COLUMN conversion_checkpoint_id varchar,ADD COLUMN operation_request_id varchar;
    CREATE TABLE v2_sales_document_lines(id varchar,organization_id varchar,document_id varchar,position int,product_id varchar,product_type_id varchar,description varchar,quantity int,calculated_line_cents bigint,selling_line_cents bigint,resolved_configuration jsonb,pricing_result jsonb,selling_price_decision jsonb,taxability_snapshot jsonb);
    CREATE TABLE v2_sales_tax_jurisdictions(id varchar,organization_id varchar,name varchar,country_code varchar,region_code varchar,postal_code varchar,rate_basis_points int,active boolean,home_business boolean,destination_methods varchar[]);
    INSERT INTO v2_sales_tax_jurisdictions VALUES('tax-a','org-a','Fixture tax','US','OR',NULL,750,true,true,'{}');
    CREATE TABLE customers(id varchar,organization_id varchar,is_tax_exempt boolean,tax_exempt_reason varchar,tax_exempt_certificate_ref varchar);
    INSERT INTO customers VALUES('customer-internal','org-a',false,NULL,NULL);
    INSERT INTO users VALUES('staff-b');
    UPDATE v2_sales_quote_details SET delivery_state='not_sent',commercial_charge='{"kind":"handling","cents":30}' WHERE document_id='quote-a';`);
  const currentPricing = await new V2PricingParityAdapter().calculate({ organizationId: "org-a", resolvedConfiguration: configuration,
    sellableProduct: { organizationId: "org-a", productId: "product-a", displayName: "Product", lifecycle: "active", requiresDimensions: false, pricingCurrency: "USD", pricingConfiguration: { id: "version-a", version: "1", contentHash: "sha256:version-a" } },
    pricingContext: { channel: "staff", effectiveAt: "2026-10-03T00:00:00.000Z" }, rules: { base: { perPieceCents: 500 } } } as any);
  const currentDecision = { ...frozenLine.sellingPriceDecision, pricingResultId: currentPricing.id, calculatedUnitAmount: currentPricing.calculatedUnitAmount,
    calculatedLineAmount: currentPricing.calculatedLineAmount, resultingUnitAmount: currentPricing.calculatedUnitAmount, resultingLineAmount: currentPricing.calculatedLineAmount };
  await db.query("INSERT INTO v2_sales_document_lines VALUES('line-a','org-a','quote-a',0,'product-a',NULL,'UNSENT INTERNAL LINE',2,1000,1000,$1::jsonb,$2::jsonb,$3::jsonb,$4::jsonb)",
    [JSON.stringify(configuration), JSON.stringify(currentPricing), JSON.stringify(currentDecision), JSON.stringify(frozenLine.taxability)]);
  const quotePort = new PostgresQuoteTransaction(client);
  const internal = await quotePort.read("org-a" as any, "quote-a" as any);
  equal(internal?.quote.deliveryState, "not_sent"); equal(internal?.publishedCheckpointId, "cp-6"); equal(internal?.publishedEvidenceStatus, "modern");
  equal(internal?.quote.lines[0]?.sellingLineAmount.cents, 1000); equal(internal?.quote.jobLabel, "UNSENT INTERNAL LABEL");
  equal(internal?.quote.customerContact.customerId, "customer-internal");
  let orderRead: any = null, invoiceInput: any = null, orderWrites = 0, artSnapshots = 0;
  const orderPort: any = {
    customers: { validateContactReference: async () => true, getPresentationIdentity: async () => ({ customerDisplayName: "Current operational Customer" }) },
    products: { resolveOrderRoutability: async () => ({ kind: "routable", productName: "Product", routing: { kind: "no_route" } }) },
    pricing: { calculate: async () => { throw Error("Published conversion must not reprice"); } },
    allocateNumber: async () => ({ kind: "order", core: 2n, display: "ORD-2" }),
    create: async (input: any) => { orderWrites++; orderRead = { order: { ...input, commercialState: "open" }, number: input.number, revision: "1" }; },
    materialRequirements: { freeze: async () => {} },
    billing: { createDraftInvoice: async (input: any) => { invoiceInput = input; orderRead.draftInvoice = { invoiceId: "inert-invoice", financialState: "draft", contentState: "editable", currency: "USD", quoteEditable: true }; return { status: "created", invoiceId: "inert-invoice" }; } },
    read: async () => orderRead, audit: async () => {}, attribute: async () => {},
  };
  const runner: any = { transaction: async (action: any) => {
    const priorOrder = orderRead, priorInvoice = invoiceInput, priorWrites = orderWrites, priorArt = artSnapshots;
    await db.exec("BEGIN");
    try { const value = await action({ quote: quotePort, order: orderPort,
      artwork: { snapshotAccepted: async () => { artSnapshots++; }, carryAcceptedToOrder: async () => {} } }); await db.exec("COMMIT"); return value; }
    catch (cause) { await db.exec("ROLLBACK"); orderRead = priorOrder; invoiceInput = priorInvoice; orderWrites = priorWrites; artSnapshots = priorArt; throw cause; }
  } };
  const converter = new QuoteConversionApplicationService(runner, new OrderApplicationService({ transaction: async () => { throw Error("Reuse caller transaction"); } }));
  const acceptContext = (id: string, capabilities = ["quote.edit", "quote.convert"]): any => ({ organizationId: "org-a", operationId: id,
    businessRequest: { id, payloadFingerprint: "derived" }, principal: { kind: "staff", organizationId: "org-a", userId: "staff-b", authority: { membershipId: "fresh-b", capabilities } } });
  const replayInput = { quoteId: "quote-a" as any, expectedRevision: "6", businessRequestId: "request-6" };
  const replayFingerprint = `sha256:${createHash("sha256").update(canonicalJson({ quoteId: replayInput.quoteId, expectedRevision: replayInput.expectedRevision })).digest("hex")}`;
  await db.query("UPDATE v2_operation_requests SET payload_fingerprint=$1 WHERE id='request-6'", [replayFingerprint]);
  const replaySender: any = new PostgresQuoteDeliveryService(pool, new QuoteApplicationService({ transaction: async action => action(quotePort) }),
    { requireReady: async () => { throw Error("Replay must not prepare a provider delivery"); } } as any);
  replaySender.deliver = async () => { throw Error("Replay must not invoke a provider"); };
  const replayRowsBefore = (await db.query("SELECT * FROM v2_sales_quote_checkpoints ORDER BY id")).rows;
  for (const status of [undefined, null, "historical", "modern"]) {
    if (status === undefined) await db.exec("UPDATE v2_operation_requests SET result_json=result_json#-'{quote,publishedEvidenceStatus}' WHERE id='request-6'");
    else await db.query("UPDATE v2_operation_requests SET result_json=jsonb_set(result_json,'{quote,publishedEvidenceStatus}',$1::jsonb) WHERE id='request-6'", [JSON.stringify(status)]);
    const receiptBefore = (await db.query("SELECT * FROM v2_operation_requests WHERE id='request-6'")).rows;
    const replayed = await replaySender.send(acceptContext("request-6", ["quote.view", "quote.send"]), replayInput);
    assert.ok(replayed.ok, replayed.ok ? undefined : replayed.error.publicMessage); checks++;
    equal(replayed.value.quote.publishedCheckpointId, "cp-6");
    equal(replayed.value.quote.publishedEvidenceStatus, "modern");
    equal(replayed.value.quote.number.core, 1n);
    equal((await db.query("SELECT * FROM v2_operation_requests WHERE id='request-6'")).rows, receiptBefore);
  }
  await restoreReceipt();
  equal((await db.query("SELECT * FROM v2_sales_quote_checkpoints ORDER BY id")).rows, replayRowsBefore);
  const deniedDeliveryReplay = await replaySender.send(acceptContext("request-6", ["quote.view"]), replayInput);
  equal(deniedDeliveryReplay.ok, false); if (!deniedDeliveryReplay.ok) equal(deniedDeliveryReplay.error.code, "FORBIDDEN");
  await db.exec("UPDATE v2_operation_requests SET status='permanent_failure' WHERE id='request-6'");
  const unqualifiedDeliveryReplay = await replaySender.send(acceptContext("request-6", ["quote.view", "quote.send"]), replayInput);
  equal(unqualifiedDeliveryReplay.ok, false); if (!unqualifiedDeliveryReplay.ok) equal(unqualifiedDeliveryReplay.error.code, "CONFLICT");
  await restoreReceipt();
  const historicalReplayInput = { ...replayInput, expectedRevision: "5", businessRequestId: "legacy-request" };
  await db.query("UPDATE v2_operation_requests SET payload_fingerprint=$1 WHERE id='legacy-request'",
    [`sha256:${createHash("sha256").update(canonicalJson({ quoteId: historicalReplayInput.quoteId, expectedRevision: historicalReplayInput.expectedRevision })).digest("hex")}`]);
  const historicalReceiptBefore = (await db.query("SELECT * FROM v2_operation_requests WHERE id='legacy-request'")).rows;
  const historicalReplay = await replaySender.send(acceptContext("legacy-request", ["quote.view", "quote.send"]), historicalReplayInput);
  assert.ok(historicalReplay.ok, historicalReplay.ok ? undefined : historicalReplay.error.publicMessage); checks++;
  equal(historicalReplay.value.quote.publishedCheckpointId, "cp-5"); equal(historicalReplay.value.quote.publishedEvidenceStatus, "historical");
  equal((await db.query("SELECT * FROM v2_operation_requests WHERE id='legacy-request'")).rows, historicalReceiptBefore);
  equal((await db.query("SELECT * FROM v2_sales_quote_checkpoints ORDER BY id")).rows, replayRowsBefore);
  equal((await db.query<{ prepared_evidence_json: unknown }>("SELECT prepared_evidence_json FROM v2_sales_quote_delivery_attempts WHERE id='legacy-attempt'")).rows[0].prepared_evidence_json, null);
  const accept = (id: string, revision = internal!.revision, capabilities?: string[]) => converter.accept(acceptContext(id, capabilities), { businessRequestId: id, quoteId: "quote-a" as any, expectedRevision: revision });
  await db.exec("INSERT INTO v2_sales_documents(id,organization_id) VALUES('never-published','org-a'); INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES('never-published','org-a')");
  const neverPublished = await quotePort.read("org-a" as any, "never-published" as any);
  equal(neverPublished?.quote.deliveryState, "not_sent"); equal(neverPublished?.publishedCheckpointId, null);
  const virgin = await converter.accept(acceptContext("never-published-accept"), { businessRequestId: "never-published-accept", quoteId: "never-published" as any, expectedRevision: neverPublished!.revision });
  equal(virgin.ok, false); if (!virgin.ok) equal(virgin.error.code, "CONFLICT"); equal(orderWrites, 0);
  const acceptanceProbe: any = { ...modernRecovery.cp, checkpointId: "acceptance-probe", kind: "quote_accepted", sourceCheckpointId: "cp-6" };
  const priorHeader = (await db.query("SELECT revision FROM v2_sales_documents WHERE id='quote-a'")).rows;
  // P2 red control: the current CAS is correct and publication is qualified,
  // but the old persistence predicate still refuses not_sent solely by flag.
  equal(String(priorHeader[0].revision), String(internal!.revision));
  const oldAcceptance = await db.query("UPDATE v2_sales_quote_details SET acceptance_state='accepted',updated_at=now() WHERE organization_id=$1 AND document_id=$2 AND lifecycle_state='open' AND delivery_state='sent' AND acceptance_state='not_accepted'", ["org-a", "quote-a"]);
  equal(oldAcceptance.affectedRows, 0);
  assert.throws(() => assert.equal(oldAcceptance.affectedRows, 1), assert.AssertionError, "P2 old mutable-flag predicate must fail matching-CAS acceptance"); checks++;
  await db.exec("BEGIN");
  await assert.rejects(() => quotePort.transition({ organizationId: "org-a" as any, quoteId: "quote-a" as any, expectedRevision: 0,
    kind: "accept", checkpoint: acceptanceProbe, operationRequestId: "request-6" }), /expected document revision/); checks++;
  await db.exec("ROLLBACK"); equal((await db.query("SELECT revision FROM v2_sales_documents WHERE id='quote-a'")).rows, priorHeader);
  equal((await quotePort.read("org-a" as any, "quote-a" as any))?.quote.acceptanceState, "not_accepted");
  // Reproduce the baseline one-success schema with a valid not_sent internal
  // revision. Guard against prior committed/raw success, not that draft flag.
  const successes = (await db.query<{ id: string }>("SELECT id FROM v2_sales_quote_delivery_attempts WHERE quote_document_id='quote-a' AND delivery_state='succeeded' AND id<>$1", [modernRecovery.result.id])).rows.map(row => row.id);
  await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='uncertain',failure_message='inert baseline-index fixture' WHERE id=ANY($1::varchar[])", [successes]);
  await db.exec("DROP INDEX v2_sales_quote_delivery_attempts_checkpoint_success_uidx; CREATE UNIQUE INDEX v2_sales_quote_delivery_attempts_one_success_uidx ON v2_sales_quote_delivery_attempts(organization_id,quote_document_id) WHERE delivery_state='succeeded'");
  let providerCalls = 0;
  const guardedSender = new PostgresQuoteDeliveryService(pool, new QuoteApplicationService({ transaction: async action => action(quotePort) }),
    { requireReady: async () => { providerCalls++; throw Error("No provider preparation before resend schema"); } } as any);
  const sendContext = acceptContext("guarded-resend", ["quote.view", "quote.send"]);
  const blocked = await guardedSender.send(sendContext, { quoteId: "quote-a" as any, expectedRevision: internal!.revision, businessRequestId: "guarded-resend" });
  equal(blocked.ok, false); if (!blocked.ok) equal(blocked.error.code, "RETRYABLE_FAILURE"); equal(providerCalls, 0);
  await db.exec("UPDATE v2_operation_requests SET result_json=NULL WHERE id='request-6'");
  const rawSuccessBlocked = await guardedSender.send(acceptContext("guarded-raw-success", ["quote.view", "quote.send"]), { quoteId: "quote-a" as any, expectedRevision: internal!.revision, businessRequestId: "guarded-raw-success" });
  equal(rawSuccessBlocked.ok, false); if (!rawSuccessBlocked.ok) equal(rawSuccessBlocked.error.code, "RETRYABLE_FAILURE"); equal(providerCalls, 0);
  await restoreReceipt();
  await db.exec("DROP INDEX v2_sales_quote_delivery_attempts_one_success_uidx; CREATE UNIQUE INDEX v2_sales_quote_delivery_attempts_checkpoint_success_uidx ON v2_sales_quote_delivery_attempts(organization_id,quote_document_id,quote_checkpoint_id) WHERE delivery_state='succeeded'");
  await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='succeeded',failure_message=NULL WHERE id=ANY($1::varchar[])", [successes]);
  const stale = await accept("stale-revision", "0"); equal(stale.ok, false); if (!stale.ok) equal(stale.error.code, "STALE_STATE");
  for (const terminal of ["declined", "voided"]) {
    await db.query("UPDATE v2_sales_quote_details SET lifecycle_state=$1 WHERE document_id='quote-a'", [terminal]);
    const result = await accept(`terminal-${terminal}`); equal(result.ok, false); if (!result.ok) equal(result.error.code, "CONFLICT");
  }
  await db.exec("UPDATE v2_sales_quote_details SET lifecycle_state='open' WHERE document_id='quote-a'");
  const eligibleReceipts = (await db.query<{ id: string }>("SELECT id FROM v2_operation_requests WHERE organization_id='org-a' AND operation='sales.quote.delivery.v1' AND result_resource_id='quote-a' AND status='succeeded'")).rows.map(row => row.id);
  await db.query("UPDATE v2_operation_requests SET status='permanent_failure' WHERE id=ANY($1::varchar[])", [eligibleReceipts]);
  const absentPublication = await quotePort.read("org-a" as any, "quote-a" as any);
  equal(absentPublication?.publishedCheckpointId, null); equal(absentPublication?.publishedEvidenceStatus, null);
  equal(await publication.get("org-a", "customer-b", "quote-a"), null);
  equal((await publication.list("org-a", "customer-b")).items.some(item => item.quoteId === "quote-a"), false);
  await assert.rejects(() => documents.quotePdf("org-a", "quote-a"), /no qualifying committed publication receipt/); checks++;
  const noPublication = await accept("no-publication"); equal(noPublication.ok, false); if (!noPublication.ok) equal(noPublication.error.code, "CONFLICT");
  equal(await quotePort.transition({ organizationId: "org-a" as any, quoteId: "quote-a" as any, expectedRevision: Number(internal!.revision),
    kind: "accept", checkpoint: acceptanceProbe, operationRequestId: "request-6" }), false);
  await db.query("UPDATE v2_operation_requests SET status='succeeded' WHERE id=ANY($1::varchar[])", [eligibleReceipts]);
  // A bad delivery receipt is rejected by the full converter's real current
  // read, not by a stub publication marker or a new identity/actor key.
  await db.exec("UPDATE v2_operation_requests SET result_json=NULL WHERE id='request-6'");
  const unqualified = await accept("missing-delivery-receipt"); equal(unqualified.ok, false); if (!unqualified.ok) equal(unqualified.error.code, "CONFLICT");
  await restoreReceipt();
  await db.exec("UPDATE v2_sales_tax_jurisdictions SET active=false");
  const currentTax = await composePostgresSalesTax({ client, organizationId: "org-a", customerId: "customer-internal", lines: internal!.quote.lines, charge: { kind: "handling", cents: 30 } });
  await db.query("UPDATE v2_sales_quote_details SET tax_composition=$1::jsonb WHERE document_id='quote-a'", [JSON.stringify(currentTax)]);
  const unresolved = await accept("unresolved-current-tax"); equal(unresolved.ok, false); if (!unresolved.ok) equal(unresolved.error.code, "VALIDATION_ERROR");
  await db.exec("UPDATE v2_sales_tax_jurisdictions SET active=true");
  await db.query("UPDATE v2_sales_quote_details SET tax_composition=$1::jsonb WHERE document_id='quote-a'", [JSON.stringify(await composePostgresSalesTax({ client, organizationId: "org-a", customerId: "customer-internal", lines: internal!.quote.lines, charge: { kind: "handling", cents: 30 } }))]);
  equal(orderWrites, 0); equal(artSnapshots, 0);
  const accepted = await accept("accepted-internal-not-sent"); assert.ok(accepted.ok, accepted.ok ? undefined : accepted.error.publicMessage); checks++;
  equal(orderWrites, 1); equal(artSnapshots, 1);
  equal(orderRead.order.customerContact, recoveryPacket.customerContact);
  equal(orderRead.order.lines[0].description, "Modern legacy recovery"); equal(orderRead.order.lines[0].sellingLineAmount.cents, 200);
  equal(orderRead.order.taxComposition, frozenTax); equal(orderRead.order.jobLabel, "Modern legacy recovery");
  equal(invoiceInput.customerContact, recoveryPacket.customerContact);
  equal(invoiceInput.salesLines[0].sellingLineAmount.cents, 200); equal(invoiceInput.salesCommercialCharge, { kind: "handling", cents: 30 });
  equal((await quotePort.read("org-a" as any, "quote-a" as any))?.quote.deliveryState, "not_sent");
  equal((await accept("accepted-internal-not-sent")).ok, true); equal(orderWrites, 1); equal(artSnapshots, 1);
  const revoked = await accept("accepted-internal-not-sent", internal!.revision, []); equal(revoked.ok, false); if (!revoked.ok) equal(revoked.error.code, "FORBIDDEN");
  await db.exec("UPDATE v2_operation_requests SET status='permanent_failure' WHERE id='request-6'");
  const invalidReplay = await accept("accepted-internal-not-sent"); equal(invalidReplay.ok, false); if (!invalidReplay.ok) equal(invalidReplay.error.code, "CONFLICT");
  await restoreReceipt(); equal(orderWrites, 1); equal(artSnapshots, 1);
  // Exercise actual send/finalization/receipt/exact replay after losing the
  // first response. Only preparation and provider transport are inert; owner
  // lifecycle SQL, M0 completion, qualification and replay remain real.
  // pg returns bigint revisions as strings; PGlite returns numbers by default.
  const lostClient: any = { ...client, query: async (sql: string, values?: unknown[]) => {
    const result = await client.query(sql, values);
    return { ...result, rows: result.rows.map((row: any) => row.revision === undefined ? row : { ...row, revision: String(row.revision) }) };
  } };
  const lostPool: any = { query: lostClient.query, connect: async () => lostClient };
  const lostQuotePort = new PostgresQuoteTransaction(lostClient);
  for (const oldMappings of [true, false]) for (const priorStatus of [null, "historical"] as const) {
    const id = `lost-${oldMappings ? "old" : "fixed"}-${priorStatus ?? "null"}`;
    if (priorStatus === null) {
      await db.query("INSERT INTO v2_sales_documents(id,organization_id) VALUES($1,'org-a')", [id]);
      await db.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,'org-a')", [id]);
    }
    const tax = await composePostgresSalesTax({ client: lostClient, organizationId: "org-a", customerId: "customer-internal", lines: [] });
    await db.query("UPDATE v2_sales_quote_details SET tax_composition=$2::jsonb WHERE document_id=$1", [id, JSON.stringify(tax)]);
    await lostQuotePort.freezeTaxComposition({ organizationId: "org-a" as any, quoteId: id as any, expectedRevision: "1" });
    const draft = (await lostQuotePort.read("org-a" as any, id as any))!;
    const packet = { ...evidence("1", "customer-internal", id, "contact-internal"), quoteId: id,
      customerContact: draft.quote.customerContact, commercial: quoteCommercialSnapshot(draft.quote),
      documentNumber: draft.number.display };
    if (priorStatus === "historical") {
      const legacy = { ...checkpoint("1", packet), checkpointId: `${id}-legacy-cp`, sourceDocument: { quoteId: id },
        sentEvidence: { ...checkpoint("1", packet).sentEvidence, deliveryAttemptId: `${id}-attempt`, recipientEmail: "legacy@example.invalid", providerMessageId: `${id}-legacy-provider` } };
      await db.query("INSERT INTO v2_sales_quote_checkpoints(id,organization_id,quote_document_id,checkpoint_sequence,checkpoint_kind,payload,occurred_at) VALUES($1,'org-a',$2,1,'quote_sent',$3::jsonb,$4)", [legacy.checkpointId, id, JSON.stringify(legacy), legacy.occurredAt]);
      await db.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='succeeded',completed_at=now(),quote_checkpoint_id=$2,provider_message_id=$3 WHERE id=$1", [`${id}-attempt`, legacy.checkpointId, legacy.sentEvidence.providerMessageId]);
      await requests.succeed(client, "org-a", `${id}-legacy`, { resourceType: "quote", resourceId: id,
        resultJson: { checkpointId: legacy.checkpointId, quote: { ...draft, publishedCheckpointId: legacy.checkpointId, publishedEvidenceStatus: "historical", number: { ...draft.number, core: draft.number.core.toString() } } } });
    }
    equal((await lostQuotePort.read("org-a" as any, id as any))?.publishedEvidenceStatus, priorStatus);
    const input = { quoteId: id as any, expectedRevision: draft.revision, businessRequestId: `${id}-send` };
    const context = acceptContext(input.businessRequestId, ["quote.view", "quote.send"]);
    const reserved = await requests.reserve(client, { organizationId: "org-a", operation: "sales.quote.delivery.v1", businessRequestId: input.businessRequestId,
      payloadFingerprint: `sha256:${createHash("sha256").update(canonicalJson({ quoteId: id, expectedRevision: input.expectedRevision })).digest("hex")}`,
      principalKind: "staff", principalSubject: "staff-b", staffActorUserId: "staff-b" });
    const attempt = await persistPreparedQuoteDeliveryAttempt(client, { organizationId: "org-a", quoteId: id as any, requestId: reserved.request.id,
      recipientEmail: packet.recipientEmail, preparedEvidence: packet as any, principalKind: "staff", principalSubject: "staff-b", staffActorUserId: "staff-b" });
    const quoteApplication = new QuoteApplicationService({ transaction: async action => {
      await db.exec("BEGIN");
      try { const value = await action(lostQuotePort); await db.exec("COMMIT"); return value; }
      catch (cause) { await db.exec("ROLLBACK"); throw cause; }
    } });
    let providerDeliveries = 0, lifecycleWrites = 0;
    const recordDelivered = quoteApplication.recordDelivered.bind(quoteApplication);
    quoteApplication.recordDelivered = async (...args) => {
      lifecycleWrites++;
      const recorded = await recordDelivered(...args);
      assert.ok(recorded.ok, recorded.ok ? undefined : `${recorded.error.code}: ${recorded.error.publicMessage}`); checks++;
      return recorded;
    };
    const sender: any = new PostgresQuoteDeliveryService(lostPool, quoteApplication,
      { requireReady: async () => { throw Error("Exact replay must not prepare provider transport"); } } as any);
    sender.deliver = async () => { providerDeliveries++; return `${id}-provider`; };
    const actualPrepare = sender.prepare.bind(sender);
    let firstSend = true;
    sender.prepare = async (...args: any[]) => {
      if (firstSend) {
        firstSend = false;
        return { requestId: reserved.request.id, attemptId: attempt.id, recipient: packet.recipientEmail,
          preparedEvidence: packet, frozenTaxComposition: packet.commercial.taxComposition, integration: {}, document: {}, pdf: new Uint8Array() };
      }
      const prepared = await actualPrepare(...args);
      if (oldMappings && "replay" in prepared) {
        const saved = (await db.query<any>("SELECT result_json FROM v2_operation_requests WHERE id=$1", [reserved.request.id])).rows[0].result_json;
        // Controlled old replay mapping, after all actual authorization and
        // exact receipt/attempt/checkpoint checks have succeeded.
        return { ...prepared, replay: { ...prepared.replay, quote: { ...prepared.replay.quote, publishedEvidenceStatus: saved.quote.publishedEvidenceStatus } } };
      }
      return prepared;
    };
    if (oldMappings) sender.requests = { reserve: requests.reserve.bind(requests), recordAttribution: requests.recordAttribution.bind(requests),
      succeed: async (sqlClient: any, org: string, requestId: string, result: any) => requests.succeed(sqlClient, org, requestId,
        { ...result, resultJson: { ...result.resultJson, quote: { ...result.resultJson.quote, publishedEvidenceStatus: priorStatus } } }) };
    const lostResponse = await sender.send(context, input);
    assert.ok(lostResponse.ok, lostResponse.ok ? undefined : lostResponse.error.publicMessage); checks++;
    const committedCheckpoint = lostResponse.value.checkpointId;
    equal(lostResponse.value.quote.publishedCheckpointId, committedCheckpoint);
    equal(lostResponse.value.quote.publishedEvidenceStatus, "modern");
    const current = (await lostQuotePort.read("org-a" as any, id as any))!;
    equal(current.publishedCheckpointId, committedCheckpoint); equal(current.publishedEvidenceStatus, "modern");
    const receipt = (await db.query<any>("SELECT * FROM v2_operation_requests WHERE id=$1", [reserved.request.id])).rows[0];
    equal(receipt.status, "succeeded"); equal(receipt.result_json.checkpointId, committedCheckpoint);
    equal(receipt.result_json.quote.publishedCheckpointId, committedCheckpoint);
    const effects = async () => Promise.all([
      db.query("SELECT * FROM v2_sales_documents WHERE id=$1", [id]),
      db.query("SELECT * FROM v2_sales_quote_details WHERE document_id=$1", [id]),
      db.query("SELECT * FROM v2_sales_quote_checkpoints WHERE quote_document_id=$1 ORDER BY id", [id]),
      db.query("SELECT * FROM v2_sales_quote_delivery_attempts WHERE quote_document_id=$1 ORDER BY id", [id]),
      db.query("SELECT * FROM v2_operation_requests WHERE result_resource_id=$1 ORDER BY id", [id]),
      db.query("SELECT * FROM v2_principal_attributions WHERE resource_id=$1 ORDER BY id", [id]),
      db.query("SELECT * FROM v2_audit_events WHERE resource_id=$1 ORDER BY operation_request_id", [id]),
    ]).then(results => results.map(result => result.rows));
    const beforeReplay = await effects();
    const replayed = await sender.send(context, input);
    assert.ok(replayed.ok, replayed.ok ? undefined : replayed.error.publicMessage); checks++;
    equal(replayed.value.quote.publishedCheckpointId, committedCheckpoint);
    equal(replayed.value.quote.number.core, current.number.core);
    const cachedDetail = replayed.value.quote;
    const cacheAcceptable = !!cachedDetail.publishedCheckpointId && cachedDetail.publishedEvidenceStatus === "modern"
      && cachedDetail.quote.acceptanceState === "not_accepted" && cachedDetail.quote.taxComposition?.status === "resolved";
    if (oldMappings) {
      equal(receipt.result_json.quote.publishedEvidenceStatus, priorStatus);
      equal(cachedDetail.publishedEvidenceStatus, priorStatus);
      assert.throws(() => assert.equal(receipt.result_json.quote.publishedEvidenceStatus, "modern"), assert.AssertionError); checks++;
      assert.throws(() => assert.equal(cacheAcceptable, true), assert.AssertionError); checks++;
    } else {
      equal(receipt.result_json.quote.publishedEvidenceStatus, "modern");
      equal(cachedDetail.publishedEvidenceStatus, "modern"); equal(cacheAcceptable, true);
    }
    equal(providerDeliveries, 1); equal(lifecycleWrites, 1); equal(await effects(), beforeReplay);
  }
  equal(principal, originalPrincipal);
  // Same real prepare -> Sales checkpoint -> final receipt pipeline, but no integration/provider.
  const qaOrg = M77F_QA_ORGANIZATION_ID;
  const dev = { NODE_ENV: "production", APP_ENV: "development", RAILWAY_PROJECT_NAME: "PrintersHero-DEV", RAILWAY_ENVIRONMENT_NAME: "Development", DATABASE_URL: "postgres://inert@ep-soft-frost-aef6c2jb-pooler.c-2.us-east-2.aws.neon.tech/neondb" };
  const originalEnvironment = Object.fromEntries(Object.keys(dev).map(key => [key, process.env[key]]));
  Object.assign(process.env, dev);
  try {
    const suppression = quoteDeliverySuppression(qaOrg, M77F_QUOTE_RECIPIENT)!;
    equal(suppression.providerCall, "not_attempted");
    for (const recipient of ["", "real@example.com", "other@example.invalid", `${M77F_QUOTE_RECIPIENT}\r\nBcc: real@example.com`, `${M77F_QUOTE_RECIPIENT},other@example.invalid`]) {
      assert.throws(() => quoteDeliverySuppression(qaOrg, recipient)); checks++;
    }
    assert.throws(() => quoteDeliverySuppression("org-a", M77F_QUOTE_RECIPIENT)); checks++;
    equal(quoteDeliverySuppression("org-a", "real@example.com"), undefined);
    for (const [key, value] of Object.entries({ NODE_ENV: "test", APP_ENV: "production", RAILWAY_PROJECT_NAME: "PRODUCTION", RAILWAY_ENVIRONMENT_NAME: "Production", DATABASE_URL: "postgres://inert@prod.invalid/prod" })) {
      process.env[key] = value;
      equal(isAllowedQuoteSuppression(qaOrg, M77F_QUOTE_RECIPIENT, suppression), false);
      assert.throws(() => quoteDeliverySuppression(qaOrg, M77F_QUOTE_RECIPIENT)); checks++;
      Object.assign(process.env, dev);
    }
    delete process.env.DATABASE_URL;
    assert.throws(() => quoteDeliverySuppression(qaOrg, M77F_QUOTE_RECIPIENT)); checks++;
    Object.assign(process.env, dev);
    await db.query("INSERT INTO organizations VALUES($1)", [qaOrg]);
    await db.query("INSERT INTO v2_sales_tax_jurisdictions VALUES('qa-tax',$1,'QA tax','US','OR',NULL,750,true,true,'{}')", [qaOrg]);
    const qaContext = (id: string): any => ({ ...acceptContext(id, ["quote.view", "quote.send", "quote.edit", "quote.convert"]), organizationId: qaOrg,
      principal: { ...acceptContext(id).principal, organizationId: qaOrg, authority: { membershipId: "qa-member", capabilities: ["quote.view", "quote.send", "quote.edit", "quote.convert"] } } });
    const qaApplication = new QuoteApplicationService({ transaction: async action => {
      await db.exec("BEGIN");
      try { const result = await action(lostQuotePort); await db.exec("COMMIT"); return result; }
      catch (cause) { await db.exec("ROLLBACK"); throw cause; }
    } });
    let emailCalls = 0;
    const qaDiagnostics: any[] = [];
    let publicationFailure = "";
    const recordQa = qaApplication.recordDelivered.bind(qaApplication);
    qaApplication.recordDelivered = async (...args) => { const result = await recordQa(...args); if (!result.ok) publicationFailure = `${result.error.code}: ${result.error.publicMessage}`; return result; };
    const sender: any = new PostgresQuoteDeliveryService(lostPool, qaApplication, {
      readiness: async () => { emailCalls++; throw Error("QA must not read Gmail readiness"); },
      requireReady: async () => { emailCalls++; throw Error("QA must not load credentials"); },
    } as any, { log: (_level, _event, detail) => { qaDiagnostics.push(detail); } });
    sender.deliver = async () => { emailCalls++; throw Error("QA must never call the provider"); };
    sender.products = { resolveOrderRoutability: async () => ({ kind: "routable" }) };
    sender.requireRoutability = async () => {};
    const finalizeQa = sender.succeeded.bind(sender);
    sender.succeeded = async (...args: any[]) => { try { return await finalizeQa(...args); } catch (cause) { publicationFailure = String(cause); throw cause; } };
    let recipient = M77F_QUOTE_RECIPIENT;
    sender.documents = {
      quoteRecipientReadiness: async () => ({ status: "ready", email: recipient }),
      quoteRecipientInTransaction: async () => recipient,
      quoteDeliveryInTransaction: async () => ({ recipientEmail: recipient, document: {
        kind: "quote", number: "QT-QA", issuedAt: "2026-10-06", organization: { name: "QA shop" },
        customer: { displayName: "QA Customer", email: recipient }, lines: [{ description: "QA line", quantity: 2, unitCents: 100, totalCents: 200 }], currency: "USD",
        lineSubtotalCents: 200, adjustmentCents: 0, chargeCents: 0, taxCents: 15, totalCents: 215,
      } }),
    };
    const qaConfiguration = { ...configuration, organizationId: qaOrg };
    const qaPricing = await new V2PricingParityAdapter().calculate({ organizationId: qaOrg, resolvedConfiguration: qaConfiguration,
      sellableProduct: { organizationId: qaOrg, productId: "product-a", displayName: "Product", lifecycle: "active", requiresDimensions: false, pricingCurrency: "USD", pricingConfiguration: { id: "version-a", version: "1", contentHash: "sha256:version-a" } },
      pricingContext: { channel: "staff", effectiveAt: "2026-10-06T00:00:00.000Z" }, rules: { base: { perPieceCents: 100 } } } as any);
    const qaDecision = { ...frozenLine.sellingPriceDecision, pricingResultId: qaPricing.id,
      calculatedUnitAmount: qaPricing.calculatedUnitAmount, calculatedLineAmount: qaPricing.calculatedLineAmount,
      resultingUnitAmount: qaPricing.calculatedUnitAmount, resultingLineAmount: qaPricing.calculatedLineAmount };
    const createQa = async (id: string) => {
      await db.query("INSERT INTO v2_sales_documents(id,organization_id) VALUES($1,$2)", [id, qaOrg]);
      await db.query("INSERT INTO v2_sales_quote_details(document_id,organization_id) VALUES($1,$2)", [id, qaOrg]);
      await db.query("INSERT INTO v2_sales_document_lines VALUES($1,$2,$3,0,'product-a',NULL,'QA line',2,200,200,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)",
        [`${id}-line`, qaOrg, id, JSON.stringify(qaConfiguration), JSON.stringify(qaPricing), JSON.stringify(qaDecision), JSON.stringify(frozenLine.taxability)]);
      return { quoteId: id, expectedRevision: "1", businessRequestId: `${id}-send` };
    };
    const qaInput = await createQa("qa-suppressed");
    const readiness = await sender.readiness(qaContext("qa-readiness"), qaInput.quoteId);
    equal(readiness.email.status, "suppressed"); equal(readiness.canSend, true); equal(emailCalls, 0);
    recipient = "real@example.com";
    equal((await sender.readiness(qaContext("qa-readiness"), qaInput.quoteId)).canSend, false);
    equal((await sender.send(qaContext(qaInput.businessRequestId), qaInput)).ok, false);
    equal((await db.query("SELECT id FROM v2_sales_quote_delivery_attempts WHERE quote_document_id=$1", [qaInput.quoteId])).rows.length, 0);
    recipient = M77F_QUOTE_RECIPIENT;
    await db.query("UPDATE v2_sales_tax_jurisdictions SET active=false WHERE organization_id=$1", [qaOrg]);
    equal((await sender.send(qaContext(qaInput.businessRequestId), qaInput)).ok, false);
    equal(emailCalls, 0);
    await db.query("UPDATE v2_sales_tax_jurisdictions SET active=true WHERE organization_id=$1", [qaOrg]);
    const sent = await sender.send(qaContext(qaInput.businessRequestId), qaInput);
    assert.ok(sent.ok, publicationFailure || sent.error?.publicMessage); checks++;
    equal(sent.value.quote.publicationDeliveryMode, "suppressed");
    const rows = await readPublishedQuoteCheckpoints(lostClient, qaOrg, qaInput.quoteId);
    equal(rows.length, 1); equal(publicationEvidenceStatus(rows[0]), "modern");
    equal(rows[0].provider_message_id, null); equal(rows[0].payload.sentEvidence?.providerMessageId, undefined);
    equal(rows[0].payload.sentEvidence?.suppression, suppression);
    equal(publicationEvidenceStatus({ ...rows[0], prepared_evidence_json: null }), null);
    equal(publicationEvidenceStatus({ ...rows[0], suppression_context: null }), null);
    equal(publicationEvidenceStatus({ ...rows[0], provider_message_id: "fake-provider" }), null);
    equal(publicationEvidenceStatus({ ...rows[0], transport: "gmail" }), null);
    equal(publicationEvidenceStatus({ ...rows[0], receipt_delivery_mode: null }), null);
    equal(publicationEvidenceStatus({ ...rows[0], payload: { ...rows[0].payload, sentEvidence: { ...rows[0].payload.sentEvidence, suppression: { ...suppression, providerCall: undefined } } } } as any), null);
    const originalPdf = await documents.quoteCheckpointPdf(qaOrg, qaInput.quoteId, sent.value.checkpointId);
    equal(`sha256:${createHash("sha256").update(originalPdf).digest("hex")}`, rows[0].document_sha256);
    const effects = async () => (await db.query("SELECT * FROM v2_sales_quote_delivery_attempts WHERE quote_document_id=$1", [qaInput.quoteId])).rows;
    const beforeReplay = await effects();
    const connectBeforeReplay = lostPool.connect;
    const replayDiagnosticsBefore = qaDiagnostics.length;
    lostPool.connect = async () => ({ ...lostClient, query: async (sql: string, values?: unknown[]) => {
      if (sql === "COMMIT") throw Object.assign(Error("inert replay commit failure"), { code: "08006" });
      return lostClient.query(sql, values);
    } });
    try {
      const failedReplayCommit = await sender.send(qaContext(qaInput.businessRequestId), qaInput);
      equal(failedReplayCommit.ok, false); equal(failedReplayCommit.error.code, "INTERNAL_ERROR");
      equal(qaDiagnostics.length, replayDiagnosticsBefore + 1); equal(qaDiagnostics.at(-1).stage, "prepare_commit");
      equal(qaDiagnostics.at(-1).sqlstate, "08006"); equal(await effects(), beforeReplay);
    } finally { lostPool.connect = connectBeforeReplay; }
    const replay = await sender.send(qaContext(qaInput.businessRequestId), qaInput);
    assert.ok(replay.ok, replay.error?.publicMessage); checks++;
    equal(replay.value, sent.value); equal(await effects(), beforeReplay); equal(emailCalls, 0);
    equal((await sender.send(qaContext(qaInput.businessRequestId), { ...qaInput, expectedRevision: "999" })).ok, false);
    const applicationInput: any = { ...qaInput, deliveryAttemptId: rows[0].attempt_id, suppression,
      preparedSnapshot: rows[0].prepared_evidence_json, frozenTaxComposition: (rows[0].prepared_evidence_json as any).commercial.taxComposition };
    equal((await qaApplication.recordDelivered(qaContext(qaInput.businessRequestId), applicationInput)).ok, true);
    // Existing real acceptance/conversion owner ports consume the same frozen suppressed source.
    const qaConverter = new QuoteConversionApplicationService({ transaction: async action => {
      await db.exec("BEGIN");
      try { const result = await action({ quote: lostQuotePort, order: orderPort, artwork: { snapshotAccepted: async () => {}, carryAcceptedToOrder: async () => {} } }); await db.exec("COMMIT"); return result; }
      catch (cause) { publicationFailure = String(cause); await db.exec("ROLLBACK"); throw cause; }
    } }, new OrderApplicationService({ transaction: async () => { throw Error("reuse transaction"); } }));
    const acceptInput: any = { quoteId: qaInput.quoteId, businessRequestId: "qa-accept", expectedRevision: "2" };
    const acceptedQa = await qaConverter.accept(qaContext("qa-accept"), acceptInput);
    assert.ok(acceptedQa.ok, publicationFailure || (acceptedQa.ok ? undefined : acceptedQa.error.publicMessage)); checks++;
    equal((await qaConverter.accept(qaContext("qa-accept"), acceptInput)).ok, true);
    equal(await documents.quoteCheckpointPdf(qaOrg, qaInput.quoteId, sent.value.checkpointId), originalPdf);
    process.env.APP_ENV = "production";
    equal(publicationEvidenceStatus(rows[0]), null);
    const driftRead = await lostQuotePort.read(qaOrg as any, qaInput.quoteId as any);
    equal(driftRead?.publishedCheckpointId, null); equal(driftRead?.publishedEvidenceStatus, null);
    await assert.rejects(() => lostQuotePort.readPublishedCheckpoints(qaOrg as any, qaInput.quoteId as any)); checks++;
    await assert.rejects(() => documents.quoteCheckpointPdf(qaOrg, qaInput.quoteId, sent.value.checkpointId)); checks++;
    equal(await publication.get(qaOrg, "customer-internal", qaInput.quoteId), null);
    equal((await sender.send(qaContext(qaInput.businessRequestId), qaInput)).ok, false);
    equal((await qaApplication.recordDelivered(qaContext(qaInput.businessRequestId), applicationInput)).ok, false);
    equal((await qaConverter.accept(qaContext("qa-accept"), acceptInput)).ok, false);
    equal((await sender.send(qaContext("new-after-drift"), { ...qaInput, businessRequestId: "new-after-drift" })).ok, false);
    equal(emailCalls, 0); equal(await effects(), beforeReplay);
    Object.assign(process.env, dev);
    const revisedInput = await createQa("qa-revisions");
    const firstPublication = await sender.send(qaContext(revisedInput.businessRequestId), revisedInput);
    assert.ok(firstPublication.ok); checks++;
    const nextInput = { ...revisedInput, businessRequestId: "qa-revisions-second", expectedRevision: "2" };
    const secondPublication = await sender.send(qaContext(nextInput.businessRequestId), nextInput);
    assert.ok(secondPublication.ok, secondPublication.error?.publicMessage); checks++;
    const revisions = await readPublishedQuoteCheckpoints(lostClient, qaOrg, revisedInput.quoteId);
    equal(revisions.length, 2); equal(revisions[0].id, secondPublication.value.checkpointId);
    equal(revisions[1].id, firstPublication.value.checkpointId);
    const latestRequest = (await db.query<any>("SELECT operation_request_id FROM v2_sales_quote_delivery_attempts WHERE id=$1", [revisions[0].attempt_id])).rows[0].operation_request_id;
    await db.query("UPDATE v2_operation_requests SET result_json=jsonb_set(result_json,'{quote,publicationDeliveryMode}','null'::jsonb) WHERE id=$1", [latestRequest]);
    equal((await readPublishedQuoteCheckpoints(lostClient, qaOrg, revisedInput.quoteId)).length, 2);
    equal((await lostQuotePort.read(qaOrg as any, revisedInput.quoteId as any))?.publishedCheckpointId, null);
    equal(await publication.get(qaOrg, "customer-internal", revisedInput.quoteId), null);
    await assert.rejects(() => documents.quote(qaOrg, revisedInput.quoteId)); checks++;
    const absentReceiptInput = await createQa("qa-unqualified-suppressed");
    const absentReceipt = await sender.send(qaContext(absentReceiptInput.businessRequestId), absentReceiptInput);
    assert.ok(absentReceipt.ok); checks++;
    await db.query("UPDATE v2_operation_requests SET status='permanent_failure' WHERE operation='sales.quote.delivery.v1' AND result_resource_id=$1", [absentReceiptInput.quoteId]);
    await assert.rejects(() => documents.quote(qaOrg, absentReceiptInput.quoteId), /no qualifying committed publication/); checks++;
    // Interrupted checkpoint/final receipt commits stay provider-free and block retries.
    const actualFinalize = sender.succeeded.bind(sender);
    const lostAckInput = await createQa("qa-lost-commit-ack");
    sender.succeeded = async (...args: any[]) => { await actualFinalize(...args); throw Error("inert lost commit acknowledgement"); };
    const lostAck = await sender.send(qaContext(lostAckInput.businessRequestId), lostAckInput);
    equal(lostAck.ok, false); equal(lostAck.error.code, "CONFLICT");
    sender.succeeded = actualFinalize;
    const recoveredAck = await sender.send(qaContext(lostAckInput.businessRequestId), lostAckInput);
    assert.ok(recoveredAck.ok, recoveredAck.error?.publicMessage); checks++;
    equal(recoveredAck.value.quote.publicationDeliveryMode, "suppressed");
    equal((await readPublishedQuoteCheckpoints(lostClient, qaOrg, lostAckInput.quoteId)).length, 1);
    const pendingInput = await createQa("qa-interrupted-preparation");
    const actualPrepare = sender.prepare.bind(sender);
    sender.prepare = async (...args: any[]) => { await actualPrepare(...args); throw Error("inert crash after prepare commit"); };
    equal((await sender.send(qaContext(pendingInput.businessRequestId), pendingInput)).ok, false);
    sender.prepare = actualPrepare;
    const pendingAttempt = (await db.query<any>("SELECT * FROM v2_sales_quote_delivery_attempts WHERE quote_document_id=$1", [pendingInput.quoteId])).rows[0];
    equal(pendingAttempt.delivery_state, "pending"); equal(pendingAttempt.transport, "dev_qa_suppressed"); equal(pendingAttempt.provider_message_id, null);
    equal((await sender.send(qaContext(pendingInput.businessRequestId), pendingInput)).ok, false);
    equal((await sender.send(qaContext("qa-pending-new"), { ...pendingInput, businessRequestId: "qa-pending-new" })).ok, false);
    for (const failurePoint of ["checkpoint", "receipt", "guard-drift"]) {
      const diagnosticsBefore = qaDiagnostics.length;
      const input = await createQa(`qa-fail-${failurePoint}`);
      const actualRecord = qaApplication.recordDelivered.bind(qaApplication);
      if (failurePoint === "checkpoint") qaApplication.recordDelivered = async () => { throw Error("inert checkpoint failure"); };
      sender.succeeded = async (...args: any[]) => {
        if (failurePoint === "guard-drift") { process.env.APP_ENV = "production"; return actualFinalize(...args); }
        throw Error("inert finalization failure");
      };
      const failed = await sender.send(qaContext(input.businessRequestId), input);
      equal(failed.ok, false); equal(failed.error.code, "CONFLICT");
      if (failurePoint !== "guard-drift") { equal(qaDiagnostics.length, diagnosticsBefore + 1); equal(qaDiagnostics.at(-1).stage, failurePoint === "checkpoint" ? "sales_checkpoint" : "receipt_finalization"); }
      assert.match(failed.error.publicMessage, /no provider call was attempted/); checks++;
      Object.assign(process.env, dev); qaApplication.recordDelivered = actualRecord; sender.succeeded = actualFinalize;
      const attempt = (await db.query<any>("SELECT * FROM v2_sales_quote_delivery_attempts WHERE quote_document_id=$1", [input.quoteId])).rows[0];
      equal(attempt.delivery_state, "failed"); equal(attempt.transport, "dev_qa_suppressed"); equal(attempt.provider_message_id, null);
      equal((await readPublishedQuoteCheckpoints(lostClient, qaOrg, input.quoteId)).length, 0);
      equal((await sender.send(qaContext(input.businessRequestId), input)).ok, false);
      equal((await sender.send(qaContext(`${input.businessRequestId}-new`), { ...input, businessRequestId: `${input.businessRequestId}-new`, expectedRevision: failurePoint === "checkpoint" ? "1" : "2" })).ok, false);
    }
    equal(emailCalls, 0);
    const loggerBeforeSuccess = sender.logger;
    let loggerCalls = 0;
    sender.logger = { log: () => { loggerCalls++; throw Error("inert unavailable logger"); } };
    try {
      const successInput = await createQa("qa-unavailable-diagnostic-sink");
      const successResult = await sender.send(qaContext(successInput.businessRequestId), successInput);
      equal(successResult.ok, true); equal(loggerCalls, 0); equal(emailCalls, 0);
    } finally { sender.logger = loggerBeforeSuccess; }
  } finally {
    for (const [key, value] of Object.entries(originalEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  console.log("L0-A-P2 lost-response RED controls: old receipt/replay mappings fail modern receipt and cache acceptance for both null first-send and historical resend. Actual finalization, committed receipt and exact replay pass without duplicate provider/lifecycle/audit/attribution effects.");
  console.log("L0-A-P1-P2 RED controls: old attempt-only selector fails 13 receipt-exclusion assertions and exposes exact archived bytes; old sent-only SQL refuses qualified matching-CAS not_sent acceptance. Corrected reader, persistence and full application flow pass.");
  console.log(`L0-A-PG publication: ${checks} checks passed; actual owner SQL, real 0229/0299 and immutable checkpoint trigger; anticipated resend index fixture only; no native/provider writes.`);
} finally { await db.close(); }
