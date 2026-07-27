export type ProofWorkspaceMode = "preparing" | "active_proof" | "history_preview";

export function getCanonicalProofWorkspaceMode(activeProofId: string | null | undefined): ProofWorkspaceMode {
  return activeProofId ? "active_proof" : "preparing";
}

export function getDisplayedProofVersionId(args: {
  workspaceMode: ProofWorkspaceMode;
  activeProofId: string | null | undefined;
  selectedHistoryVersionId: string | null | undefined;
}) {
  return args.workspaceMode === "history_preview"
    ? args.selectedHistoryVersionId ?? null
    : args.workspaceMode === "active_proof"
      ? args.activeProofId ?? null
      : null;
}

export function getHistoryPreviewLabel(status: string | null | undefined) {
  const normalized = String(status || "").replace(/_/g, " ").trim();
  if (normalized === "cancelled") return "Canceled proof preview";
  if (normalized === "superseded") return "Superseded proof preview";
  return `Historical proof preview${normalized ? ` — ${normalized}` : ""}`;
}
