import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresQuotePublicationRead, assertQuoteResendSchema } from "../../infrastructure/sales/postgresQuotePublication.js";
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
  await db.exec(migration("0299_v2_sales_quote_delivery_prepared_evidence.sql"));
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
  equal(principal, originalPrincipal);
  console.log("L0-A-P1-P2 RED controls: old attempt-only selector fails 13 receipt-exclusion assertions and exposes exact archived bytes; old sent-only SQL refuses qualified matching-CAS not_sent acceptance. Corrected reader, persistence and full application flow pass.");
  console.log(`L0-A-PG publication: ${checks} checks passed; actual owner SQL, real 0229/0299 and immutable checkpoint trigger; anticipated resend index fixture only; no native/provider writes.`);
} finally { await db.close(); }
