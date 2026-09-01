import type { Request } from "express";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  auditLogs,
  customerContactLinks,
  customerContacts,
  customerPortalAccess,
  customerPortalCompanySettings,
  customerPortalInviteTokens,
  customerPortalOnboardingBatchItems,
  customerPortalOnboardingBatches,
  customers,
  type CustomerPortalAccessStatus,
} from "@shared/schema";
import {
  createCustomerPortalAccess,
  resendCustomerPortalInvite,
  suspendCustomerPortalAccess,
} from "./customerPortalAccessService";

export type PortalAccessRole = "COMPANY_ADMIN" | "BUYER" | "BILLING" | "VIEWER";
export type PortalCompanyState = "disabled" | "enabled" | "suspended";
export type PortalContactState =
  | "not_eligible"
  | "eligible"
  | "selected"
  | "invited"
  | "active"
  | "invitation_expired"
  | "suspended"
  | "declined";
export type PortalInvitationState = "pending" | "sent" | "accepted" | "expired" | "revoked" | "failed" | null;

type CustomerLike = {
  id: string;
  companyName: string;
  status?: string | null;
};

type ContactLike = {
  id: string;
  customerId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  status?: string | null;
  flags?: unknown;
  internalNotes?: string | null;
};

type RelationshipLike = {
  customerId: string;
  contactId: string;
  status?: string | null;
  isPrimary?: boolean | null;
  isBilling?: boolean | null;
  role?: string | null;
};

type AccessLike = {
  id: string;
  customerId: string;
  contactId?: string | null;
  email: string;
  status: CustomerPortalAccessStatus;
  accessRole?: PortalAccessRole | string | null;
  inviteAcceptedAt?: Date | string | null;
};

type InviteTokenLike = {
  accessId: string;
  expiresAt: Date | string;
  usedAt?: Date | string | null;
  revokedAt?: Date | string | null;
};

type CompanySettingLike = {
  customerId: string;
  state: PortalCompanyState | string;
};

export type PortalOnboardingContact = {
  contactId: string;
  customerId: string;
  name: string;
  email: string | null;
  accessId: string | null;
  accessRole: PortalAccessRole;
  relationshipRole: string | null;
  isPrimary: boolean;
  isBilling: boolean;
  eligible: boolean;
  eligibilityReasons: string[];
  warnings: string[];
  contactPortalState: PortalContactState;
  invitationState: PortalInvitationState;
  recommended: boolean;
};

export type PortalOnboardingCompanyRow = {
  customerId: string;
  companyName: string;
  companyPortalState: PortalCompanyState;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  eligibleContactsCount: number;
  alreadyInvitedCount: number;
  activeCount: number;
  warnings: string[];
  recommendedContactId: string | null;
  rolloutStatus: "auto_eligible" | "needs_contact_review" | "invited" | "portal_active" | "missing_email";
  contacts: PortalOnboardingContact[];
};

export type PortalOnboardingAction =
  | "enable_companies"
  | "invite_selected_contacts"
  | "invite_all_eligible_contacts"
  | "resend_expired_invitations"
  | "suspend_portal_users";

export type PortalOnboardingActionInput = {
  action: PortalOnboardingAction;
  customerIds?: string[];
  contactIds?: string[];
  accessIds?: string[];
  accessRoles?: Record<string, PortalAccessRole>;
  confirmation?: string;
};

const decisionMakerRolePattern = /\b(owner|decision[-\s]?maker|principal|president|ceo|cfo|coo|director|manager)\b/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase();
  return email || null;
}

function displayName(contact: ContactLike): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.email || "Unnamed contact";
}

function flagsFromContact(contact: ContactLike): string[] {
  if (Array.isArray(contact.flags)) return contact.flags.map((flag) => String(flag).toLowerCase());
  return [];
}

function isInternalVendorEmail(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  return /\b(titan|metro|printershero|printershero)\b/i.test(domain);
}

