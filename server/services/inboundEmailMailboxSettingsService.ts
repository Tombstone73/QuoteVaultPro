import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  inboundEmailMailboxes,
  type InboundEmailMailbox,
} from "@shared/schema";
import type { InboundEmailMailboxView } from "@shared/inboundEmailMailboxes";

type ConnectPlanMailbox = Pick<InboundEmailMailbox, "id" | "emailAddress" | "enabled" | "isDefault" | "name">;

type ConnectGmailMailboxPlan =
  | {
      action: "update";
      mailboxId: string;
      values: {
        provider: "gmail";
        name?: string;
        emailAddress?: string;
        authJson: Record<string, unknown>;
        updatedAt: Date;
      };
    }
  | {
      action: "insert";
      values: {
        provider: "gmail";
        name: string;
        emailAddress: string;
        enabled: true;
        isDefault: boolean;
        authJson: Record<string, unknown>;
        settingsJson: Record<string, unknown>;
        createdByUserId: string | null;
      };
    };

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function redactMailbox(mailbox: InboundEmailMailbox): InboundEmailMailboxView {
  return {
    id: mailbox.id,
    provider: mailbox.provider,
    name: mailbox.name,
    emailAddress: mailbox.emailAddress,
    enabled: mailbox.enabled,
    isDefault: mailbox.isDefault,
    lastPulledAt: toIso(mailbox.lastPulledAt),
    lastPullStatus: mailbox.lastPullStatus ?? null,
    lastPullError: mailbox.lastPullError ?? null,
    createdAt: toIso(mailbox.createdAt),
    updatedAt: toIso(mailbox.updatedAt),
  };
}

export function planInboundGmailMailboxConnection(args: {
  currentMailboxes: ConnectPlanMailbox[];
  emailAddress: string;
  authJson: Record<string, unknown>;
  actorUserId?: string | null;
  reconnectMailboxId?: string | null;
  now?: Date;
}): ConnectGmailMailboxPlan {
  const emailAddress = args.emailAddress.trim().toLowerCase();
  const now = args.now ?? new Date();
  const hasDefault = args.currentMailboxes.some((mailbox) => mailbox.isDefault);

  if (args.reconnectMailboxId) {
    const existing = args.currentMailboxes.find((mailbox) => mailbox.id === args.reconnectMailboxId);
    if (!existing) {
      throw Object.assign(new Error("Inbound mailbox not found"), { statusCode: 404 });
    }

    const duplicateEmail = args.currentMailboxes.find(
      (mailbox) => mailbox.emailAddress.toLowerCase() === emailAddress && mailbox.id !== args.reconnectMailboxId,
    );
    if (duplicateEmail) {
      throw Object.assign(new Error("Another inbound mailbox is already connected for that Gmail address"), { statusCode: 409 });
    }

    return {
      action: "update",
      mailboxId: existing.id,
      values: {
        provider: "gmail",
        name: existing.name || `Gmail Inbound: ${emailAddress}`,
        emailAddress,
        authJson: args.authJson,
        updatedAt: now,
      },
    };
  }

  const existingByEmail = args.currentMailboxes.find((mailbox) => mailbox.emailAddress.toLowerCase() === emailAddress);
  if (existingByEmail) {
    return {
      action: "update",
      mailboxId: existingByEmail.id,
      values: {
        provider: "gmail",
        authJson: args.authJson,
        updatedAt: now,
      },
    };
  }

  return {
    action: "insert",
    values: {
      provider: "gmail",
      name: `Gmail Inbound: ${emailAddress}`,
      emailAddress,
      enabled: true,
      isDefault: !hasDefault,
      authJson: args.authJson,
      settingsJson: {},
      createdByUserId: args.actorUserId ?? null,
    },
  };
}

export class InboundEmailMailboxSettingsService {
  constructor(private readonly dbInstance = db) {}

  async listMailboxes(organizationId: string): Promise<InboundEmailMailboxView[]> {
    const rows = await this.dbInstance
      .select()
      .from(inboundEmailMailboxes)
      .where(eq(inboundEmailMailboxes.organizationId, organizationId))
      .orderBy(desc(inboundEmailMailboxes.isDefault), desc(inboundEmailMailboxes.createdAt));

    return rows.map(redactMailbox);
  }

