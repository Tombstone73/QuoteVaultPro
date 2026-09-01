import type { Request } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { db } from "../db";
import { emailService } from "../emailService";
import { getPublicWebOrigin } from "../lib/appRuntimeConfig";
import { sha256Hex } from "../lib/tokenHash";
import {
  auditLogs,
  authIdentities,
  customerContacts,
  customerContactLinks,
  customerPortalAccess,
  customerPortalCompanySettings,
  customerPortalInviteTokens,
  customers,
  passwordResetTokens,
  users,
  type CustomerPortalAccessStatus,
} from "@shared/schema";

export const PORTAL_INVITE_TTL_HOURS = 72;

const VALID_TRANSITIONS: Record<CustomerPortalAccessStatus, CustomerPortalAccessStatus[]> = {
  DISABLED: ["PENDING_INVITE"],
  PENDING_INVITE: ["ACTIVE", "DISABLED"],
  ACTIVE: ["SUSPENDED", "DISABLED"],
  SUSPENDED: ["ACTIVE"],
};

export function assertCustomerPortalTransition(
  from: CustomerPortalAccessStatus,
  to: CustomerPortalAccessStatus,
): void {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw Object.assign(new Error(`Invalid portal access transition ${from} -> ${to}`), {
      status: 409,
      code: "INVALID_PORTAL_ACCESS_TRANSITION",
    });
  }
}

export function isPortalCustomerIdentity(user: unknown): boolean {
  const candidate = user as { accountType?: string; role?: string } | null | undefined;
  return candidate?.accountType === "PORTAL_CUSTOMER" || candidate?.role === "customer";
}

export function isAllowedPortalCustomerApiPath(path: string): boolean {
  if (path === "/api/portal/preview" || path.startsWith("/api/portal/preview/")) {
    return false;
  }

  return (
    path === "/api/auth/session" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/forgot-password" ||
    path === "/api/auth/reset-password" ||
    path === "/api/customer-portal/invites/preview" ||
    path === "/api/customer-portal/invites/accept" ||
    path === "/api/portal" ||
    path.startsWith("/api/portal/")
  );
}

function makeInviteToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function getPortalInviteUrl(rawToken: string): string {
  const baseUrl = getPublicWebOrigin() || "https://www.printershero.com";
  return `${baseUrl.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(rawToken)}&kind=portal`;
}