function isPlaceholderEmail(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  const domain = email.split("@")[1] ?? "";
  return (
    /\b(fake|placeholder|unknown|test|no[-_.]?reply|noreply|none|invalid)\b/i.test(local) ||
    /^(example\.(com|net|org)|test\.(com|net|org)|invalid)$/i.test(domain)
  );
}

function baseEligibility(args: {
  company: CustomerLike;
  companyPortalState: PortalCompanyState;
  contact: ContactLike;
  relationship: RelationshipLike;
  duplicateEmail: boolean;
  incompatiblePortalIdentity: boolean;
}): { eligible: boolean; reasons: string[]; warnings: string[] } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const email = normalizeEmail(args.contact.email);
  const flags = flagsFromContact(args.contact);

  if (String(args.company.status ?? "active").toLowerCase() === "archived") reasons.push("company_archived");
  if (args.companyPortalState === "suspended") reasons.push("company_portal_suspended");
  if (String(args.contact.status ?? "active").toLowerCase() !== "active") reasons.push("contact_not_active");
  if (String(args.relationship.status ?? "active").toLowerCase() !== "active") reasons.push("relationship_not_active");
  if (!email) reasons.push("missing_email");
  if (email && !emailPattern.test(email)) reasons.push("invalid_email");
  if (email && isPlaceholderEmail(email)) reasons.push("placeholder_or_fake_email");
  if (flags.some((flag) => ["fake", "fake_email", "rejected", "migration_rejected", "quarantined", "internal_only"].includes(flag))) {
    reasons.push("flagged_email_or_contact");
  }
  if (email && isInternalVendorEmail(email)) reasons.push("internal_vendor_email");
  if (args.duplicateEmail) warnings.push("duplicate_email_in_review");
  if (args.incompatiblePortalIdentity) reasons.push("email_used_by_another_portal_identity");

  return { eligible: reasons.length === 0, reasons, warnings };
}

function defaultAccessRole(relationship: RelationshipLike, recommended: boolean): PortalAccessRole {
  if (recommended && relationship.isPrimary) return "COMPANY_ADMIN";
  if (relationship.isBilling) return "BILLING";
  if (relationship.role && /\bbuyer|purchas/i.test(relationship.role)) return "BUYER";
  return "VIEWER";
}

function latestTokenForAccess(tokens: InviteTokenLike[], accessId: string): InviteTokenLike | null {
  const active = tokens
    .filter((token) => token.accessId === accessId && !token.usedAt && !token.revokedAt)
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime());
  return active[0] ?? null;
}

function contactPortalState(access: AccessLike | null, token: InviteTokenLike | null, eligible: boolean, now: Date): PortalContactState {
  if (!access) return eligible ? "eligible" : "not_eligible";
  if (access.status === "ACTIVE") return "active";
  if (access.status === "SUSPENDED") return "suspended";
  if (access.status === "PENDING_INVITE") {
    return token && new Date(token.expiresAt).getTime() < now.getTime() ? "invitation_expired" : "invited";
  }
  return eligible ? "eligible" : "not_eligible";
}

function invitationState(access: AccessLike | null, token: InviteTokenLike | null, now: Date): PortalInvitationState {
  if (!access) return null;
  if (access.status === "ACTIVE" || access.inviteAcceptedAt) return "accepted";
  if (access.status === "PENDING_INVITE") {
    if (!token) return "pending";
    return new Date(token.expiresAt).getTime() < now.getTime() ? "expired" : "sent";
  }
  if (access.status === "DISABLED" && token?.revokedAt) return "revoked";
  return null;
}

