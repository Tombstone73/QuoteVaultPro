import { z } from "zod";

export const inboundEmailIntentSchema = z.enum(["QUOTE_REQUEST", "ORDER_REQUEST", "UNKNOWN"]);
export type InboundEmailIntent = z.infer<typeof inboundEmailIntentSchema>;

export const inboundEmailPullSummarySchema = z.object({
  created: z.number().int().min(0),
  skippedDuplicates: z.number().int().min(0),
  ignored: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const inboundEmailPullResultSchema = z.object({
  summary: inboundEmailPullSummarySchema,
  createdRecordIds: z.array(z.string()),
  mailboxResults: z.array(z.object({
    mailboxId: z.string(),
    mailboxName: z.string(),
    provider: z.string(),
    created: z.number().int().min(0),
    skippedDuplicates: z.number().int().min(0),
    ignored: z.number().int().min(0),
    failed: z.number().int().min(0),
    error: z.string().nullable().optional(),
  })),
});

export type InboundEmailPullSummary = z.infer<typeof inboundEmailPullSummarySchema>;
export type InboundEmailPullResult = z.infer<typeof inboundEmailPullResultSchema>;
