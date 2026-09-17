import { describe, expect, test } from "@jest/globals";
import { isNumericAgentVersion, MINIMUM_QUICK_NOTE_AGENT_VERSION, supportsQuickNoteAgent } from "../lib/directPrintAgentCapabilities";

describe("Quick Note Print Agent capability", () => {
  test("accepts the minimum and newer numeric versions", () => {
    expect(MINIMUM_QUICK_NOTE_AGENT_VERSION).toBe("1.0.24");
    expect(supportsQuickNoteAgent("1.0.24")).toBe(true);
    expect(supportsQuickNoteAgent("1.1.0")).toBe(true);
  });

  test("rejects older, lexicographically misleading, missing, and malformed versions", () => {
    expect(supportsQuickNoteAgent("1.0.23")).toBe(false);
    expect(supportsQuickNoteAgent("1.0.9")).toBe(false);
    expect(supportsQuickNoteAgent(null)).toBe(false);
    expect(supportsQuickNoteAgent("latest")).toBe(false);
  });

  test("accepts only numeric versions for persisted agent identity reporting", () => {
    expect(isNumericAgentVersion("1.0.24")).toBe(true);
    expect(isNumericAgentVersion("installer-check")).toBe(false);
    expect(isNumericAgentVersion(undefined)).toBe(false);
  });
});
