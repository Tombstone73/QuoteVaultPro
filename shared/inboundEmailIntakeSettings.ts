import { z } from "zod";

export const inboundEmailIntakeSettingsSchema = z.object({
  inboundEmailIntakeEnabled: z.boolean().default(true),
  inboundEmailPullPaused: z.boolean().default(false),
});

export const inboundEmailIntakeSettingsPatchSchema = z.object({
  inboundEmailIntakeEnabled: z.boolean().optional(),
  inboundEmailPullPaused: z.boolean().optional(),
}).strict();

export type InboundEmailIntakeSettings = z.infer<typeof inboundEmailIntakeSettingsSchema>;
export type InboundEmailIntakeSettingsPatch = z.infer<typeof inboundEmailIntakeSettingsPatchSchema>;

export const defaultInboundEmailIntakeSettings: InboundEmailIntakeSettings = {
  inboundEmailIntakeEnabled: true,
  inboundEmailPullPaused: false,
};

export function resolveInboundEmailIntakeSettingsFromPreferences(preferences: unknown): InboundEmailIntakeSettings {
  const raw = (preferences as any)?.inboundEmail;
  const parsed = inboundEmailIntakeSettingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  return parsed.success ? parsed.data : defaultInboundEmailIntakeSettings;
}

export function mergeInboundEmailIntakeSettingsIntoPreferences(
  preferences: unknown,
  patch: InboundEmailIntakeSettingsPatch,
): Record<string, unknown> {
  const current = preferences && typeof preferences === "object" ? { ...(preferences as Record<string, unknown>) } : {};
  const existing = resolveInboundEmailIntakeSettingsFromPreferences(current);
  return {
    ...current,
    inboundEmail: {
      ...existing,
      ...patch,
    },
  };
}