export function buildPortalOnboardingRows(input: {
  customers: CustomerLike[];
  contacts: ContactLike[];
  relationships: RelationshipLike[];
  accesses: AccessLike[];
  inviteTokens: InviteTokenLike[];
  companySettings?: CompanySettingLike[];
  now?: Date;
}): PortalOnboardingCompanyRow[] {
  const now = input.now ?? new Date();
  const settingsByCustomer = new Map(input.companySettings?.map((setting) => [setting.customerId, String(setting.state) as PortalCompanyState]) ?? []);
  const contactsById = new Map(input.contacts.map((contact) => [contact.id, contact]));
  const accessByContact = new Map(input.accesses.filter((access) => access.contactId).map((access) => [access.contactId!, access]));
  const activeAccessByEmail = new Map<string, AccessLike[]>();
  for (const access of input.accesses) {
    const email = normalizeEmail(access.email);
    if (!email) continue;
    if (!activeAccessByEmail.has(email)) activeAccessByEmail.set(email, []);
    activeAccessByEmail.get(email)!.push(access);
  }

  const relationshipEmailCounts = new Map<string, Set<string>>();
  for (const relationship of input.relationships) {
    const contact = contactsById.get(relationship.contactId);
    const email = normalizeEmail(contact?.email);
    if (!email) continue;
    if (!relationshipEmailCounts.has(email)) relationshipEmailCounts.set(email, new Set());
    relationshipEmailCounts.get(email)!.add(relationship.customerId);
  }

  return input.customers
    .map((company) => {
      const companyRelationships = input.relationships.filter((relationship) => relationship.customerId === company.id);
      const contacts = companyRelationships
        .map((relationship) => {
          const contact = contactsById.get(relationship.contactId);
          if (!contact) return null;
          const access = accessByContact.get(contact.id) ?? null;
          const token = access ? latestTokenForAccess(input.inviteTokens, access.id) : null;
          const email = normalizeEmail(contact.email);
          const duplicateEmail = Boolean(email && (relationshipEmailCounts.get(email)?.size ?? 0) > 1);
          const incompatiblePortalIdentity = Boolean(email && (activeAccessByEmail.get(email) ?? []).some((candidate) => candidate.customerId !== company.id && candidate.contactId !== contact.id));
          const eligibility = baseEligibility({
            company,
            companyPortalState: settingsByCustomer.get(company.id) ?? "enabled",
            contact,
            relationship,
            duplicateEmail,
            incompatiblePortalIdentity,
          });
          return {
            contact,
            relationship,
            access,
            token,
            eligibility,
          };
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value));

      const eligibleCandidates = contacts.filter((entry) => entry.eligibility.eligible && entry.access?.status !== "ACTIVE");
      const recommended = eligibleCandidates.find((entry) => entry.relationship.isPrimary)
        ?? eligibleCandidates.find((entry) => Boolean(entry.relationship.role && decisionMakerRolePattern.test(entry.relationship.role)))
        ?? eligibleCandidates.find((entry) => entry.relationship.isBilling)
        ?? eligibleCandidates[0]
        ?? null;

      const mappedContacts = contacts.map((entry) => {
        const isRecommended = recommended?.contact.id === entry.contact.id;
        const state = contactPortalState(entry.access, entry.token, entry.eligibility.eligible, now);
        return {
          contactId: entry.contact.id,
          customerId: company.id,
          name: displayName(entry.contact),
          email: normalizeEmail(entry.contact.email),
          accessId: entry.access?.id ?? null,
          accessRole: (entry.access?.accessRole as PortalAccessRole | null) ?? defaultAccessRole(entry.relationship, isRecommended),
          relationshipRole: entry.relationship.role ?? null,
          isPrimary: entry.relationship.isPrimary === true,
          isBilling: entry.relationship.isBilling === true,
          eligible: entry.eligibility.eligible,
          eligibilityReasons: entry.eligibility.reasons,
          warnings: entry.eligibility.warnings,
          contactPortalState: state,
          invitationState: invitationState(entry.access, entry.token, now),
          recommended: isRecommended,
        };
      });

      const primary = mappedContacts.find((contact) => contact.isPrimary) ?? mappedContacts[0] ?? null;
      const rowWarnings = new Set<string>();
      if (mappedContacts.length === 0) rowWarnings.add("no_contacts");
      if (!mappedContacts.some((contact) => contact.eligible)) rowWarnings.add("no_eligible_contact");
      if (mappedContacts.filter((contact) => contact.eligible).length > 1) rowWarnings.add("multiple_eligible_contacts");
      for (const contact of mappedContacts) {
        contact.warnings.forEach((warning) => rowWarnings.add(warning));
      }
      const invitedCount = mappedContacts.filter((contact) => contact.contactPortalState === "invited" || contact.contactPortalState === "invitation_expired").length;
      const activeCount = mappedContacts.filter((contact) => contact.contactPortalState === "active").length;
      const emailedContacts = mappedContacts.filter((contact) => Boolean(contact.email));
      const rolloutStatus: PortalOnboardingCompanyRow["rolloutStatus"] = activeCount > 0 ? "portal_active"
        : invitedCount > 0 ? "invited"
        : emailedContacts.length === 0 ? "missing_email"
        : emailedContacts.length === 1 && emailedContacts[0].eligible ? "auto_eligible"
        : "needs_contact_review";

      return {
        customerId: company.id,
        companyName: company.companyName,
        companyPortalState: settingsByCustomer.get(company.id) ?? "enabled",
        primaryContactName: primary?.name ?? null,
        primaryContactEmail: primary?.email ?? null,
        eligibleContactsCount: mappedContacts.filter((contact) => contact.eligible).length,
        alreadyInvitedCount: invitedCount,
        activeCount,
        warnings: Array.from(rowWarnings),
        recommendedContactId: recommended?.contact.id ?? null,
        rolloutStatus,
        contacts: mappedContacts,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
}

export function filterPortalOnboardingRows(rows: PortalOnboardingCompanyRow[], filter: string, search: string): PortalOnboardingCompanyRow[] {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (query) {
      const haystack = [
        row.companyName,
        row.primaryContactName,
        row.primaryContactEmail,
        ...row.contacts.flatMap((contact) => [contact.name, contact.email]),
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filter === "no_portal_access") return row.companyPortalState === "disabled" && row.activeCount === 0 && row.alreadyInvitedCount === 0;
    if (filter === "portal_enabled") return row.companyPortalState === "enabled";
    if (filter === "no_eligible_email") return row.eligibleContactsCount === 0;
    if (filter === "multiple_contacts" || filter === "needs_contact_review") return row.rolloutStatus === "needs_contact_review";
    if (filter === "auto_eligible") return row.rolloutStatus === "auto_eligible";
    if (filter === "missing_email") return row.rolloutStatus === "missing_email";
    if (filter === "already_active") return row.activeCount > 0;
    if (filter === "invitation_pending") return row.alreadyInvitedCount > 0;
    if (filter === "invitation_failed") return row.warnings.includes("invitation_failed");
    if (filter === "skipped") return row.warnings.includes("no_eligible_contact") || row.warnings.includes("duplicate_email_in_review");
    return true;
  });
}

export async function listPortalOnboardingCompanies(organizationId: string, args: { filter?: string; search?: string } = {}) {
  const [customerRows, contactRows, relationshipRows, accessRows, tokenRows, settingRows] = await Promise.all([
    db.select({ id: customers.id, companyName: customers.companyName, status: customers.status })
      .from(customers)
      .where(and(
        eq(customers.organizationId, organizationId),
        sql`coalesce(${customers.status}, 'active') not in ('archived', 'superseded')`,
      )),
    db.select({
      id: customerContacts.id,
      customerId: customerContacts.customerId,
      firstName: customerContacts.firstName,
      lastName: customerContacts.lastName,
      email: customerContacts.email,
      status: customerContacts.status,
      flags: customerContacts.flags,
      internalNotes: customerContacts.internalNotes,
    }).from(customerContacts).where(eq(customerContacts.organizationId, organizationId)),
    db.select({
      customerId: customerContactLinks.customerId,
      contactId: customerContactLinks.contactId,
      status: customerContactLinks.status,
      isPrimary: customerContactLinks.isPrimary,
      isBilling: customerContactLinks.isBilling,
      role: customerContactLinks.role,
    }).from(customerContactLinks).where(and(eq(customerContactLinks.organizationId, organizationId), ne(customerContactLinks.status, "removed"))),
    db.select().from(customerPortalAccess).where(eq(customerPortalAccess.organizationId, organizationId)),
    db.select().from(customerPortalInviteTokens).where(and(eq(customerPortalInviteTokens.organizationId, organizationId), isNull(customerPortalInviteTokens.usedAt), isNull(customerPortalInviteTokens.revokedAt))),
    db.select().from(customerPortalCompanySettings).where(eq(customerPortalCompanySettings.organizationId, organizationId)),
  ]);

  const rows = buildPortalOnboardingRows({
    customers: customerRows,
    contacts: contactRows,
    relationships: relationshipRows,
    accesses: accessRows,
    inviteTokens: tokenRows,
    companySettings: settingRows,
  });

  return {
    rows: filterPortalOnboardingRows(rows, args.filter ?? "all", args.search ?? ""),
    summary: {
      companies: rows.length,
      noPortalAccess: rows.filter((row) => row.companyPortalState === "disabled" && row.activeCount === 0 && row.alreadyInvitedCount === 0).length,
      portalEnabled: rows.filter((row) => row.companyPortalState === "enabled").length,
      eligibleContacts: rows.reduce((sum, row) => sum + row.eligibleContactsCount, 0),
      invited: rows.reduce((sum, row) => sum + row.alreadyInvitedCount, 0),
      active: rows.reduce((sum, row) => sum + row.activeCount, 0),
      autoEligible: rows.filter((row) => row.rolloutStatus === "auto_eligible").length,
      needsContactReview: rows.filter((row) => row.rolloutStatus === "needs_contact_review").length,
      missingEmail: rows.filter((row) => row.rolloutStatus === "missing_email").length,
    },
  };
}

async function auditPortalOnboarding(input: {
  organizationId: string;
  actorUserId: string;
  actionType: string;
  description: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}) {
  await db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    actionType: input.actionType,
    entityType: "customer_portal_onboarding",
    description: input.description,
    newValues: input.metadata ?? {},
    ipAddress: input.req?.ip,
    userAgent: input.req?.get?.("user-agent"),
  });
}

