import { and, desc, eq } from "drizzle-orm";

import { db } from "../db";
import {
  inboundEmailMailboxes,
  type InboundEmailMailbox,
} from "@shared/schema";
import type { InboundEmailMailboxView } from "@shared/inboundEmailMailboxes";

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
}

export const inboundEmailMailboxSettingsService = new InboundEmailMailboxSettingsService();