function getResetUrl(rawToken: string): string {
  const baseUrl = getPublicWebOrigin() || "https://www.printershero.com";
  return `${baseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

function getActorMeta(req?: Request) {
  return {
    ipAddress: req?.ip,
    userAgent: req?.get?.("user-agent"),
  };
}

async function writePortalAudit(input: {
  organizationId: string;
  actorUserId?: string | null;
  actionType: string;
  description: string;
  accessId?: string | null;
  customerId?: string | null;
  contactId?: string | null;
  targetUserId?: string | null;
  req?: Request;
  metadata?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    actionType: input.actionType,
    entityType: "customer_portal_access",
    entityId: input.accessId ?? null,
    description: input.description,
    newValues: {
      customerId: input.customerId ?? null,
      contactId: input.contactId ?? null,
      targetUserId: input.targetUserId ?? null,
      ...(input.metadata ?? {}),
    },
    ...getActorMeta(input.req),
  });
}

async function createInviteToken(input: {
  accessId: string;
  organizationId: string;
  actorUserId?: string | null;
}) {
  const rawToken = makeInviteToken();
  const expiresAt = new Date(Date.now() + PORTAL_INVITE_TTL_HOURS * 60 * 60 * 1000);

  await db
    .update(customerPortalInviteTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(customerPortalInviteTokens.accessId, input.accessId),
        isNull(customerPortalInviteTokens.usedAt),
        isNull(customerPortalInviteTokens.revokedAt),
      ),
    );

  const [token] = await db
    .insert(customerPortalInviteTokens)
    .values({
      accessId: input.accessId,
      organizationId: input.organizationId,
      tokenHash: sha256Hex(rawToken),
      expiresAt,
      sentAt: new Date(),
      createdByUserId: input.actorUserId ?? null,
    })
    .returning();

  return { rawToken, token };
}

async function sendPortalInviteEmail(access: typeof customerPortalAccess.$inferSelect, rawToken: string) {
  const inviteUrl = getPortalInviteUrl(rawToken);
  await emailService.sendEmail(access.organizationId, {
    to: access.email,
    subject: "Your PrintersHero customer portal invite",
    html: `
      <p>Hello${access.displayName ? ` ${access.displayName}` : ""},</p>
      <p>You have been invited to access your PrintersHero customer portal.</p>
      <p><a href="${inviteUrl}">Accept your invite and set your password</a></p>
      <p>This invite expires in ${PORTAL_INVITE_TTL_HOURS} hours and can only be used once.</p>
    `,
  });
}

async function handlePortalInviteSendFailure(input: {
  access: typeof customerPortalAccess.$inferSelect;
  actorUserId?: string | null;
  req?: Request;
  error: unknown;
}) {
  const now = new Date();
  await db
    .update(customerPortalInviteTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(customerPortalInviteTokens.accessId, input.access.id),
        isNull(customerPortalInviteTokens.usedAt),
        isNull(customerPortalInviteTokens.revokedAt),
      ),
    );

  await db
    .update(customerPortalAccess)
    .set({
      status: "DISABLED",
      disabledAt: now,
      updatedAt: now,
      updatedByUserId: input.actorUserId ?? null,
    })
    .where(eq(customerPortalAccess.id, input.access.id));

  await writePortalAudit({
    organizationId: input.access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_INVITE_SEND_FAILED",
    description: `Portal invite delivery failed for ${input.access.email}`,
    accessId: input.access.id,
    customerId: input.access.customerId,
    contactId: input.access.contactId,
    targetUserId: input.access.userId,
    req: input.req,
    metadata: {
      errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });

  throw Object.assign(new Error("Portal invite email could not be sent. Portal access was not activated."), {
    status: 502,
    code: "PORTAL_INVITE_EMAIL_FAILED",
    cause: input.error,
  });
}

export async function listCustomerPortalAccess(organizationId: string, customerId: string) {
  return db
    .select()
    .from(customerPortalAccess)
    .where(and(eq(customerPortalAccess.organizationId, organizationId), eq(customerPortalAccess.customerId, customerId)))
    .orderBy(desc(customerPortalAccess.createdAt));
}

export async function createCustomerPortalAccess(input: {
  organizationId: string;
  customerId: string;
  contactId: string;
  actorUserId?: string | null;
  accessRole?: "COMPANY_ADMIN" | "BUYER" | "BILLING" | "VIEWER";
  sendEmail?: boolean;
  req?: Request;
}) {
  const [contact] = await db
    .select({
      id: customerContacts.id,
      customerId: customerContacts.customerId,
      firstName: customerContacts.firstName,
      lastName: customerContacts.lastName,
      email: customerContacts.email,
      organizationId: customers.organizationId,
      customerName: customers.companyName,
    })
    .from(customerContacts)
    .innerJoin(customers, eq(customerContacts.customerId, customers.id))
    .where(
      and(
        eq(customerContacts.id, input.contactId),
        eq(customerContacts.customerId, input.customerId),
        eq(customers.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!contact) {
    throw Object.assign(new Error("Customer contact not found."), { status: 404, code: "CONTACT_NOT_FOUND" });
  }

  if (!contact.email) {
    throw Object.assign(new Error("Contact email is required before portal access can be created."), {
      status: 400,
      code: "CONTACT_EMAIL_REQUIRED",
    });
  }

  const displayName = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() || contact.customerName;
  const now = new Date();
  let access = (await db
    .select()
    .from(customerPortalAccess)
    .where(
      and(
        eq(customerPortalAccess.organizationId, input.organizationId),
        eq(customerPortalAccess.contactId, input.contactId),
      ),
    )
    .limit(1))[0];

  if (access) {
    // Invoice emails may safely refresh an unaccepted setup token. This keeps
    // the same access record and revokes the older one-time token.
    if (!(input.sendEmail === false && access.status === "PENDING_INVITE")) {
      assertCustomerPortalTransition(access.status as CustomerPortalAccessStatus, "PENDING_INVITE");
    }
    [access] = await db
      .update(customerPortalAccess)
      .set({
        status: "PENDING_INVITE",
        email: contact.email,
        displayName,
        accessRole: input.accessRole ?? "VIEWER",
        inviteSentAt: now,
        disabledAt: null,
        updatedAt: now,
        updatedByUserId: input.actorUserId,
      })
      .where(eq(customerPortalAccess.id, access.id))
      .returning();
  } else {
    [access] = await db
      .insert(customerPortalAccess)
      .values({
        organizationId: input.organizationId,
        customerId: input.customerId,
        contactId: input.contactId,
        status: "PENDING_INVITE",
        email: contact.email,
        displayName,
        accessRole: input.accessRole ?? "VIEWER",
        inviteSentAt: now,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      })
      .returning();
  }

  const { rawToken } = await createInviteToken({
    accessId: access.id,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
  });

  if (input.sendEmail !== false) {
    try {
      await sendPortalInviteEmail(access, rawToken);
    } catch (error) {
      await handlePortalInviteSendFailure({
        access,
        actorUserId: input.actorUserId,
        req: input.req,
        error,
      });
    }
  }

  await writePortalAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ACCESS_CREATED",
    description: `Portal access created for ${access.email}`,
    accessId: access.id,
    customerId: input.customerId,
    contactId: input.contactId,
    req: input.req,
  });
  if (input.sendEmail !== false) {
    await writePortalAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actionType: "PORTAL_INVITE_SENT",
      description: `Portal invite sent to ${access.email}`,
      accessId: access.id,
      customerId: input.customerId,
      contactId: input.contactId,
      req: input.req,
    });
  }

  return input.sendEmail === false ? { ...access, portalSetupUrl: getPortalInviteUrl(rawToken) } : access;
}

/**
 * Prepares a secure setup link for the sole emailed contact of a customer.
 * It deliberately returns null for any ambiguous contact list.
 */
export type InvoiceEmailPortalDestination = {
  kind: "active" | "setup";
  url: string;
};

export async function resolveInvoiceEmailPortalDestination(input: {
  organizationId: string;
  customerId: string;
  recipientEmail: string;
  actorUserId?: string | null;
  req?: Request;
}): Promise<InvoiceEmailPortalDestination | null> {
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (!recipientEmail) return null;

  const contacts = (await db.select({
    contactId: customerContacts.id,
    email: customerContacts.email,
    isPrimary: customerContactLinks.isPrimary,
  })
    .from(customerContactLinks)
    .innerJoin(customerContacts, eq(customerContactLinks.contactId, customerContacts.id))
    .innerJoin(customers, eq(customerContactLinks.customerId, customers.id))
    .where(and(
      eq(customerContactLinks.organizationId, input.organizationId),
      eq(customerContactLinks.customerId, input.customerId),
      eq(customers.organizationId, input.organizationId),
      ne(customerContactLinks.status, "removed"),
    ))).filter((contact) => Boolean(contact.email?.trim()));

  const matchingContacts = contacts.filter((contact) => contact.email!.trim().toLowerCase() === recipientEmail);
  // An already-active portal contact can safely receive a portal link even
  // when the customer has multiple contacts. Automatic provisioning remains
  // deliberately limited to the one unambiguous contact case below.
  if (matchingContacts.length !== 1) return null;

  const [companySetting] = await db.select({ state: customerPortalCompanySettings.state })
    .from(customerPortalCompanySettings)
    .where(and(
      eq(customerPortalCompanySettings.organizationId, input.organizationId),
      eq(customerPortalCompanySettings.customerId, input.customerId),
    ))
    .limit(1);
  if (companySetting?.state === "suspended") return null;

  const [existing] = await db.select().from(customerPortalAccess).where(and(
    eq(customerPortalAccess.organizationId, input.organizationId),
    eq(customerPortalAccess.contactId, matchingContacts[0].contactId),
  )).limit(1);
  if (existing?.status === "ACTIVE") return { kind: "active", url: getPortalLoginUrl() };
  if (existing?.status === "SUSPENDED") return null;

  if (contacts.length !== 1) return null;

  const now = new Date();
  await db.insert(customerPortalCompanySettings).values({
    organizationId: input.organizationId,
    customerId: input.customerId,
    state: "enabled",
    enabledAt: now,
    updatedByUserId: input.actorUserId ?? null,
  }).onConflictDoUpdate({
    target: [customerPortalCompanySettings.organizationId, customerPortalCompanySettings.customerId],
    set: { state: "enabled", enabledAt: now, suspendedAt: null, updatedAt: now, updatedByUserId: input.actorUserId ?? null },
  });

  const access = await createCustomerPortalAccess({
    organizationId: input.organizationId,
    customerId: input.customerId,
    contactId: matchingContacts[0].contactId,
    actorUserId: input.actorUserId,
    accessRole: matchingContacts[0].isPrimary ? "COMPANY_ADMIN" : "VIEWER",
    sendEmail: false,
    req: input.req,
  });
  const portalSetupUrl = "portalSetupUrl" in access ? access.portalSetupUrl : null;
  if (!portalSetupUrl) return null;

  await writePortalAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ACCESS_PREPARED_FROM_INVOICE",
    description: `Portal setup link prepared for invoice recipient ${access.email}`,
    accessId: access.id,
    customerId: input.customerId,
    contactId: matchingContacts[0].contactId,
    req: input.req,
  });
  return { kind: "setup", url: portalSetupUrl };
}

/**
 * Backward-compatible URL-only form for callers that do not need to choose a
 * customer-facing CTA label. New invoice email delivery uses the typed result.
 */
export async function prepareSingleContactPortalAccessForInvoice(input: {
  organizationId: string;
  customerId: string;
  recipientEmail: string;
  actorUserId?: string | null;
  req?: Request;
}): Promise<string | null> {
  return (await resolveInvoiceEmailPortalDestination(input))?.url ?? null;
}

async function getAccessForAdmin(organizationId: string, accessId: string) {
  const [access] = await db
    .select()
    .from(customerPortalAccess)
    .where(and(eq(customerPortalAccess.organizationId, organizationId), eq(customerPortalAccess.id, accessId)))
    .limit(1);

  if (!access) {
    throw Object.assign(new Error("Portal access record not found."), {
      status: 404,
      code: "PORTAL_ACCESS_NOT_FOUND",
    });
  }

  return access;
}

export async function resendCustomerPortalInvite(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  if (access.status !== "PENDING_INVITE") {
    throw Object.assign(new Error("Only pending invites can be resent."), {
      status: 409,
      code: "PORTAL_INVITE_NOT_PENDING",
    });
  }

  const { rawToken } = await createInviteToken({
    accessId: access.id,
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
  });
  const [updated] = await db
    .update(customerPortalAccess)
    .set({ inviteSentAt: new Date(), updatedAt: new Date(), updatedByUserId: input.actorUserId })
    .where(eq(customerPortalAccess.id, access.id))
    .returning();

  try {
    await sendPortalInviteEmail(updated, rawToken);
  } catch (error) {
    await handlePortalInviteSendFailure({
      access: updated,
      actorUserId: input.actorUserId,
      req: input.req,
      error,
    });
  }

  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_INVITE_SENT",
    description: `Portal invite resent to ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    req: input.req,
  });

  return updated;
}

