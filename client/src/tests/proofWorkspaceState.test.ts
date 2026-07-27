import { describe, expect, test } from "@jest/globals";

import {
  getCanonicalProofWorkspaceMode,
  getDisplayedProofVersionId,
  getHistoryPreviewLabel,
} from "../lib/proofWorkspaceState";

describe("proof workspace state", () => {
  test("uses preparation rather than newest history when no active proof exists", () => {
    expect(getCanonicalProofWorkspaceMode(null)).toBe("preparing");
    expect(getDisplayedProofVersionId({ workspaceMode: "preparing", activeProofId: null, selectedHistoryVersionId: "cancelled-v2" })).toBeNull();
  });

  test("keeps explicit history selection separate from the active proof", () => {
    expect(getDisplayedProofVersionId({ workspaceMode: "history_preview", activeProofId: "active-v3", selectedHistoryVersionId: "cancelled-v2" })).toBe("cancelled-v2");
    expect(getDisplayedProofVersionId({ workspaceMode: "active_proof", activeProofId: "active-v3", selectedHistoryVersionId: "cancelled-v2" })).toBe("active-v3");
  });

  test("labels terminal history honestly", () => {
    expect(getHistoryPreviewLabel("cancelled")).toBe("Canceled proof preview");
    expect(getHistoryPreviewLabel("superseded")).toBe("Superseded proof preview");
  });
});