export async function enablePortalForCompanies(input: {
  organizationId: string;
  customerIds: string[];
  actorUserId: string;
  req?: Request;
}) {
  const uniqueCustomerIds = Array.from(new Set(input.customerIds.filter(Boolean)));
  if (uniqueCustomerIds.length === 0) return { enabled: 0 };
  const now = new Date();
  const existingSettings = await db.select().from(customerPortalCompanySettings)
    .where(and(eq(customerPortalCompanySettings.organizationId, input.organizationId), inArray(customerPortalCompanySettings.customerId, uniqueCustomerIds)));
  const suspendedCustomerIds = new Set(existingSettings.filter((setting) => setting.state === "suspended").map((setting) => setting.customerId));
  const enableableCustomerIds = uniqueCustomerIds.filter((customerId) => !suspendedCustomerIds.has(customerId));
  for (const customerId of enableableCustomerIds) {
    await db.insert(customerPortalCompanySettings).values({
      organizationId: input.organizationId,
      customerId,
      state: "enabled",
      enabledAt: now,
      suspendedAt: null,
      updatedByUserId: input.actorUserId,
    }).onConflictDoUpdate({
      target: [customerPortalCompanySettings.organizationId, customerPortalCompanySettings.customerId],
      set: { state: "enabled", enabledAt: now, suspendedAt: null, updatedAt: now, updatedByUserId: input.actorUserId },
    });
  }
  await auditPortalOnboarding({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ONBOARDING_COMPANIES_ENABLED",
    description: `Enabled customer portal for ${enableableCustomerIds.length} companies`,
    metadata: { customerIds: enableableCustomerIds, skippedSuspendedCustomerIds: Array.from(suspendedCustomerIds) },
    req: input.req,
  });
  return { enabled: enableableCustomerIds.length, skippedSuspended: suspendedCustomerIds.size };
}