export async function cancelCustomerPortalInvite(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  assertCustomerPortalTransition(access.status as CustomerPortalAccessStatus, "DISABLED");

  await db
    .update(customerPortalInviteTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(customerPortalInviteTokens.accessId, access.id),
        isNull(customerPortalInviteTokens.usedAt),
        isNull(customerPortalInviteTokens.revokedAt),
      ),
    );

  const [updated] = await db
    .update(customerPortalAccess)
    .set({
      status: "DISABLED",
      disabledAt: new Date(),
      updatedAt: new Date(),
      updatedByUserId: input.actorUserId,
    })
    .where(eq(customerPortalAccess.id, access.id))
    .returning();

  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_INVITE_CANCELLED",
    description: `Portal invite cancelled for ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    req: input.req,
  });
  return updated;
}

export async function suspendCustomerPortalAccess(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  assertCustomerPortalTransition(access.status as CustomerPortalAccessStatus, "SUSPENDED");
  const [updated] = await db
    .update(customerPortalAccess)
    .set({
      status: "SUSPENDED",
      suspendedAt: new Date(),
      updatedAt: new Date(),
      updatedByUserId: input.actorUserId,
    })
    .where(eq(customerPortalAccess.id, access.id))
    .returning();
  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ACCESS_SUSPENDED",
    description: `Portal access suspended for ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    targetUserId: access.userId,
    req: input.req,
  });
  return updated;
}

