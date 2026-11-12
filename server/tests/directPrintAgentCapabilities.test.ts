import { describe, expect, test } from "@jest/globals";
import { isNumericAgentVersion, MINIMUM_PRODUCTION_LABEL_AGENT_VERSION, MINIMUM_QUICK_NOTE_AGENT_VERSION, supportsProfileTestAgent, supportedAgentDocumentTypes, supportsQuickNoteAgent } from "../lib/directPrintAgentCapabilities";

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

  test('does not offer profile test jobs to older installed agents', () => {
    expect(supportsProfileTestAgent('1.0.26')).toBe(false);
    expect(supportedAgentDocumentTypes('1.0.26')).not.toContain('profile_test');
    expect(supportsProfileTestAgent('1.0.27')).toBe(true);
    expect(supportedAgentDocumentTypes('1.0.27')).toContain('profile_test');
  });
});

test("production labels require the agent build that applies their configured page dimensions", () => {
  expect(MINIMUM_PRODUCTION_LABEL_AGENT_VERSION).toBe("1.0.32");
  expect(supportedAgentDocumentTypes("1.0.31")).not.toContain("production_item_label");
  expect(supportedAgentDocumentTypes("1.0.32")).toEqual(expect.arrayContaining(["production_item_label", "traveler", "ups_label"]));
});
