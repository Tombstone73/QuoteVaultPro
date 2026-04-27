import { z } from "zod";

export const designNoteKindSchema = z.enum(["internal_note", "progress_update", "blocker_update"]);

export type DesignWorkspaceAuditRow = {
  id: string;
  createdAt: Date;
  actionType: string;
  entityType: string;
  description: string;
  userName: string | null;
  newValues: any;
};

export type DesignWorkspaceState = {
  effectiveState: string;
  session: {
    status: "idle" | "active" | "paused";
    startedAt: string | null;
    activeStartedAt: string | null;
    pausedAt: string | null;
    elapsedMs: number;
  };
  totalTrackedMs: number;
  rawTrackedMs: number;
  totalAdjustmentMs: number;
  notes: Array<{
    id: string;
    at: string;
    userName: string | null;
    noteKind: z.infer<typeof designNoteKindSchema>;
    noteText: string;
  }>;
  adjustments: Array<{
    id: string;
    at: string;
    userName: string | null;
    reason: string;
    beforeMs: number;
    afterMs: number;
    deltaMs: number;
  }>;
  activity: Array<{
    id: string;
    at: string;
    type: "session" | "note" | "adjustment" | "audit";
    label: string;
    detail: string;
    userName: string | null;
  }>;
};

export function buildDesignWorkspaceState(args: {
  lineItem: {
    workflowState: string | null;
    designStatus: string | null;
  } | null;
  auditRows: DesignWorkspaceAuditRow[];
}): DesignWorkspaceState {
  const { lineItem, auditRows } = args;
  const nowMs = Date.now();
  let sessionStartedAt: string | null = null;
  let activeStartedAt: string | null = null;
  let pausedAt: string | null = null;
  let rawTrackedMs = 0;
  let totalAdjustmentMs = 0;
  let sessionStatus: "idle" | "active" | "paused" = "idle";

  const noteEntries: DesignWorkspaceState["notes"] = [];
  const adjustmentEntries: DesignWorkspaceState["adjustments"] = [];
  const activity: DesignWorkspaceState["activity"] = [];

  for (const row of auditRows) {
    const atMs = new Date(row.createdAt).getTime();
    const atIso = row.createdAt.toISOString();

    if (row.actionType === "design_session_started") {
      sessionStartedAt = atIso;
      activeStartedAt = atIso;
      pausedAt = null;
      sessionStatus = "active";
      activity.push({
        id: row.id,
        at: atIso,
        type: "session",
        label: "Design session started",
        detail: row.description,
        userName: row.userName,
      });
      continue;
    }

    if (row.actionType === "design_session_resumed") {
      if (!sessionStartedAt) {
        sessionStartedAt = atIso;
      }
      activeStartedAt = atIso;
      pausedAt = null;
      sessionStatus = "active";
      activity.push({
        id: row.id,
        at: atIso,
        type: "session",
        label: "Design session resumed",
        detail: row.description,
        userName: row.userName,
      });
      continue;
    }

    if (row.actionType === "design_session_paused") {
      if (activeStartedAt) {
        rawTrackedMs += Math.max(0, atMs - new Date(activeStartedAt).getTime());
      }
      activeStartedAt = null;
      pausedAt = atIso;
      sessionStatus = sessionStartedAt ? "paused" : "idle";
      activity.push({
        id: row.id,
        at: atIso,
        type: "session",
        label: "Design session paused",
        detail: row.description,
        userName: row.userName,
      });
      continue;
    }

    if (row.actionType === "design_session_completed") {
      if (activeStartedAt) {
        rawTrackedMs += Math.max(0, atMs - new Date(activeStartedAt).getTime());
      }
      activeStartedAt = null;
      pausedAt = null;
      sessionStartedAt = null;
      sessionStatus = "idle";
      activity.push({
        id: row.id,
        at: atIso,
        type: "session",
        label: "Design session completed",
        detail: row.description,
        userName: row.userName,
      });
      continue;
    }

    if (row.actionType === "design_note_added") {
      const noteText = String(row.newValues?.noteText || "").trim();
      const noteKind = designNoteKindSchema.safeParse(row.newValues?.noteKind).success
        ? (row.newValues.noteKind as z.infer<typeof designNoteKindSchema>)
        : "internal_note";

      if (noteText) {
        noteEntries.push({
          id: row.id,
          at: atIso,
          userName: row.userName,
          noteKind,
          noteText,
        });
        activity.push({
          id: row.id,
          at: atIso,
          type: "note",
          label:
            noteKind === "progress_update"
              ? "Progress update"
              : noteKind === "blocker_update"
                ? "Blocker update"
                : "Internal design note",
          detail: noteText,
          userName: row.userName,
        });
      }
      continue;
    }

    if (row.actionType === "design_time_adjusted") {
      const beforeMs = Number(row.newValues?.beforeMs ?? 0);
      const afterMs = Number(row.newValues?.afterMs ?? beforeMs);
      const deltaMs = Number(row.newValues?.deltaMs ?? afterMs - beforeMs);
      const reason = String(row.newValues?.reason || "").trim() || row.description;
      totalAdjustmentMs += deltaMs;
      adjustmentEntries.push({
        id: row.id,
        at: atIso,
        userName: row.userName,
        reason,
        beforeMs,
        afterMs,
        deltaMs,
      });
      activity.push({
        id: row.id,
        at: atIso,
        type: "adjustment",
        label: "Time adjustment",
        detail: reason,
        userName: row.userName,
      });
      continue;
    }

    activity.push({
      id: row.id,
      at: atIso,
      type: "audit",
      label: row.description,
      detail: row.description,
      userName: row.userName,
    });
  }

  const rawTrackedWithLiveMs =
    sessionStatus === "active" && activeStartedAt
      ? rawTrackedMs + Math.max(0, nowMs - new Date(activeStartedAt).getTime())
      : rawTrackedMs;

  const totalTrackedMs = rawTrackedWithLiveMs + totalAdjustmentMs;
  const normalizedWorkflowState = String(lineItem?.workflowState || "").trim().toLowerCase();
  const normalizedDesignStatus = String(lineItem?.designStatus || "").trim().toLowerCase();
  const effectiveState =
    sessionStatus === "paused"
      ? "paused"
      : sessionStatus === "active"
        ? "in_design"
        : normalizedDesignStatus === "design_complete"
          ? "design_complete"
          : normalizedWorkflowState === "needs_design"
            ? "needs_design"
            : normalizedWorkflowState === "in_design"
              ? "in_design"
              : normalizedDesignStatus === "needs_design" || normalizedDesignStatus === "in_design"
                ? normalizedDesignStatus
                : "design_complete";

  return {
    effectiveState,
    session: {
      status: sessionStatus,
      startedAt: sessionStartedAt,
      activeStartedAt,
      pausedAt,
      elapsedMs: totalTrackedMs,
    },
    totalTrackedMs,
    rawTrackedMs: rawTrackedWithLiveMs,
    totalAdjustmentMs,
    notes: noteEntries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    adjustments: adjustmentEntries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    activity: activity.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()),
  };
}