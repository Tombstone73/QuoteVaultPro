import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { google } from "googleapis";
import type { OperationContext } from "../../src/application/operation.js";
import { requireOperationPrincipalScope } from "../../src/application/operation.js";
import { AuthorityPolicy } from "../../src/authorization/authorityPolicy.js";
import { principalSubject, staffActorId } from "../../src/authorization/principals.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../src/errors/applicationError.js";
import type { QuoteDeliveredInput, QuoteLifecycleInput, QuoteOperationResult, QuoteApplicationService } from "../../src/modules/sales/quoteApplication.js";
import { brandedId, canonicalJson, type QuoteId } from "../../src/modules/shared/commercialValues.js";
import { quoteCommercialSnapshot, type PreparedQuoteDeliveryEvidence } from "../../src/modules/sales/contracts.js";
import type { ProductsReadPort } from "../../src/modules/products/contracts.js";
import { PostgresProductsCompatibilityReader } from "../compatibility/postgresProductsRead.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";
import type { CustomerSalesDocument } from "./customerDocumentRenderer.js";
import { customerDocumentFilename, renderCustomerSalesPdf } from "./customerDocumentRenderer.js";
import { PostgresCustomerDocumentService } from "./postgresCustomerDocuments.js";
import { PostgresQuoteTransaction } from "./postgresQuoteTransaction.js";
import { parsePreparedQuoteDeliveryEvidence, serializePreparedQuoteDeliveryEvidence } from "./preparedQuoteDeliveryEvidence.js";
import type { SalesTaxComposition } from "../../src/modules/sales/taxComposition.js";
import { PostgresEmailIntegrationService, type EmailReadiness, type ReadyGmailIntegration } from "../communications/postgresEmailIntegration.js";

type AttemptRow = {
  id: string;
  organization_id: string;
  quote_document_id: string;
  operation_request_id: string;
  recipient_email: string;
  document_sha256: string;
  prepared_evidence_json: unknown | null;
  delivery_state: "pending" | "succeeded" | "failed" | "uncertain";
};
type PreparedDelivery = Readonly<{
  requestId: string;
  attemptId: string;
  recipient: string;
  document: CustomerSalesDocument;
  pdf: Uint8Array;
  preparedEvidence: PreparedQuoteDeliveryEvidence;
  frozenTaxComposition: SalesTaxComposition;
  integration: ReadyGmailIntegration;
}> | Readonly<{ requestId: string; replay: QuoteOperationResult }>;
const fingerprint = (value: unknown): string => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const email = (value: string | undefined): string | null => value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
const preparedEvidenceMatchesAttempt = (row: AttemptRow, evidence: PreparedQuoteDeliveryEvidence): boolean =>
  row.organization_id === evidence.organizationId && row.quote_document_id === evidence.quoteId
  && row.recipient_email === evidence.recipientEmail && row.document_sha256 === evidence.documentSha256
  && canonicalJson(parsePreparedQuoteDeliveryEvidence(row.prepared_evidence_json)) === canonicalJson(evidence);

export const loadPreparedQuoteDeliveryEvidenceFromAttempt = (row: AttemptRow): PreparedQuoteDeliveryEvidence | null => {
  const evidence = parsePreparedQuoteDeliveryEvidence(row.prepared_evidence_json);
  return evidence && preparedEvidenceMatchesAttempt(row, evidence) ? evidence : null;
};

export const canRetryPreparedQuoteDeliveryAttempt = (row: AttemptRow, evidence: PreparedQuoteDeliveryEvidence): boolean =>
  row.delivery_state === "failed"
  && canonicalJson(loadPreparedQuoteDeliveryEvidenceFromAttempt(row)) === canonicalJson(evidence);