  async updateMailboxEnabled(
    organizationId: string,
    mailboxId: string,
    enabled: boolean,
  ): Promise<InboundEmailMailboxView> {
    const [mailbox] = await this.dbInstance
      .update(inboundEmailMailboxes)
      .set({ enabled, updatedAt: new Date() })
      .where(and(
        eq(inboundEmailMailboxes.id, mailboxId),
        eq(inboundEmailMailboxes.organizationId, organizationId),
      ))
      .returning();

    if (!mailbox) {
      throw Object.assign(new Error("Inbound mailbox not found"), { statusCode: 404 });
    }

    return redactMailbox(mailbox);
  }

  async setDefaultMailbox(
    organizationId: string,
    mailboxId: string,
  ): Promise<InboundEmailMailboxView> {
    const [existing] = await this.dbInstance
      .select()
      .from(inboundEmailMailboxes)
      .where(and(
        eq(inboundEmailMailboxes.id, mailboxId),
        eq(inboundEmailMailboxes.organizationId, organizationId),
      ))
      .limit(1);

    if (!existing) {
      throw Object.assign(new Error("Inbound mailbox not found"), { statusCode: 404 });
    }

    const updated = await this.dbInstance.transaction(async (tx) => {
      await tx
        .update(inboundEmailMailboxes)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(inboundEmailMailboxes.organizationId, organizationId));

      const [mailbox] = await tx
        .update(inboundEmailMailboxes)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(and(
          eq(inboundEmailMailboxes.id, mailboxId),
          eq(inboundEmailMailboxes.organizationId, organizationId),
        ))
        .returning();

      return mailbox;
    });

    if (!updated) {
      throw Object.assign(new Error("Inbound mailbox not found"), { statusCode: 404 });
    }

    return redactMailbox(updated);
  }

  async deleteMailbox(organizationId: string, mailboxId: string): Promise<{ id: string }> {
    const [mailbox] = await this.dbInstance
      .delete(inboundEmailMailboxes)
      .where(and(
        eq(inboundEmailMailboxes.id, mailboxId),
        eq(inboundEmailMailboxes.organizationId, organizationId),
      ))
      .returning({ id: inboundEmailMailboxes.id });

    if (!mailbox) {
      throw Object.assign(new Error("Inbound mailbox not found"), { statusCode: 404 });
    }

    return mailbox;
  }

  async connectGmailMailbox(args: {
    organizationId: string;
    emailAddress: string;
    refreshToken: string;
    actorUserId?: string | null;
    reconnectMailboxId?: string | null;
    scopes?: string[] | string | null;
    tokenType?: string | null;
    redirectUri?: string | null;
  }): Promise<InboundEmailMailboxView> {
    const emailAddress = args.emailAddress.trim().toLowerCase();
    if (!emailAddress) {
      throw Object.assign(new Error("Gmail profile did not return an email address"), { statusCode: 400 });
    }

    const authJson = {
      refreshToken: args.refreshToken,
      scope: args.scopes ?? null,
      tokenType: args.tokenType ?? null,
      redirectUri: args.redirectUri ?? null,
      connectedEmail: emailAddress,
      connectedAt: new Date().toISOString(),
    };

    const updated = await this.dbInstance.transaction(async (tx) => {
      const currentMailboxes = await tx
        .select()
        .from(inboundEmailMailboxes)
        .where(eq(inboundEmailMailboxes.organizationId, args.organizationId));
      const plan = planInboundGmailMailboxConnection({
        currentMailboxes,
        emailAddress,
        authJson,
        actorUserId: args.actorUserId,
        reconnectMailboxId: args.reconnectMailboxId,
      });

      if (plan.action === "update") {
        const [mailbox] = await tx
          .update(inboundEmailMailboxes)
          .set(plan.values)
          .where(and(
            eq(inboundEmailMailboxes.id, plan.mailboxId),
            eq(inboundEmailMailboxes.organizationId, args.organizationId),
          ))
          .returning();

        return mailbox;
      }

      const [mailbox] = await tx
        .insert(inboundEmailMailboxes)
        .values({
          organizationId: args.organizationId,
          ...plan.values,
        })
        .returning();

      return mailbox;
    });

    if (!updated) {
      throw Object.assign(new Error("Failed to connect inbound Gmail mailbox"), { statusCode: 500 });
    }

    return redactMailbox(updated);
  }
}

export const inboundEmailMailboxSettingsService = new InboundEmailMailboxSettingsService();
