import { eq } from "drizzle-orm";

import { db } from "../db";
import { auditLogs, organizations } from "@shared/schema";
import {
  inboundEmailIntakeSettingsPatchSchema,
  mergeInboundEmailIntakeSettingsIntoPreferences,
  resolveInboundEmailIntakeSettingsFromPreferences,
  type InboundEmailIntakeSettings,
  type InboundEmailIntakeSettingsPatch,
} from "@shared/inboundEmailIntakeSettings";

export type InboundEmailPullGuardResult =
  | { allowed: true; settings: InboundEmailIntakeSettings }
  | { allowed: false; reason: "disabled" | "paused"; message: string; settings: InboundEmailIntakeSettings };

type AuditContext = {
  userId?: string | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

function getPreferences(settings: unknown): Record<string, unknown> {
  const raw = (settings as any)?.preferences;
  return raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
}

function actorName(context: AuditContext): string | null {
  return context.userName ?? context.userId ?? null;
}

export class InboundEmailIntakeSettingsService {
  constructor(private readonly dbInstance = db) {}

  async getSettings(organizationId: string): Promise<InboundEmailIntakeSettings> {
    const [org] = await this.dbInstance
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    }

    return resolveInboundEmailIntakeSettingsFromPreferences(getPreferences(org.settings));
  }

  async updateSettings(
    organizationId: string,
    rawPatch: unknown,
    context: AuditContext = {},
  ): Promise<InboundEmailIntakeSettings> {
    const patch = inboundEmailIntakeSettingsPatchSchema.parse(rawPatch ?? {});
    const [org] = await this.dbInstance
      .select({ settings: organizations.settings, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    }

    const currentSettings = (org.settings || {}) as Record<string, unknown>;
    const currentPreferences = getPreferences(currentSettings);
    const before = resolveInboundEmailIntakeSettingsFromPreferences(currentPreferences);
    const nextPreferences = mergeInboundEmailIntakeSettingsIntoPreferences(currentPreferences, patch);
    const after = resolveInboundEmailIntakeSettingsFromPreferences(nextPreferences);

    await this.dbInstance.transaction(async (tx) => {
      await tx
        .update(organizations)
        .set({
          settings: {
            ...currentSettings,
            preferences: nextPreferences,
          } as any,
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, organizationId));

      const auditRows: Array<typeof auditLogs.$inferInsert> = [];
      if (before.inboundEmailIntakeEnabled !== after.inboundEmailIntakeEnabled) {
        auditRows.push({
          organizationId,
          userId: context.userId ?? null,
          userName: actorName(context),
          actionType: after.inboundEmailIntakeEnabled ? "inbound_email_intake.enabled" : "inbound_email_intake.disabled",
          entityType: "organization",
          entityId: organizationId,
          entityName: org.name,
          description: after.inboundEmailIntakeEnabled
            ? "Inbound email intake feature enabled"
            : "Inbound email intake feature disabled",
          oldValues: { inboundEmailIntakeEnabled: before.inboundEmailIntakeEnabled },
          newValues: { inboundEmailIntakeEnabled: after.inboundEmailIntakeEnabled },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        });
      }

      if (before.inboundEmailPullPaused !== after.inboundEmailPullPaused) {
        auditRows.push({
          organizationId,
          userId: context.userId ?? null,
          userName: actorName(context),
          actionType: after.inboundEmailPullPaused ? "inbound_email_pull.paused" : "inbound_email_pull.resumed",
          entityType: "organization",
          entityId: organizationId,
          entityName: org.name,
          description: after.inboundEmailPullPaused
            ? "Inbound email pulling paused"
            : "Inbound email pulling resumed",
          oldValues: { inboundEmailPullPaused: before.inboundEmailPullPaused },
          newValues: { inboundEmailPullPaused: after.inboundEmailPullPaused },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        });
      }

      if (auditRows.length > 0) {
        await tx.insert(auditLogs).values(auditRows);
      }
    });

    return after;
  }

  async getPullGuard(organizationId: string): Promise<InboundEmailPullGuardResult> {
    const settings = await this.getSettings(organizationId);
    if (!settings.inboundEmailIntakeEnabled) {
      return {
        allowed: false,
        reason: "disabled",
        message: "Inbound email intake is disabled for this organization.",
        settings,
      };
    }

    if (settings.inboundEmailPullPaused) {
      return {
        allowed: false,
        reason: "paused",
        message: "Inbound email pulling is paused for this organization.",
        settings,
      };
    }

    return { allowed: true, settings };
  }
}

export const inboundEmailIntakeSettingsService = new InboundEmailIntakeSettingsService();

export async function shouldRunScheduledInboundEmailPull(
  organizationId: string,
  logger: Pick<Console, "log"> = console,
): Promise<boolean> {
  const guard = await inboundEmailIntakeSettingsService.getPullGuard(organizationId);
  if (!guard.allowed) {
    logger.log("[Inbound Email Pull] Skipping scheduled pull", {
      organizationId,
      reason: guard.reason,
      inboundEmailIntakeEnabled: guard.settings.inboundEmailIntakeEnabled,
      inboundEmailPullPaused: guard.settings.inboundEmailPullPaused,
    });
    return false;
  }
  return true;
}