export async function disableCustomerPortalAccess(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  assertCustomerPortalTransition(access.status as CustomerPortalAccessStatus, "DISABLED");

  await db
    .update(customerPortalInviteTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(customerPortalInviteTokens.accessId, access.id),
        isNull(customerPortalInviteTokens.usedAt),
        isNull(customerPortalInviteTokens.revokedAt),
      ),
    );

  const [updated] = await db
    .update(customerPortalAccess)
    .set({
      status: "DISABLED",
      disabledAt: new Date(),
      updatedAt: new Date(),
      updatedByUserId: input.actorUserId,
    })
    .where(eq(customerPortalAccess.id, access.id))
    .returning();

  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ACCESS_DISABLED",
    description: `Portal access disabled for ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    targetUserId: access.userId,
    req: input.req,
  });
  return updated;
}

export async function activateCustomerPortalAccess(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  assertCustomerPortalTransition(access.status as CustomerPortalAccessStatus, "ACTIVE");
  const [updated] = await db
    .update(customerPortalAccess)
    .set({
      status: "ACTIVE",
      suspendedAt: null,
      disabledAt: null,
      updatedAt: new Date(),
      updatedByUserId: input.actorUserId,
    })
    .where(eq(customerPortalAccess.id, access.id))
    .returning();
  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_ACCESS_ACTIVATED",
    description: `Portal access activated for ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    targetUserId: access.userId,
    req: input.req,
  });
  return updated;
}

