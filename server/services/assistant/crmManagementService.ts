import { createHash } from "node:crypto";
import { and, eq, ilike, sql } from "drizzle-orm";
import { assistantCrmIntakeSessions, auditLogs, customerContactLinks, customerContacts, customers, type AssistantCrmIntakeSessionRow } from "@shared/schema";
import { db } from "../../db";

export const crmCommandNames = ["customers.create", "customers.update_profile", "customers.update_commercial_terms", "contacts.create", "contacts.update"] as const;
export type CrmCommandName = typeof crmCommandNames[number];
type Address = { street1?: string; street2?: string; city?: string; state?: string; postalCode?: string; country?: string };
type CustomerPatch = Record<string, unknown>;
type ContactPatch = { firstName?: string; lastName?: string; title?: string | null; email?: string | null; phone?: string | null; mobile?: string | null; street1?: string | null; street2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; internalNotes?: string | null; flags?: string[] | null; isPrimary?: boolean; role?: string | null };
type Intake = { command: CrmCommandName; customer?: CustomerPatch; customerId?: string; contact?: ContactPatch; contactId?: string; initialContact?: ContactPatch; duplicateCandidates?: string[]; warnings?: string[] };

export class CrmManagementError extends Error { constructor(readonly code: string, message: string) { super(message); } }
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize = (value: string) => value.trim().toLocaleLowerCase();
const profileFields = new Set(["companyName", "customerType", "email", "phone", "website", "notes", "assignedTo", "billingStreet1", "billingStreet2", "billingCity", "billingState", "billingPostalCode", "billingCountry", "shippingStreet1", "shippingStreet2", "shippingCity", "shippingState", "shippingPostalCode", "shippingCountry"]);
const commercialFields = new Set(["pricingTier", "isTaxExempt", "taxExemptReason", "taxExemptCertificateRef", "taxRateOverride", "paymentTerms", "defaultDiscountPercent", "defaultMarkupPercent", "defaultMarginPercent", "blindShipping"]);

function assertPatch(input: Record<string, unknown>, allowed: Set<string>, label: string) {
  const keys = Object.keys(input);
  if (!keys.length || keys.some((key) => !allowed.has(key))) throw new CrmManagementError("CRM_PATCH_INVALID", `${label} contains unsupported fields.`);
}
function validateCommercial(input: Record<string, unknown>) {
  const tier = input.pricingTier;
  if (tier !== undefined && !["default", "retail", "wholesale"].includes(String(tier))) throw new CrmManagementError("PRICING_TIER_INVALID", "Pricing tier must be default, retail, or wholesale.");
  if (input.isTaxExempt === true && !String(input.taxExemptReason ?? "").trim()) throw new CrmManagementError("TAX_EXEMPT_REASON_REQUIRED", "A tax exemption reason is required.");
  const modifiers = ["defaultDiscountPercent", "defaultMarkupPercent", "defaultMarginPercent"].filter((key) => input[key] !== undefined && input[key] !== null);
  if (modifiers.length > 1) throw new CrmManagementError("COMMERCIAL_MODIFIER_CONFLICT", "Only one of discount, markup, or margin may be specified.");
  const bounds: Record<string, number> = { defaultDiscountPercent: 100, defaultMarkupPercent: 500, defaultMarginPercent: 95, taxRateOverride: .3 };
  for (const [key, max] of Object.entries(bounds)) if (input[key] !== undefined && input[key] !== null && (!Number.isFinite(Number(input[key])) || Number(input[key]) < 0 || Number(input[key]) > max)) throw new CrmManagementError("COMMERCIAL_VALUE_INVALID", `${key} is outside its allowed range.`);
}
function recordFingerprint(record: Record<string, unknown>) { return hash(record); }

/** Canonical CRM boundary. Conversation code only requests proposals; all writes
 * happen here after the execution service confirms the persisted proposal. */
export class CrmManagementService {
  async respond(input: { organizationId: string; userId: string; conversationId: string; message: string }) {
    const text = input.message.trim();
    const createCustomer = text.match(/\b(?:create|add)\s+(?:a\s+)?(?:customer|company)\s+(.+?)(?:\s+(?:as|with)\b|$)/i);
    const createContact = text.match(/\b(?:create|add)\s+(?:a\s+)?contact\s+(.+?)\s+(?:for|at)\s+(.+)$/i);
    if (createCustomer) {
      const companyName = createCustomer[1].trim();
      if (!companyName) return this.missing("Customer company name is required.");
      const customer: CustomerPatch = { companyName, pricingTier: /\bwholesale\b/i.test(text) ? "wholesale" : /\bretail\b/i.test(text) ? "retail" : "default", isTaxExempt: /\btax[ -]?exempt\b/i.test(text), paymentTerms: /\bnet\s*30\b/i.test(text) ? "net_30" : "due_on_receipt" };
      if (customer.isTaxExempt) customer.taxExemptReason = "Provided during assistant intake";
      return this.prepare({ ...input, command: "customers.create", intake: { command: "customers.create", customer } });
    }
    if (createContact) {
      const customer = await this.customerByName(input.organizationId, createContact[2]);
      const names = createContact[1].trim().split(/\s+/); if (!customer || names.length < 2) return this.missing(customer ? "Contact first and last name are required." : "A matching customer is required for the contact.");
      return this.prepare({ ...input, command: "contacts.create", intake: { command: "contacts.create", customerId: customer.id, contact: { firstName: names[0], lastName: names.slice(1).join(" "), isPrimary: /\bprimary\b/i.test(text) } } });
    }
    return { handled: false, response: "", cards: [] };
  }

