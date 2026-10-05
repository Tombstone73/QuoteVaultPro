import assert from "node:assert/strict";
import { QuoteApplicationService } from "../../src/modules/sales/quoteApplication.js";
import { quoteCommercialSnapshot } from "../../src/modules/sales/contracts.js";

assert.equal(process.env.V2_VALIDATION_MODE, "deterministic");
let current: any = { quote: { organizationId: "org-a", quoteId: "quote-a", customerContact: { organizationId: "org-a", customerId: "customer-a", contactId: "contact-a" }, currency: "USD", terms: {}, lines: [], jobLabel: "Frozen first label", expiresAt: "2026-11-01T00:00:00Z",
  taxComposition: { status: "resolved", finalTotalCents: 0, taxCents: 0 }, deliveryState: "not_sent", acceptanceState: "not_accepted", lifecycleState: "open" },
  number: { kind: "quote", core: 1n, display: "QT-1" }, revision: "1", checkpoints: [] };
const checkpoints = new Map<string, any>(), requests = new Map<string, any>();
const committed = new Set<string>();
let writes = 0, checks = 0;
const equal = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };
const context = (id: string, capabilities = ["quote.view", "quote.edit", "quote.send"], organizationId = "org-a"): any => ({ organizationId, operationId: "test-operation", businessRequest: { id, payloadFingerprint: "derived" },
  principal: { kind: "staff", organizationId, userId: "staff-a", authority: { membershipId: "member-a", capabilities } } });