export async function resetCustomerPortalPassword(input: {
  organizationId: string;
  accessId: string;
  actorUserId: string;
  req?: Request;
}) {
  const access = await getAccessForAdmin(input.organizationId, input.accessId);
  if (!access.userId || access.status === "DISABLED" || access.status === "PENDING_INVITE") {
    throw Object.assign(new Error("Portal password reset requires an active or suspended portal user."), {
      status: 409,
      code: "PORTAL_USER_NOT_READY",
    });
  }

  const resetToken = makeInviteToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(passwordResetTokens).values({
    userId: access.userId,
    tokenHash: sha256Hex(resetToken),
    expiresAt,
  });

  await emailService.sendEmail(access.organizationId, {
    to: access.email,
    subject: "Reset your PrintersHero customer portal password",
    html: `
      <p>Hello${access.displayName ? ` ${access.displayName}` : ""},</p>
      <p>An administrator started a password reset for your customer portal account.</p>
      <p><a href="${getResetUrl(resetToken)}">Reset your password</a></p>
      <p>This link expires in 1 hour.</p>
    `,
  });

  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.actorUserId,
    actionType: "PORTAL_PASSWORD_RESET_SENT",
    description: `Portal password reset sent to ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    targetUserId: access.userId,
    req: input.req,
  });
  return { success: true };
}

export async function previewCustomerPortalInvite(rawToken: string) {
  const tokenHash = sha256Hex(rawToken);
  const [invite] = await db
    .select({
      tokenId: customerPortalInviteTokens.id,
      expiresAt: customerPortalInviteTokens.expiresAt,
      usedAt: customerPortalInviteTokens.usedAt,
      revokedAt: customerPortalInviteTokens.revokedAt,
      accessId: customerPortalAccess.id,
      status: customerPortalAccess.status,
      email: customerPortalAccess.email,
      displayName: customerPortalAccess.displayName,
      customerName: customers.companyName,
    })
    .from(customerPortalInviteTokens)
    .innerJoin(customerPortalAccess, eq(customerPortalInviteTokens.accessId, customerPortalAccess.id))
    .innerJoin(customers, eq(customerPortalAccess.customerId, customers.id))
    .where(eq(customerPortalInviteTokens.tokenHash, tokenHash))
    .limit(1);

  if (!invite || invite.revokedAt || invite.status !== "PENDING_INVITE") {
    throw Object.assign(new Error("Invite not found or is invalid."), { status: 404, code: "INVITE_INVALID" });
  }
  if (invite.usedAt) {
    throw Object.assign(new Error("This invite has already been accepted."), { status: 409, code: "INVITE_USED" });
  }
  if (new Date(invite.expiresAt) < new Date()) {
    throw Object.assign(new Error("This invite has expired."), { status: 410, code: "INVITE_EXPIRED" });
  }

  return {
    status: "valid",
    email: invite.email,
    displayName: invite.displayName,
    customerName: invite.customerName,
    expiresAt: invite.expiresAt,
  };
}

export async function acceptCustomerPortalInvite(input: {
  rawToken: string;
  password: string;
  req?: Request;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const tokenHash = sha256Hex(input.rawToken);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select({
        tokenId: customerPortalInviteTokens.id,
        expiresAt: customerPortalInviteTokens.expiresAt,
        usedAt: customerPortalInviteTokens.usedAt,
        revokedAt: customerPortalInviteTokens.revokedAt,
        accessId: customerPortalAccess.id,
        organizationId: customerPortalAccess.organizationId,
        customerId: customerPortalAccess.customerId,
        contactId: customerPortalAccess.contactId,
        userId: customerPortalAccess.userId,
        status: customerPortalAccess.status,
        email: customerPortalAccess.email,
        displayName: customerPortalAccess.displayName,
      })
      .from(customerPortalInviteTokens)
      .innerJoin(customerPortalAccess, eq(customerPortalInviteTokens.accessId, customerPortalAccess.id))
      .where(eq(customerPortalInviteTokens.tokenHash, tokenHash))
      .limit(1);

    if (!invite || invite.revokedAt || invite.status !== "PENDING_INVITE") {
      throw Object.assign(new Error("Invite not found or is invalid."), { status: 404, code: "INVITE_INVALID" });
    }
    if (invite.usedAt) {
      throw Object.assign(new Error("This invite has already been accepted."), { status: 409, code: "INVITE_USED" });
    }
    if (new Date(invite.expiresAt) < now) {
      throw Object.assign(new Error("This invite has expired."), { status: 410, code: "INVITE_EXPIRED" });
    }

    let userId = invite.userId;
    if (!userId) {
      const [existingUser] = await tx
        .select({ id: users.id, accountType: users.accountType })
        .from(users)
        .where(eq(users.email, invite.email))
        .limit(1);

      if (existingUser && existingUser.accountType !== "PORTAL_CUSTOMER") {
        throw Object.assign(new Error("This email is already used by an internal account."), {
          status: 409,
          code: "EMAIL_BELONGS_TO_INTERNAL_USER",
        });
      }

      if (existingUser) {
        const [otherActiveAccess] = await tx
          .select({ id: customerPortalAccess.id })
          .from(customerPortalAccess)
          .where(and(eq(customerPortalAccess.userId, existingUser.id), ne(customerPortalAccess.id, invite.accessId)))
          .limit(1);
        if (otherActiveAccess) {
          throw Object.assign(new Error("This portal user is already linked to another customer."), {
            status: 409,
            code: "PORTAL_USER_ALREADY_LINKED",
          });
        }
        userId = existingUser.id;
      } else {
        const [newUser] = await tx
          .insert(users)
          .values({
            email: invite.email,
            firstName: invite.displayName?.split(" ")[0] ?? null,
            lastName: invite.displayName?.split(" ").slice(1).join(" ") || null,
            accountType: "PORTAL_CUSTOMER",
            role: "customer",
            isAdmin: false,
            isPlatformAdmin: false,
          })
          .returning({ id: users.id });
        userId = newUser.id;
      }
    }

    await tx
      .insert(authIdentities)
      .values({
        userId,
        provider: "password",
        passwordHash,
        passwordSetAt: now,
      })
      .onConflictDoUpdate({
        target: [authIdentities.userId, authIdentities.provider],
        set: {
          passwordHash,
          passwordSetAt: now,
          updatedAt: now,
        },
      });

    assertCustomerPortalTransition(invite.status as CustomerPortalAccessStatus, "ACTIVE");

    const [access] = await tx
      .update(customerPortalAccess)
      .set({
        status: "ACTIVE",
        userId,
        inviteAcceptedAt: now,
        passwordSetAt: now,
        updatedAt: now,
        updatedByUserId: userId,
      })
      .where(eq(customerPortalAccess.id, invite.accessId))
      .returning();

    await tx
      .update(customerPortalInviteTokens)
      .set({ usedAt: now })
      .where(eq(customerPortalInviteTokens.id, invite.tokenId));

    return { access, userId };
  });

  await writePortalAudit({
    organizationId: result.access.organizationId,
    actorUserId: result.userId,
    actionType: "PORTAL_INVITE_ACCEPTED",
    description: `Portal invite accepted for ${result.access.email}`,
    accessId: result.access.id,
    customerId: result.access.customerId,
    contactId: result.access.contactId,
    targetUserId: result.userId,
    req: input.req,
  });
  await writePortalAudit({
    organizationId: result.access.organizationId,
    actorUserId: result.userId,
    actionType: "PORTAL_PASSWORD_SET",
    description: `Portal password set for ${result.access.email}`,
    accessId: result.access.id,
    customerId: result.access.customerId,
    contactId: result.access.contactId,
    targetUserId: result.userId,
    req: input.req,
  });

  const [fullUser] = await db.select().from(users).where(eq(users.id, result.userId)).limit(1);
  return { access: result.access, user: fullUser };
}

export async function getPortalAccessForLogin(userId: string) {
  const [access] = await db
    .select()
    .from(customerPortalAccess)
    .where(eq(customerPortalAccess.userId, userId))
    .limit(1);
  if (!access) return null;
  const [companySetting] = await db
    .select({ state: customerPortalCompanySettings.state })
    .from(customerPortalCompanySettings)
    .where(and(
      eq(customerPortalCompanySettings.organizationId, access.organizationId),
      eq(customerPortalCompanySettings.customerId, access.customerId),
    ))
    .limit(1);
  if (companySetting?.state === "suspended") return null;
  return access;
}

function getPortalLoginUrl(): string {
  const baseUrl = getPublicWebOrigin() || "https://www.printershero.com";
  return `${baseUrl.replace(/\/$/, "")}/portal`;
}

export async function recordPortalLogin(input: { userId: string; req?: Request }) {
  const access = await getPortalAccessForLogin(input.userId);
  if (!access || access.status !== "ACTIVE") return;
  await db
    .update(customerPortalAccess)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(customerPortalAccess.id, access.id));
  await writePortalAudit({
    organizationId: access.organizationId,
    actorUserId: input.userId,
    actionType: "PORTAL_LOGIN",
    description: `Portal user logged in: ${access.email}`,
    accessId: access.id,
    customerId: access.customerId,
    contactId: access.contactId,
    targetUserId: input.userId,
    req: input.req,
  });
}

export async function getActivePortalContext(userId: string) {
  const [record] = await db
    .select({
      access: customerPortalAccess,
      customer: customers,
    })
    .from(customerPortalAccess)
    .innerJoin(customers, eq(customerPortalAccess.customerId, customers.id))
    .where(and(eq(customerPortalAccess.userId, userId), eq(customerPortalAccess.status, "ACTIVE")))
    .limit(1);

  if (record) {
    const [companySetting] = await db
      .select({ state: customerPortalCompanySettings.state })
      .from(customerPortalCompanySettings)
      .where(and(
        eq(customerPortalCompanySettings.organizationId, record.access.organizationId),
        eq(customerPortalCompanySettings.customerId, record.access.customerId),
      ))
      .limit(1);
    if (companySetting?.state === "suspended") return null;
  }

  return record ?? null;
}