  private missing(summary: string) { return { handled: true, response: summary, cards: [{ kind: "missing_information", title: "CRM information needed", summary, sourceLinks: [] }] }; }
  private async customerByName(organizationId: string, name: string) { const [row] = await db.select().from(customers).where(and(eq(customers.organizationId, organizationId), ilike(customers.companyName, name.trim()))).limit(1); return row; }
  private async prepare(input: { organizationId: string; userId: string; conversationId: string; command: CrmCommandName; intake: Intake }) {
    const duplicates = input.intake.command === "customers.create" ? await this.customerDuplicates(input.organizationId, String(input.intake.customer?.companyName ?? "")) : [];
    input.intake.duplicateCandidates = duplicates.map((row) => row.id);
    input.intake.warnings = duplicates.length ? ["Possible duplicate customer detected. Confirm only if this is a distinct account."] : [];
    const [session] = await db.insert(assistantCrmIntakeSessions).values({ organizationId: input.organizationId, userId: input.userId, conversationId: input.conversationId, commandName: input.command, customerId: input.intake.customerId ?? null, contactId: input.intake.contactId ?? null, intakeJson: input.intake, createdByUserId: input.userId }).returning();
    if (!session) throw new CrmManagementError("CRM_SESSION_CREATE_FAILED", "Unable to persist CRM proposal.");
    const proposal = await this.buildProposal(input.organizationId, session);
    await db.update(assistantCrmIntakeSessions).set({ status: "preview_ready", proposalFingerprint: proposal.proposalFingerprint, updatedAt: new Date() }).where(eq(assistantCrmIntakeSessions.id, session.id));
    const label = input.command.startsWith("customers.") ? "Customer" : "Contact";
    return { handled: true, response: `I prepared a ${label.toLowerCase()} preview. Review it and use the dedicated GO control to apply this one change.`, cards: [
      { kind: input.intake.duplicateCandidates?.length ? "crm_duplicate_warning" : "crm_proposal", title: `${label} proposal`, summary: proposal.summary, sourceLinks: proposal.sourceLinks, details: proposal },
      { kind: "action_proposal", title: `Confirm ${label.toLowerCase()} change`, summary: "This is a dedicated confirmation. Free-text GO does not execute CRM changes.", sourceLinks: [], plan: { action: input.command, crmIntakeSessionId: session.id, proposalFingerprint: proposal.proposalFingerprint } },
    ] };
  }

  private async load(organizationId: string, id: string): Promise<AssistantCrmIntakeSessionRow> { const [row] = await db.select().from(assistantCrmIntakeSessions).where(and(eq(assistantCrmIntakeSessions.id, id), eq(assistantCrmIntakeSessions.organizationId, organizationId))).limit(1); if (!row) throw new CrmManagementError("CRM_SESSION_NOT_FOUND", "CRM proposal was not found."); return row; }
  private async customerDuplicates(organizationId: string, companyName: string) { return db.select({ id: customers.id, companyName: customers.companyName }).from(customers).where(and(eq(customers.organizationId, organizationId), ilike(customers.companyName, companyName.trim()))).limit(5); }
  private async customer(organizationId: string, id: string) { const [row] = await db.select().from(customers).where(and(eq(customers.id, id), eq(customers.organizationId, organizationId))).limit(1); if (!row) throw new CrmManagementError("CUSTOMER_NOT_FOUND", "Customer not found."); return row; }
  private async contact(organizationId: string, id: string) { const [row] = await db.select().from(customerContacts).where(and(eq(customerContacts.id, id), eq(customerContacts.organizationId, organizationId))).limit(1); if (!row) throw new CrmManagementError("CONTACT_NOT_FOUND", "Customer contact not found."); return row; }