function batchCounts(items: Array<{ status: string }>) {
  return {
    pending: items.filter((item) => item.status === "pending").length,
    sent: items.filter((item) => item.status === "sent").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    accepted: items.filter((item) => item.status === "accepted").length,
  };
}

async function candidateTargets(organizationId: string, input: PortalOnboardingActionInput) {
  const preview = await listPortalOnboardingCompanies(organizationId);
  const selectedCustomers = new Set(input.customerIds ?? []);
  const selectedContacts = new Set(input.contactIds ?? []);
  const selectedAccesses = new Set(input.accessIds ?? []);
  const targets: PortalOnboardingContact[] = [];

  for (const row of preview.rows) {
    if (input.action === "invite_all_eligible_contacts" && selectedCustomers.has(row.customerId)) {
      targets.push(...row.contacts.filter((contact) => contact.eligible && contact.contactPortalState !== "active"));
    } else if (input.action === "invite_selected_contacts") {
      targets.push(...row.contacts.filter((contact) => selectedContacts.has(contact.contactId)));
    } else if (input.action === "resend_expired_invitations") {
      targets.push(...row.contacts.filter((contact) => contact.contactPortalState === "invitation_expired" && (selectedContacts.size === 0 || selectedContacts.has(contact.contactId))));
    } else if (input.action === "suspend_portal_users") {
      targets.push(...row.contacts.filter((contact) => contact.accessId && (selectedAccesses.has(contact.accessId) || selectedContacts.has(contact.contactId))));
    }
  }

  const deduped = new Map<string, PortalOnboardingContact>();
  for (const target of targets) deduped.set(target.contactId, target);
  return Array.from(deduped.values());
}

