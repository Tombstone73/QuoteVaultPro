import { z } from "zod";

export const inboundEmailMailboxSettingsSchema = z.object({
  lookbackDays: z.coerce.number().int().min(1).max(365).default(14),
  maxMessages: z.coerce.number().int().min(1).max(100).default(50),
  gmailQuery: z.string().trim().max(500).optional().nullable().default(null),
  labelIds: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});

export const inboundEmailMailboxViewSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  emailAddress: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  lastPulledAt: z.string().nullable(),
  lastPullStatus: z.string().nullable(),
  lastPullError: z.string().nullable(),
  settings: inboundEmailMailboxSettingsSchema.default(inboundEmailMailboxSettingsSchema.parse({})),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const inboundEmailMailboxListResponseSchema = z.object({
  mailboxes: z.array(inboundEmailMailboxViewSchema),
});

export type InboundEmailMailboxView = z.infer<typeof inboundEmailMailboxViewSchema>;
export type InboundEmailMailboxListResponse = z.infer<typeof inboundEmailMailboxListResponseSchema>;
export type InboundEmailMailboxSettings = z.infer<typeof inboundEmailMailboxSettingsSchema>;