export const persistPreparedQuoteDeliveryAttempt = async (
  client: Pick<PoolClient, "query">,
  input: Readonly<{
    organizationId: string;
    quoteId: QuoteId;
    requestId: string;
    recipientEmail: string;
    preparedEvidence: PreparedQuoteDeliveryEvidence;
    principalKind: string;
    principalSubject: string;
    staffActorUserId?: string;
  }>,
): Promise<AttemptRow> => {
  const evidenceJson = serializePreparedQuoteDeliveryEvidence(input.preparedEvidence);
  if (input.preparedEvidence.organizationId !== input.organizationId || input.preparedEvidence.quoteId !== input.quoteId
    || input.preparedEvidence.recipientEmail !== input.recipientEmail)
    throw new V2ApplicationError("VALIDATION_ERROR", "Prepared Quote attempt identity does not match its evidence.");
  const result = await client.query<AttemptRow>(
    "INSERT INTO v2_sales_quote_delivery_attempts(organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,prepared_evidence_json,initiated_principal_kind,initiated_principal_subject,initiated_staff_actor_user_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,prepared_evidence_json,delivery_state",
    [input.organizationId, input.quoteId, input.requestId, input.recipientEmail, input.preparedEvidence.documentSha256, evidenceJson, input.principalKind, input.principalSubject, input.staffActorUserId ?? null],
  );
  const row = result.rows[0];
  if (!row || row.delivery_state !== "pending" || !loadPreparedQuoteDeliveryEvidenceFromAttempt(row)
    || canonicalJson(loadPreparedQuoteDeliveryEvidenceFromAttempt(row)) !== canonicalJson(input.preparedEvidence))
    throw new V2ApplicationError("CONFLICT", "Prepared Quote evidence could not be durably stored.");
  return row;
};

const providerDefinitelyRejected = (cause: unknown): boolean => {
  const status = typeof cause === "object" && cause && "response" in cause
    ? Number((cause as { response?: { status?: unknown } }).response?.status)
    : NaN;
  return Number.isInteger(status) && status >= 400 && status < 600;
};
const providerRequiresReauth = (cause: unknown): boolean => {
  const status = typeof cause === "object" && cause && "response" in cause
    ? Number((cause as { response?: { status?: unknown } }).response?.status)
    : NaN;
  const reason = typeof cause === "object" && cause && "response" in cause
    ? JSON.stringify((cause as { response?: { data?: unknown } }).response?.data ?? "")
    : String(cause ?? "");
  return (status === 400 || status === 401) && /invalid_grant|invalid credentials|auth(?:entication|orization)/iu.test(reason);
};
export type QuoteSendReadiness = Readonly<{
  recipient: Readonly<{ status: "ready" | "contact_missing" | "email_missing" | "contact_unavailable"; email?: string }>;
  tax: Readonly<{ status: "ready" | "unresolved" }>;
  routability: Readonly<{ status: "ready" | "unroutable"; productNames?: readonly string[] }>;
  email: EmailReadiness;
  canSend: boolean;
}>;