const tx: any = {
  customers: { validateContactReference: async (ref: any) => ref.organizationId === "org-a", getPresentationIdentity: async () => { throw new Error("Prepared send cannot reread mutable CRM"); } },
  read: async (org: string, id: string) => org === "org-a" && id === "quote-a" ? current : null,
  readCheckpoint: async (org: string, id: string, checkpoint: string) => org === "org-a" && id === "quote-a" ? checkpoints.get(checkpoint) ?? null : null,
  readPublishedCheckpoints: async (org: string, id: string) => org === "org-a" && id === "quote-a" ? [...checkpoints.values()].filter(cp => committed.has(cp.checkpointId)) : [],
  reserve: async (input: any) => { const key = `${input.operation}:${input.businessRequestId}`, prior = requests.get(key);
    if (prior) { assert.equal(prior.fingerprint, input.payloadFingerprint); return { kind: "replay", request: prior }; }
    const request = { id: key, fingerprint: input.payloadFingerprint, resultJson: null }; requests.set(key, request); return { kind: "new", request }; },
  succeed: async (_org: string, id: string, result: unknown) => { requests.get(id).resultJson = structuredClone(result); },
  audit: async () => {}, attribute: async () => {},
  update: async (input: any) => { assert.equal(input.expectedRevision, Number(current.revision)); writes++; current = { ...current, revision: String(Number(current.revision) + 1), quote: { ...current.quote, ...input, lines: input.lines } }; return true; },
  transition: async (input: any) => { assert.equal(input.expectedRevision, Number(current.revision)); writes++; checkpoints.set(input.checkpoint.checkpointId, input.checkpoint);
    current = { ...current, revision: String(Number(current.revision) + 1), quote: { ...current.quote, deliveryState: "sent" }, checkpoints: [...current.checkpoints, { checkpointId: input.checkpoint.checkpointId, kind: input.checkpoint.kind, occurredAt: input.checkpoint.occurredAt }] }; return true; },
};
const service = new QuoteApplicationService({ transaction: async action => action(tx) });
const send = async (id: string, recipientEmail: string) => {
  const prepared = { schemaVersion: 1, organizationId: "org-a", quoteId: "quote-a", expectedRevision: current.revision,
    customerContact: current.quote.customerContact, commercial: quoteCommercialSnapshot(current.quote),
    customerPresentation: { customerDisplayName: "Frozen customer", contactDisplayName: current.quote.customerContact.contactId, email: recipientEmail },
    organizationPresentation: { name: "Frozen organization" }, recipientEmail, documentSha256: `sha256:${id === "first" ? "a".repeat(64) : "b".repeat(64)}`, documentNumber: "QT-1", documentDate: "2026-10-03" };
  const result = await service.recordDelivered(context(id), { quoteId: "quote-a" as any, businessRequestId: id, expectedRevision: current.revision, deliveryAttemptId: `attempt-${id}`, providerMessageId: `provider-${id}`, preparedSnapshot: prepared as any, frozenTaxComposition: current.quote.taxComposition });
  // Inert publication port models successful finalization; actual SQL commit
  // and rollback behavior is exercised separately by L0-A-PG.
  if (result.ok) committed.add(result.value.checkpointId!);
  return result;
};
const first = await send("first", "original@example.invalid"); assert.ok(first.ok); checks++;
const sent = structuredClone(checkpoints.get(first.value.checkpointId!));
const editInput: any = { quoteId: "quote-a", businessRequestId: "internal-edit", expectedRevision: "2", patch: { jobLabel: "Internal next label", expiresAt: "2026-12-01T00:00:00Z", terms: { commercialNotes: "UNSENT_INTERNAL_NOTES" }, customerContact: { organizationId: "org-a", customerId: "customer-b", contactId: "contact-b" } } };
const edited = await service.update(context("internal-edit"), editInput); assert.ok(edited.ok); checks++;
equal(edited.value.quote.revision, "3"); equal(edited.value.quote.quote.jobLabel, "Internal next label");
equal(checkpoints.get(first.value.checkpointId!), sent);
equal(sent.sentEvidence.recipientEmail, "original@example.invalid");
equal(sent.commercial.jobLabel, "Frozen first label");
equal(sent.commercial.expiresAt, "2026-11-01T00:00:00Z");
equal(sent.sentEvidence.customerContact.customerId, "customer-a");
const writesBeforeReplay = writes;
const replay = await service.update(context("internal-edit"), editInput); equal(replay, edited); equal(writes, writesBeforeReplay);
const deniedReplay = await service.update(context("internal-edit", []), editInput); equal(deniedReplay.ok, false); equal(writes, writesBeforeReplay);
if (!deniedReplay.ok) equal(deniedReplay.error.code, "FORBIDDEN");
const wrongTenant = await service.update(context("wrong-tenant", ["quote.edit"], "org-b"), { ...editInput, businessRequestId: "wrong-tenant", expectedRevision: "3" });
equal(wrongTenant.ok, false); equal(writes, writesBeforeReplay);
const wrongReference = await service.update(context("wrong-reference"), { ...editInput, businessRequestId: "wrong-reference", expectedRevision: "3", patch: { customerContact: { organizationId: "org-b", customerId: "customer-b" } } });
equal(wrongReference.ok, false); if (!wrongReference.ok) equal(wrongReference.error.code, "WRONG_TENANT");
equal(writes, writesBeforeReplay);
const second = await send("second", "new-recipient@example.invalid"); assert.ok(second.ok); checks++;
equal(current.checkpoints.length, 2); equal(checkpoints.get(first.value.checkpointId!), sent);
const next = checkpoints.get(second.value.checkpointId!);
equal(next.sentEvidence.customerContact.contactId, "contact-b"); equal(next.sentEvidence.recipientEmail, "new-recipient@example.invalid");
equal(next.commercial.terms.commercialNotes, "UNSENT_INTERNAL_NOTES"); equal(next.organizationPresentation.name, "Frozen organization");
equal(next.commercial.expiresAt, "2026-12-01T00:00:00Z");
equal(next.sentEvidence.documentSha256, `sha256:${"b".repeat(64)}`);
const revisionBeforeStart = Number(current.revision), checkpointCountBeforeStart = current.checkpoints.length;
const reviseInput: any = { quoteId: "quote-a", businessRequestId: "explicit-revise", expectedRevision: current.revision };
const revised = await service.revise(context("explicit-revise"), reviseInput); assert.ok(revised.ok); checks++;
equal(Number(revised.value.quote.revision), revisionBeforeStart + 1); equal(current.checkpoints.length, checkpointCountBeforeStart);
equal(checkpoints.get(first.value.checkpointId!), sent); equal(checkpoints.get(second.value.checkpointId!), next);
const writesAfterRevise = writes;
equal(await service.revise(context("explicit-revise"), reviseInput), revised); equal(writes, writesAfterRevise);
equal((await service.revise(context("explicit-revise", []), reviseInput)).ok, false); equal(writes, writesAfterRevise);
const openQuote = current.quote;
current = { ...current, quote: { ...openQuote, acceptanceState: "accepted" } };
equal((await service.revise(context("accepted-revise"), { ...reviseInput, businessRequestId: "accepted-revise", expectedRevision: current.revision })).ok, false);
current = { ...current, quote: { ...openQuote, convertedOrderId: "order-existing" } };
equal((await service.revise(context("converted-revise"), { ...reviseInput, businessRequestId: "converted-revise", expectedRevision: current.revision })).ok, false);
equal(writes, writesAfterRevise); current = { ...current, quote: openQuote };
const history = await service.publicationHistory(context("history"), "quote-a" as any); assert.ok(history.ok); checks++;
equal(history.value.length, 2); equal(history.value[0], sent);
const portalContext: any = { organizationId: "org-a", operationId: "portal-read", principal: { kind: "portal", organizationId: "org-a", customerId: "customer-b" } };
equal((await service.read(portalContext, "quote-a" as any)).ok, false);
equal((await service.publicationHistory(portalContext, "quote-a" as any)).ok, false);
console.log(`L0-A-OWNER: ${checks} checks; actual Quote application edit/resend/frozen-party/history/replay/tenant paths; inert transaction port, no providers.`);
