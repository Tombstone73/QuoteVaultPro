import { describe, expect, test } from "@jest/globals";
import { activeDocumentContext } from "../services/assistant/activeDocumentContext";

describe("active assistant document context", () => {
  const history = [
    { role: "user", content: "old order", attachmentIds: ["old"] },
    { role: "assistant", content: "old customer was missing" },
    { role: "user", content: "use the corrected order", attachmentIds: ["replacement"] },
    { role: "assistant", content: "replacement page two has a blue panel" },
    { role: "user", content: "clarification: pickup" },
  ];

  test("a newly uploaded replacement excludes old document conclusions", () => {
    const selected = activeDocumentContext(history.slice(0, 2), ["replacement"]);
    expect(selected.replacesPrior).toBe(true);
    expect(selected.history).toEqual([]);
    expect(selected.activeAttachmentIds).toEqual(["replacement"]);
  });

  test("follow-ups retain the replacement and its clarifications only", () => {
    const selected = activeDocumentContext(history, []);
    expect(selected.history.map((message) => message.content)).toEqual([
      "use the corrected order", "replacement page two has a blue panel", "clarification: pickup",
    ]);
    expect(selected.priorAttachmentIds).toEqual(["replacement"]);
    expect(selected.priorSourceChanged).toBe(true);
  });

  test("one source and attachments submitted together remain intact", () => {
    const selected = activeDocumentContext([
      { role: "user", content: "two files", attachmentIds: ["first", "second"] },
      { role: "assistant", content: "need customer" },
    ], []);
    expect(selected.history).toHaveLength(2);
    expect(selected.priorAttachmentIds).toEqual(["first", "second"]);
  });
});
