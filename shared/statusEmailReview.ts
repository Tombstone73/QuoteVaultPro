import { z } from "zod";

export const statusEmailOutcomes = ["confirmed_sent", "confirmed_not_sent", "unresolved"] as const;
export type StatusEmailOutcome = typeof statusEmailOutcomes[number];
export const statusEmailOutcomeLabels: Record<StatusEmailOutcome, string> = {
  confirmed_sent: "Confirmed Sent",
  confirmed_not_sent: "Confirmed Not Sent",
  unresolved: "Unresolved",
};

export const statusEmailReviewCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("record"),
    requestId: z.string().uuid(),
    outcome: z.enum(statusEmailOutcomes),
    evidence: z.string().trim().min(1).max(2000),
    gmailMessageId: z.string().trim().min(1).max(255).optional(),
  }).strict(),
  z.object({ action: z.literal("resend"), confirmed: z.literal(true) }).strict(),
]).superRefine((command, ctx) => {
  if (command.action === "record" && command.outcome !== "confirmed_sent" && command.gmailMessageId) {
    ctx.addIssue({ code: "custom", path: ["gmailMessageId"], message: "Only Confirmed Sent can record a Gmail message ID." });
  }
});

export type StatusEmailReviewCommand = z.input<typeof statusEmailReviewCommandSchema>;
export type StatusEmailReviewEntry = {
  requestId: string;
  outcome: StatusEmailOutcome;
  evidence: string;
  gmailMessageId: string | null;
  reviewerId: string;
  reviewerName: string | null;
  reviewedAt: string;
};

export type StatusEmailReviewHistory = {
  entries: StatusEmailReviewEntry[];
  attemptUpdatedAt?: string;
  replacement?: { jobId: string; requestedAt: string; reviewerId: string; reviewerName: string | null };
};

export type StatusEmailReviewResult = {
  jobId: string;
  status: string;
  review: StatusEmailReviewHistory;
  replayed: boolean;
};