const rawMessage = (input: Readonly<{ from: string; to: string; subject: string; body: string; attachment: Uint8Array; filename: string }>): string => {
  const boundary = `v2-sales-${createHash("sha256").update(`${input.to}:${input.subject}:${Date.now()}`).digest("hex").slice(0, 24)}`;
  const body = input.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
  const message = [
    `From: ${input.from}`, `To: ${input.to}`, `Subject: ${input.subject}`, "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`, "",
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", `<p>${body}</p>`, "",
    `--${boundary}`, "Content-Type: application/pdf", "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename=\"${input.filename}\"`, "", Buffer.from(input.attachment).toString("base64"), "",
    `--${boundary}--`,
  ].join("\r\n");
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The provider adapter is intentionally V2-local: it reads the existing
 * tenant email connection but never imports V1 routes/services or their
 * mutable Quote renderer.  The attachment is the V2 frozen Sales projection.
 */
export class PostgresQuoteDeliveryService {
  private readonly requests = new PostgresOperationRequestRepository();
  private readonly documents: PostgresCustomerDocumentService;
  private readonly integrations: PostgresEmailIntegrationService;
  private readonly products: ProductsReadPort;
  constructor(private readonly pool: Pool, private readonly quoteService: QuoteApplicationService, integrations?: PostgresEmailIntegrationService) { this.documents = new PostgresCustomerDocumentService(pool); this.integrations = integrations ?? new PostgresEmailIntegrationService(pool); this.products = new PostgresProductsCompatibilityReader(pool); }

  async readiness(context: OperationContext, quoteId: QuoteId): Promise<QuoteSendReadiness> {
    requireOperationPrincipalScope(context);
    const quote = await this.quoteService.read(context, quoteId);
    if (!quote.ok) throw quote.error;
    if (!new AuthorityPolicy().decide(context.principal, { capability: "quote.send", resource: { organizationId: context.organizationId, customerId: quote.value.quote.customerContact.customerId } }).allowed)
      throw new V2ApplicationError("FORBIDDEN", "Quote delivery is unavailable.");
    const recipient = await this.documents.quoteRecipientReadiness(brandedId<"OrganizationId">(context.organizationId), quoteId);
    const tax = quote.value.quote.taxComposition?.status === "resolved" ? { status: "ready" as const } : { status: "unresolved" as const };
    const routability = await this.routability(context.organizationId, quote.value.quote.lines);
    const integration = await this.integrations.readiness(context.organizationId);
    return { recipient, tax, routability, email: integration, canSend: recipient.status === "ready" && tax.status === "ready" && routability.status === "ready" && integration.status === "ready" };
  }

  async send(context: OperationContext, input: QuoteLifecycleInput): Promise<ApplicationResult<QuoteOperationResult>> {
    try {
      requireOperationPrincipalScope(context);
      if (!context.businessRequest || context.businessRequest.id !== input.businessRequestId) throw new V2ApplicationError("VALIDATION_ERROR", "A business request identity is required.");
      const quote = await this.quoteService.read(context, input.quoteId);
      if (!quote.ok) return quote;
      if (!new AuthorityPolicy().decide(context.principal, { capability: "quote.send", resource: { organizationId: context.organizationId, customerId: quote.value.quote.customerContact.customerId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "Quote delivery is unavailable.");
      if (quote.value.quote.deliveryState !== "not_sent") throw new V2ApplicationError("CONFLICT", "Quote has already been sent.");
      if (quote.value.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before sending.");
      // Deterministic prerequisites are checked before preparation can freeze
      // commercial evidence or reserve a delivery attempt. The transaction
      // repeats all checks under the Quote lock to protect the send race.
      const recipient = email(await this.documents.quoteRecipient(brandedId<"OrganizationId">(context.organizationId), input.quoteId));
      if (!recipient) throw new V2ApplicationError("VALIDATION_ERROR", "The selected Quote contact needs a valid email address before sending.");
      if (quote.value.quote.taxComposition?.status !== "resolved") throw new V2ApplicationError("CONFLICT", "A customer document requires resolved authoritative tax.");
      await this.requireRoutability(context.organizationId, quote.value.quote.lines);
      const integration = await this.integrations.requireReady(context.organizationId);

      const prepared = await this.prepare(context, input, integration);
      if ("replay" in prepared) return success(prepared.replay);

      let providerMessageId: string;
      try { providerMessageId = await this.deliver(prepared.integration, prepared.recipient, prepared.document, prepared.pdf); }
      catch (cause) {
        if (providerRequiresReauth(cause)) {
          await this.integrations.markReauth(context.organizationId, "provider_authorization_revoked", context.principal);
          await this.failed(context.organizationId, prepared.requestId, prepared.attemptId, "The Gmail connection needs reconnecting before delivery can be retried.");
          throw new V2ApplicationError("VALIDATION_ERROR", "The organization Gmail connection requires reconnecting.");
        }
        if (providerDefinitelyRejected(cause)) {
          await this.failed(context.organizationId, prepared.requestId, prepared.attemptId, "The email provider rejected the delivery before accepting it.");
          throw new V2ApplicationError("RETRYABLE_FAILURE", "Quote delivery was rejected by the provider. No sent state was recorded; retry with the same request.");
        }
        await this.uncertain(context.organizationId, prepared.requestId, prepared.attemptId, "The provider outcome is unknown; automatic retry is disabled to avoid duplicate customer delivery.");
        throw new V2ApplicationError("CONFLICT", "Quote delivery outcome is unknown. The Quote was not marked sent; reconcile delivery before trying again.");
      }

      const committed: QuoteDeliveredInput = {
        ...input,
        deliveryAttemptId: prepared.attemptId,
        providerMessageId,
        preparedSnapshot: prepared.preparedEvidence,
        frozenTaxComposition: prepared.frozenTaxComposition,
      };
      const transitioned = await this.quoteService.recordDelivered(context, committed);
      if (!transitioned.ok) {
        await this.uncertain(context.organizationId, prepared.requestId, prepared.attemptId, "The provider accepted delivery but the Quote lifecycle transition requires reconciliation; automatic retry is disabled.", providerMessageId);
        return failure(new V2ApplicationError("CONFLICT", "The provider accepted delivery; Quote state needs reconciliation."));
      }
      if (!transitioned.value.checkpointId) {
        await this.uncertain(context.organizationId, prepared.requestId, prepared.attemptId, "The provider accepted delivery but immutable Quote evidence was not confirmed; automatic retry is disabled.", providerMessageId);
        throw new V2ApplicationError("CONFLICT", "Quote delivery requires reconciliation before it can be retried.");
      }
      try {
        await this.succeeded(context, prepared.requestId, prepared.attemptId, input.quoteId, transitioned.value.checkpointId, providerMessageId, prepared.recipient, prepared.preparedEvidence.documentSha256, serializePreparedQuoteDeliveryEvidence(prepared.preparedEvidence), transitioned.value);
      } catch {
        await this.uncertain(context.organizationId, prepared.requestId, prepared.attemptId, "The provider accepted delivery and Quote state changed, but delivery evidence could not be finalized; automatic retry is disabled.", providerMessageId);
        throw new V2ApplicationError("CONFLICT", "Quote delivery evidence requires reconciliation before it can be retried.");
      }
      return transitioned;
    } catch (cause) {
      return failure(cause instanceof V2ApplicationError ? cause : new V2ApplicationError("INTERNAL_ERROR", "Quote delivery could not be completed."));
    }
  }

  /**
   * The only mutable-to-customer-document boundary.  It locks the current
   * Quote, recomposes current authoritative tax, persists that exact JSON
   * evidence, renders the attachment from the same transaction, then creates
   * the pending provider attempt.  Nothing has left the platform if this
   * transaction rolls back.
   */
  private async prepare(context: OperationContext, input: QuoteLifecycleInput, integration: ReadyGmailIntegration): Promise<PreparedDelivery> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const reservation = await this.requests.reserve(client, { organizationId: context.organizationId, operation: "sales.quote.delivery.v1", businessRequestId: input.businessRequestId, payloadFingerprint: fingerprint({ quoteId: input.quoteId, expectedRevision: input.expectedRevision }), principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
      if (reservation.kind === "replay") {
        if (reservation.request.status === "succeeded") { await client.query("COMMIT"); return { requestId: reservation.request.id, replay: reservation.request.resultJson as QuoteOperationResult }; }
        throw new V2ApplicationError("CONFLICT", "This Quote delivery request is already in progress.");
      }
      const transaction = new PostgresQuoteTransaction(client);
      const frozen = await transaction.freezeTaxComposition({ organizationId: brandedId<"OrganizationId">(context.organizationId), quoteId: input.quoteId, expectedRevision: input.expectedRevision });
      if (!frozen) throw new V2ApplicationError("NOT_FOUND", "Quote was not found.");
      if (frozen.revision !== input.expectedRevision) throw new V2ApplicationError("STALE_STATE", "Quote has changed; reload before sending.");
      if (frozen.quote.deliveryState !== "not_sent") throw new V2ApplicationError("CONFLICT", "Quote has already been sent.");
      if (frozen.quote.acceptanceState !== "not_accepted" || frozen.quote.lifecycleState !== "open") throw new V2ApplicationError("CONFLICT", "This Quote cannot be sent.");
      const frozenTaxComposition = frozen.quote.taxComposition;
      if (!frozenTaxComposition || frozenTaxComposition.status !== "resolved") throw new V2ApplicationError("CONFLICT", "A customer document requires resolved authoritative tax.");
      await this.requireRoutability(context.organizationId, frozen.quote.lines, new PostgresProductsCompatibilityReader(client));
      const preparedDocument = await this.documents.quoteDeliveryInTransaction(client, brandedId<"OrganizationId">(context.organizationId), input.quoteId);
      const document = preparedDocument.document;
      const recipient = email(preparedDocument.recipientEmail);
      if (!recipient) throw new V2ApplicationError("VALIDATION_ERROR", "The selected Quote contact needs a valid email address before sending.");
      const pdf = await renderCustomerSalesPdf(document);
      const sha = `sha256:${createHash("sha256").update(pdf).digest("hex")}`;
      const customerPresentation: PreparedQuoteDeliveryEvidence["customerPresentation"] = {
        customerDisplayName: document.customer.displayName,
        ...(document.customer.contactName ? { contactDisplayName: document.customer.contactName } : {}),
        ...(document.customer.email ? { email: document.customer.email } : {}),
      };
      const preparedEvidence: PreparedQuoteDeliveryEvidence = {
        schemaVersion: 1,
        organizationId: brandedId<"OrganizationId">(context.organizationId),
        quoteId: input.quoteId,
        expectedRevision: frozen.revision,
        customerContact: frozen.quote.customerContact,
        commercial: quoteCommercialSnapshot(frozen.quote),
        customerPresentation,
        organizationPresentation: document.organization,
        recipientEmail: recipient,
        documentSha256: sha,
        documentNumber: document.number,
        documentDate: document.issuedAt,
      };
      const preparedEvidenceJson = serializePreparedQuoteDeliveryEvidence(preparedEvidence);
      const uncertain = await client.query<{ id: string }>("SELECT id FROM v2_sales_quote_delivery_attempts WHERE organization_id=$1 AND quote_document_id=$2 AND delivery_state IN ('pending','uncertain') LIMIT 1 FOR UPDATE", [context.organizationId, input.quoteId]);
      if (uncertain.rows[0]) throw new V2ApplicationError("CONFLICT", "A previous Quote delivery is still unresolved. Reconcile it before sending again.");
      const existing = await client.query<AttemptRow>("SELECT id,organization_id,quote_document_id,operation_request_id,recipient_email,document_sha256,prepared_evidence_json,delivery_state FROM v2_sales_quote_delivery_attempts WHERE organization_id=$1 AND operation_request_id=$2 FOR UPDATE", [context.organizationId, reservation.request.id]);
      let attemptId = existing.rows[0]?.id;
      let persistedEvidence = preparedEvidence;
      if (attemptId) {
        if (existing.rows[0]!.delivery_state !== "failed") throw new V2ApplicationError("CONFLICT", "This Quote delivery request cannot be retried from its current attempt state.");
        const priorEvidence = loadPreparedQuoteDeliveryEvidenceFromAttempt(existing.rows[0]!);
        if (!priorEvidence || !canRetryPreparedQuoteDeliveryAttempt(existing.rows[0]!, preparedEvidence))
          throw new V2ApplicationError("CONFLICT", "The failed Quote request cannot retry with different or unavailable prepared evidence.");
        const retried = await client.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='pending',failure_message=NULL,completed_at=NULL,attempted_at=now() WHERE organization_id=$1 AND id=$2 AND quote_document_id=$3 AND operation_request_id=$4 AND delivery_state='failed' AND recipient_email=$5 AND document_sha256=$6 AND prepared_evidence_json=$7::jsonb", [context.organizationId, attemptId, input.quoteId, reservation.request.id, recipient, sha, preparedEvidenceJson]);
        if (retried.rowCount !== 1) throw new V2ApplicationError("CONFLICT", "The failed Quote delivery attempt could not be safely retried.");
        persistedEvidence = priorEvidence;
      } else {
        if (reservation.kind === "resumed") throw new V2ApplicationError("CONFLICT", "The failed Quote request has no prepared evidence and cannot be retried safely.");
        const inserted = await persistPreparedQuoteDeliveryAttempt(client, {
          organizationId: context.organizationId,
          quoteId: input.quoteId,
          requestId: reservation.request.id,
          recipientEmail: recipient,
          preparedEvidence,
          principalKind: context.principal.kind,
          principalSubject: principalSubject(context.principal),
          ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal)! } : {}),
        });
        attemptId = inserted.id;
        persistedEvidence = loadPreparedQuoteDeliveryEvidenceFromAttempt(inserted)!;
      }
      await client.query("COMMIT"); return { requestId: reservation.request.id, attemptId: attemptId!, recipient, document, pdf, preparedEvidence: persistedEvidence, frozenTaxComposition, integration };
    } catch (cause) { await client.query("ROLLBACK"); throw cause; } finally { client.release(); }
  }
  private async routability(organizationId: string, lines: readonly Readonly<{ productId: string; resolvedConfiguration: Readonly<{ pricingConfigurationId: string }> }>[], products: ProductsReadPort = this.products): Promise<QuoteSendReadiness["routability"]> {
    const resolved = await Promise.all(lines.map((line) => products.resolveOrderRoutability(
      brandedId<"OrganizationId">(organizationId), brandedId<"ProductId">(line.productId), line.resolvedConfiguration.pricingConfigurationId,
    )));
    const productNames = [...new Set(resolved.flatMap((result) => result.kind === "unroutable" ? [result.productName] : []))];
    return productNames.length ? { status: "unroutable", productNames } : { status: "ready" };
  }
  private async requireRoutability(organizationId: string, lines: readonly Readonly<{ productId: string; resolvedConfiguration: Readonly<{ pricingConfigurationId: string }> }>[], products: ProductsReadPort = this.products): Promise<void> {
    const readiness = await this.routability(organizationId, lines, products);
    if (readiness.status === "unroutable")
      throw new V2ApplicationError("CONFLICT", `This Quote contains a Product that is not fully configured for production routing: ${readiness.productNames?.join(", ") ?? "Product"}.`);
  }
  private async failed(org: string, requestId: string, attemptId: string, message: string): Promise<void> { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='failed',failure_message=$3,completed_at=now() WHERE organization_id=$1 AND id=$2 AND delivery_state='pending'", [org, attemptId, message]); await this.requests.markRetryableFailure(client, org, requestId); await client.query("COMMIT"); } catch { await client.query("ROLLBACK"); } finally { client.release(); } }
  private async uncertain(org: string, requestId: string, attemptId: string, message: string, providerMessageId?: string): Promise<void> { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE v2_sales_quote_delivery_attempts SET delivery_state='uncertain',failure_message=$3,provider_message_id=$4,completed_at=now() WHERE organization_id=$1 AND id=$2 AND delivery_state='pending'", [org, attemptId, message, providerMessageId ?? null]); await this.requests.markPermanentFailure(client, org, requestId); await client.query("COMMIT"); } catch { await client.query("ROLLBACK"); } finally { client.release(); } }
  private async succeeded(context: OperationContext, requestId: string, attemptId: string, quoteId: QuoteId, checkpointId: string, providerMessageId: string, recipientEmail: string, documentSha256: string, preparedEvidenceJson: string, result: QuoteOperationResult): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const linked = await client.query(
        "UPDATE v2_sales_quote_delivery_attempts SET delivery_state='succeeded',quote_checkpoint_id=$5,provider_message_id=$6,completed_at=now() WHERE organization_id=$1 AND id=$2 AND quote_document_id=$3 AND operation_request_id=$4 AND delivery_state='pending' AND recipient_email=$7 AND document_sha256=$8 AND prepared_evidence_json=$9::jsonb",
        [context.organizationId, attemptId, quoteId, requestId, checkpointId, providerMessageId, recipientEmail, documentSha256, preparedEvidenceJson],
      );
      if (linked.rowCount !== 1) throw new V2ApplicationError("CONFLICT", "Quote delivery attempt could not be linked to its exact sent checkpoint.");
      await this.requests.recordAttribution(client, { organizationId: context.organizationId, operationRequestId: requestId, operation: "sales.quote.delivery.v1", resourceType: "quote", resourceId: quoteId, principalKind: context.principal.kind, principalSubject: principalSubject(context.principal), ...(staffActorId(context.principal) ? { staffActorUserId: staffActorId(context.principal) } : {}) });
      await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,'sales.quote.delivery.v1','quote_delivered','quote',$3,$4,$5,$6,$7::jsonb)", [context.organizationId, requestId, quoteId, context.principal.kind, principalSubject(context.principal), staffActorId(context.principal) ?? null, JSON.stringify([{ kind: "quote_delivered", checkpointId, deliveryAttemptId: attemptId }])]);
      await this.requests.succeed(client, context.organizationId, requestId, { resourceType: "quote", resourceId: quoteId, resultJson: result });
      await client.query("COMMIT");
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }
  }
  private async deliver(integration: ReadyGmailIntegration, recipient: string, document: CustomerSalesDocument, pdf: Uint8Array): Promise<string> {
    const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new V2ApplicationError("RETRYABLE_FAILURE", "The platform Gmail delivery connection is unavailable.");
    const oauth = new google.auth.OAuth2(clientId, clientSecret); oauth.setCredentials({ refresh_token: integration.refreshToken });
    const gmail = google.gmail({ version: "v1", auth: oauth });
    const response = await gmail.users.messages.send({ userId: "me", requestBody: { raw: rawMessage({ from: `\"${integration.displayName}\" <${integration.sendingAddress}>`, to: recipient, subject: `Quote ${document.number} from ${document.organization.name}`, body: `Please find Quote ${document.number} attached.`, attachment: pdf, filename: customerDocumentFilename(document) }) } });
    if (!response.data.id) throw new Error("Provider did not return a message identity.");
    return response.data.id;
  }
}
