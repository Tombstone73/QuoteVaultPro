import { describe, test, expect } from "@jest/globals";
import { validateTreeForPublish, DEFAULT_VALIDATE_OPTS } from "../validator";

function hasSeverity(findings: Array<{ severity: string }>, severity: string) {
  return findings.some((f) => f.severity === severity);
}

describe("PBV2 publish decision (smoke)", () => {
  test("errors block publishing", () => {
    const badTree = {
      status: "DRAFT",
      rootNodeIds: [],
      nodes: [],
      edges: [],
    };

    const res = validateTreeForPublish(badTree as any, DEFAULT_VALIDATE_OPTS);
    expect(hasSeverity(res.findings, "ERROR")).toBe(true);
  });

  test("warnings require confirmation", () => {
    const warningTree = {
      status: "DRAFT",
      rootNodeIds: ["root"],
      nodes: [
        {
          id: "root",
          type: "INPUT",
          status: "ENABLED",
          key: "root",
          input: { selectionKey: "root", valueType: "BOOLEAN" },
        },
        // unreachable node should produce a warning
        {
          id: "orphan",
          type: "INPUT",
          status: "ENABLED",
          key: "orphan",
          input: { selectionKey: "orphan", valueType: "BOOLEAN" },
        },
      ],
      edges: [],
    };

    const res = validateTreeForPublish(warningTree as any, DEFAULT_VALIDATE_OPTS);
    expect(hasSeverity(res.findings, "ERROR")).toBe(false);
    expect(hasSeverity(res.findings, "WARNING")).toBe(true);
  });
});