  async buildProposal(organizationId: string, session: AssistantCrmIntakeSessionRow) {
    const intake = session.intakeJson as Intake;
    const sourceLinks: { label: string; href: string }[] = [];
    let expectedFingerprint = "new"; let changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    if (intake.command === "customers.create") { assertPatch(intake.customer ?? {}, new Set(Array.from(profileFields).concat(Array.from(commercialFields))), "Customer creation"); validateCommercial(intake.customer ?? {}); changes = Object.entries(intake.customer ?? {}).map(([field, after]) => ({ field, before: null, after })); }
    else if (intake.command.startsWith("customers.")) { const customer = await this.customer(organizationId, intake.customerId ?? session.customerId ?? ""); const patch = intake.customer ?? {}; assertPatch(patch, intake.command === "customers.update_profile" ? profileFields : commercialFields, "Customer update"); if (intake.command === "customers.update_commercial_terms") validateCommercial(patch); expectedFingerprint = recordFingerprint(customer as unknown as Record<string, unknown>); sourceLinks.push({ label: `Open ${customer.companyName}`, href: `/customers/${customer.id}` }); changes = Object.entries(patch).map(([field, after]) => ({ field, before: (customer as any)[field] ?? null, after })); }
    else { const patch = intake.contact ?? {}; if (intake.command === "contacts.create") { const customer = await this.customer(organizationId, intake.customerId ?? session.customerId ?? ""); sourceLinks.push({ label: `Open ${customer.companyName}`, href: `/customers/${customer.id}` }); if (!patch.firstName || !patch.lastName) throw new CrmManagementError("CONTACT_NAME_REQUIRED", "Contact first and last name are required."); await this.assertEmailUnique(organizationId, customer.id, patch.email ?? null); changes = Object.entries(patch).map(([field, after]) => ({ field, before: null, after })); } else { const contact = await this.contact(organizationId, intake.contactId ?? session.contactId ?? ""); if (!contact.customerId) throw new CrmManagementError("CONTACT_ORPHANED", "The contact no longer belongs to a customer."); expectedFingerprint = recordFingerprint(contact as unknown as Record<string, unknown>); await this.assertEmailUnique(organizationId, contact.customerId, patch.email ?? null, contact.id); sourceLinks.push({ label: `Open contact ${contact.firstName} ${contact.lastName}`, href: `/customers/${contact.customerId}` }); changes = Object.entries(patch).map(([field, after]) => ({ field, before: (contact as any)[field] ?? null, after })); } }
    const proposalFingerprint = hash({ sessionId: session.id, command: intake.command, intake, expectedFingerprint, changes });
    return { crmIntakeSessionId: session.id, commandName: intake.command, proposalFingerprint, expectedFingerprint, changes, warnings: intake.warnings ?? [], duplicateCandidates: intake.duplicateCandidates ?? [], sourceLinks, summary: `${intake.command}: ${changes.map((change) => `${change.field} → ${String(change.after)}`).join(", ")}.`, downstreamActionsExcluded: ["quote_creation", "order_creation", "invoice_creation", "payment_processing", "production", "fulfillment"] };
  }
  private async assertEmailUnique(organizationId: string, customerId: string, email: string | null, exceptId?: string) { if (!email?.trim()) return; const rows = await db.select({ id: customerContacts.id }).from(customerContacts).where(and(eq(customerContacts.organizationId, organizationId), eq(customerContacts.customerId, customerId), ilike(customerContacts.email, email.trim()))).limit(5); if (rows.some((row) => row.id !== exceptId)) throw new CrmManagementError("CONTACT_EMAIL_DUPLICATE", "A contact with that email already exists for this customer."); }
  async revalidateProposal(input: { organizationId: string; crmIntakeSessionId: string; expectedProposalFingerprint: string }) { const session = await this.load(input.organizationId, input.crmIntakeSessionId); if (session.status !== "preview_ready") return { valid: false as const, code: "CRM_INTAKE_NOT_READY", summary: "The CRM proposal is no longer ready for confirmation." }; const proposal = await this.buildProposal(input.organizationId, session); return session.proposalFingerprint === input.expectedProposalFingerprint && proposal.proposalFingerprint === input.expectedProposalFingerprint ? { valid: true as const, proposal } : { valid: false as const, code: "CRM_PROPOSAL_STALE", summary: "The CRM record or proposal changed. Review a fresh preview." }; }
  async executeConfirmed(input: { organizationId: string; actorUserId: string; crmIntakeSessionId: string; proposalFingerprint: string }) {
    const session = await this.load(input.organizationId, input.crmIntakeSessionId); if (session.userId !== input.actorUserId) throw new CrmManagementError("CRM_SESSION_FORBIDDEN", "Only the user who prepared this CRM proposal can confirm it.");
    const intake = session.intakeJson as Intake;
    if (session.status === "created") { const id = intake.command.startsWith("contacts.") ? session.contactId : session.customerId; if (id) return { id, entityType: intake.command.startsWith("contacts.") ? "contact" : "customer", sourceLink: intake.command.startsWith("contacts.") ? `/customers/${session.customerId}` : `/customers/${id}` }; }
    const validation = await this.revalidateProposal({ organizationId: input.organizationId, crmIntakeSessionId: session.id, expectedProposalFingerprint: input.proposalFingerprint }); if (!validation.valid) throw new CrmManagementError(validation.code, validation.summary);
    return db.transaction(async (tx) => {
      let customerId = session.customerId; let contactId = session.contactId; const patch = intake.customer ?? {};
      if (intake.command === "customers.create") { await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.organizationId}:customer:${normalize(String(patch.companyName))}`}))`); const dupes = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.organizationId, input.organizationId), ilike(customers.companyName, String(patch.companyName)))).limit(1); if (dupes[0]) throw new CrmManagementError("CUSTOMER_DUPLICATE", "A customer with that company name already exists."); const [customer] = await tx.insert(customers).values({ organizationId: input.organizationId, ...(patch as any), taxRateOverride: patch.taxRateOverride != null ? String(patch.taxRateOverride) : null, defaultDiscountPercent: patch.defaultDiscountPercent != null ? String(patch.defaultDiscountPercent) : null, defaultMarkupPercent: patch.defaultMarkupPercent != null ? String(patch.defaultMarkupPercent) : null, defaultMarginPercent: patch.defaultMarginPercent != null ? String(patch.defaultMarginPercent) : null }).returning(); customerId = customer.id; if (intake.initialContact) contactId = await this.createContactTx(tx, input.organizationId, customerId, intake.initialContact); }
      else if (intake.command.startsWith("customers.")) { await tx.update(customers).set({ ...(patch as any), updatedAt: new Date() }).where(and(eq(customers.id, customerId!), eq(customers.organizationId, input.organizationId))); }
      else if (intake.command === "contacts.create") contactId = await this.createContactTx(tx, input.organizationId, customerId!, intake.contact!);
      else { const contactPatch = intake.contact!; const { isPrimary, role, ...fields } = contactPatch; await tx.update(customerContacts).set({ ...(fields as any), updatedAt: new Date() }).where(and(eq(customerContacts.id, contactId!), eq(customerContacts.organizationId, input.organizationId))); if (isPrimary !== undefined || role !== undefined) await this.updateContactLinkTx(tx, input.organizationId, customerId!, contactId!, isPrimary, role); }
      await tx.update(assistantCrmIntakeSessions).set({ status: "created", customerId: customerId ?? null, contactId: contactId ?? null, updatedAt: new Date() }).where(eq(assistantCrmIntakeSessions.id, session.id));
      const entityType = intake.command.startsWith("contacts.") ? "customer_contact" : "customer"; const entityId = intake.command.startsWith("contacts.") ? contactId! : customerId!;
      await tx.insert(auditLogs).values({ organizationId: input.organizationId, userId: input.actorUserId, entityType, entityId, actionType: `assistant_${intake.command.replace(".", "_")}`, description: `Assistant confirmed ${intake.command} from CRM proposal ${session.id}.`, newValues: { assistantCrmIntakeSessionId: session.id, command: intake.command } });
      return { id: entityId, entityType: intake.command.startsWith("contacts.") ? "contact" : "customer", sourceLink: intake.command.startsWith("contacts.") ? `/customers/${customerId}` : `/customers/${customerId}` };
    });
  }
  private async createContactTx(tx: any, organizationId: string, customerId: string, contact: ContactPatch) { if (contact.email?.trim()) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${organizationId}:contact:${customerId}:${normalize(contact.email)}`}))`); await this.assertEmailUnique(organizationId, customerId, contact.email ?? null); if (contact.isPrimary) await tx.update(customerContactLinks).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active"))); const { isPrimary, role, ...personFields } = contact; const [created] = await tx.insert(customerContacts).values({ organizationId, customerId, ...(personFields as any), isPrimary: false, status: "active" }).returning(); await tx.insert(customerContactLinks).values({ organizationId, customerId, contactId: created.id, status: "active", isPrimary: isPrimary === true, role: role ?? null }); return created.id; }
  private async updateContactLinkTx(tx: any, organizationId: string, customerId: string, contactId: string, isPrimary?: boolean, role?: string | null) { if (isPrimary) await tx.update(customerContactLinks).set({ isPrimary: false, updatedAt: new Date() }).where(and(eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.status, "active"), sql`${customerContactLinks.contactId} <> ${contactId}`)); await tx.update(customerContactLinks).set({ ...(isPrimary === undefined ? {} : { isPrimary }), ...(role === undefined ? {} : { role }), updatedAt: new Date() }).where(and(eq(customerContactLinks.organizationId, organizationId), eq(customerContactLinks.customerId, customerId), eq(customerContactLinks.contactId, contactId), eq(customerContactLinks.status, "active"))); }
}
export const crmManagementService = new CrmManagementService();
