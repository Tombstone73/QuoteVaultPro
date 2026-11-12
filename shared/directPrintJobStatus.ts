export type DirectPrintJobStatus = {
  id: string;
  status: string;
  documentType: string;
  copies: number;
  orderNumber: string | null;
  agentId: string;
  agentName: string | null;
  machineLabel: string | null;
  queueName: string | null;
  destinationName: string | null;
  createdAt: string;
  claimedAt: string | null;
  submittedAt: string | null;
  failedAt: string | null;
  updatedAt: string;
  lastError: string | null;
  requestedByUserId?: string | null;
  productionLabels?: ReturnType<typeof import("./productionItemLabels").summarizeProductionLabels> | null;
};

export function directPrintStatusLabel(status: string): string {
  return ({ queued: "Queued", claimed: "Claimed / preparing", rendering: "Rendering", submitted: "Submitted to Windows", failed: "Failed" } as Record<string, string>)[status] ?? "Unknown status";
}

export function directPrintRecoveryGuidance(status: string): string {
  if (status === "submitted") return "Windows submission is recorded; physical printing is not confirmed. Check the printer before a deliberate reprint.";
  if (status === "failed") return "Review the error and Windows queue before deliberately creating a new print request. This job is not retried automatically.";
  if (status === "claimed" || status === "rendering") return "Do not replay this job. It may be preparing or awaiting acknowledgement; check the agent log and Windows queue.";
  return "Awaiting the assigned agent. A queued record does not confirm physical printing.";
}
