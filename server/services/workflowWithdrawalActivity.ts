/** Classifies saved evidence; unknown activity is reviewed rather than silently retired. */
export function classifyPrepressWithdrawalActivity(input: {
  job: { status: string; startedAt?: Date | null; totalSeconds?: number | null };
  sessions: Array<{ status: string; notesText?: string | null; issueFlag?: boolean | null; issueType?: string | null }>;
  hasStageFiles: boolean;
  hasMaterialActivity: boolean;
  events: Array<{ type: string; payload?: Record<string, unknown> | null }>;
}): string[] {
  const reasons: string[] = [];
  const status = String(input.job.status || "").toLowerCase();
  if (input.job.startedAt || Number(input.job.totalSeconds || 0) > 0 || !["queued", "pending", "new"].includes(status)) reasons.push("Production job has recorded activity");
  if (input.sessions.some(session => session.status === "complete" || Boolean(session.notesText?.trim()) || session.issueFlag || Boolean(session.issueType?.trim()))) reasons.push("Prepress session contains work or notes");
  if (input.hasStageFiles) reasons.push("Prepress files exist");
  if (input.hasMaterialActivity) reasons.push("Material activity exists");
  if (input.events.some(event => {
    const type = String(event.type || "").toLowerCase();
    const kind = String(event.payload?.eventType || "");
    return type !== "intake" && !(type === "note" && ["workflow_transition", "workflow_reconciled"].includes(kind));
  })) reasons.push("Prepress activity history requires review");
  return reasons;
}