export async function runPortalOnboardingAction(input: {
  organizationId: string;
  actorUserId: string;
  actionInput: PortalOnboardingActionInput;
  req?: Request;
}) {
  if (input.actionInput.action === "enable_companies") {
    return { action: "enable_companies", ...(await enablePortalForCompanies({ organizationId: input.organizationId, customerIds: input.actionInput.customerIds ?? [], actorUserId: input.actorUserId, req: input.req })) };
  }

  const targets = await candidateTargets(input.organizationId, input.actionInput);
  const now = new Date();
  const [batch] = await db.insert(customerPortalOnboardingBatches).values({
    organizationId: input.organizationId,
    action: input.actionInput.action,
    status: "running",
    total: targets.length,
    pending: targets.length,
    initiatedByUserId: input.actorUserId,
    startedAt: now,
  }).returning();

  const itemInputs = targets.map((target) => ({
    organizationId: input.organizationId,
    batchId: batch.id,
    customerId: target.customerId,
    contactId: target.contactId,
    accessId: target.accessId,
    email: target.email,
    accessRole: input.actionInput.accessRoles?.[target.contactId] ?? target.accessRole,
    status: "pending" as const,
    metadataJson: { warnings: target.warnings, eligibilityReasons: target.eligibilityReasons },
  }));
  const items = itemInputs.length > 0 ? await db.insert(customerPortalOnboardingBatchItems).values(itemInputs).returning() : [];
  const completedItems: Array<{ id: string; status: "sent" | "failed" | "skipped" | "accepted"; accessId?: string | null; failureCode?: string | null; failureMessage?: string | null }> = [];

  for (const item of items) {
    try {
      const target = targets.find((candidate) => candidate.contactId === item.contactId);
      if (!target) throw Object.assign(new Error("Portal onboarding target disappeared."), { code: "TARGET_NOT_FOUND" });
      if (!target.eligible && input.actionInput.action !== "suspend_portal_users") {
        completedItems.push({ id: item.id, status: "skipped", failureCode: "CONTACT_NOT_ELIGIBLE", failureMessage: target.eligibilityReasons.join(", ") || "Contact is not eligible." });
        continue;
      }
      if (input.actionInput.action === "suspend_portal_users") {
        if (!target.accessId || target.contactPortalState !== "active") {
          completedItems.push({ id: item.id, status: "skipped", failureCode: "PORTAL_USER_NOT_ACTIVE", failureMessage: "Only active portal users can be suspended." });
          continue;
        }
        const access = await suspendCustomerPortalAccess({ organizationId: input.organizationId, accessId: target.accessId, actorUserId: input.actorUserId, req: input.req });
        completedItems.push({ id: item.id, status: "sent", accessId: access.id });
        continue;
      }
      if (target.contactPortalState === "active") {
        completedItems.push({ id: item.id, status: "accepted", accessId: target.accessId });
        continue;
      }
      if (target.contactPortalState === "invited") {
        completedItems.push({ id: item.id, status: "skipped", accessId: target.accessId, failureCode: "ACTIVE_INVITE_EXISTS", failureMessage: "An active invitation already exists." });
        continue;
      }
      const role = (item.accessRole as PortalAccessRole | null) ?? "VIEWER";
      const access = target.contactPortalState === "invitation_expired" && target.accessId
        ? await resendCustomerPortalInvite({ organizationId: input.organizationId, accessId: target.accessId, actorUserId: input.actorUserId, req: input.req })
        : await createCustomerPortalAccess({ organizationId: input.organizationId, customerId: target.customerId, contactId: target.contactId, actorUserId: input.actorUserId, accessRole: role, req: input.req });
      completedItems.push({ id: item.id, status: "sent", accessId: access.id });
    } catch (error: any) {
      completedItems.push({ id: item.id, status: "failed", failureCode: error?.code ?? "PORTAL_ONBOARDING_ITEM_FAILED", failureMessage: error?.message ?? "Portal onboarding item failed." });
    }
  }

  for (const result of completedItems) {
    await db.update(customerPortalOnboardingBatchItems).set({
      status: result.status,
      accessId: result.accessId ?? null,
      failureCode: result.failureCode ?? null,
      failureMessage: result.failureMessage ?? null,
      updatedAt: new Date(),
    }).where(eq(customerPortalOnboardingBatchItems.id, result.id));
  }

  const counts = batchCounts(completedItems);
  const [updatedBatch] = await db.update(customerPortalOnboardingBatches).set({
    status: counts.failed > 0 ? "completed_with_failures" : "completed",
    total: completedItems.length,
    pending: counts.pending,
    sent: counts.sent,
    failed: counts.failed,
    skipped: counts.skipped,
    accepted: counts.accepted,
    completedAt: new Date(),
    updatedAt: new Date(),
    summaryJson: counts,
  }).where(eq(customerPortalOnboardingBatches.id, batch.id)).returning();

  await auditPortalOnboarding({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ONBOARDING_BATCH_COMPLETED",
    description: `Portal onboarding batch ${updatedBatch.id} completed`,
    metadata: { batchId: updatedBatch.id, action: input.actionInput.action, counts },
    req: input.req,
  });

  return { action: input.actionInput.action, batch: updatedBatch, counts, items: completedItems };
}

export async function listPortalOnboardingBatches(organizationId: string, limit = 10) {
  return db.select().from(customerPortalOnboardingBatches)
    .where(eq(customerPortalOnboardingBatches.organizationId, organizationId))
    .orderBy(desc(customerPortalOnboardingBatches.createdAt))
    .limit(Math.max(1, Math.min(50, limit)));
}

export function portalOnboardingRowsToCsv(rows: PortalOnboardingCompanyRow[]): string {
  const header = ["company", "primary_contact", "primary_email", "eligible_contacts", "invited", "active", "company_state", "recommended_contact", "warnings"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [
    header.map(escape).join(","),
    ...rows.map((row) => [
      row.companyName,
      row.primaryContactName,
      row.primaryContactEmail,
      row.eligibleContactsCount,
      row.alreadyInvitedCount,
      row.activeCount,
      row.companyPortalState,
      row.contacts.find((contact) => contact.contactId === row.recommendedContactId)?.name ?? "",
      row.warnings.join("; "),
    ].map(escape).join(",")),
  ].join("\n");
}
