import { z } from "zod";

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
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const inboundEmailMailboxListResponseSchema = z.object({
  mailboxes: z.array(inboundEmailMailboxViewSchema),
});

export type InboundEmailMailboxView = z.infer<typeof inboundEmailMailboxViewSchema>;
export type InboundEmailMailboxListResponse = z.infer<typeof inboundEmailMailboxListResponseSchema>;
