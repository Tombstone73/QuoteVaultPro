import { describe, expect, test } from "@jest/globals";
import { buildProofFinishingSummary } from "../services/proofingService";

describe("proof option display", () => {
  test("uses the PBV2 choice label and never exposes choice_1", () => {
    const finishing = buildProofFinishingSummary({
      lineItemId: "line-1",
      orderId: "order-1",
      orderNumber: "SO-1",
      lineItemLabel: "Vinyl",
      width: "12",
      height: "12",
      quantity: 1,
      specsJson: null,
      optionSelectionsJson: {
        schemaVersion: 2,
        selected: { weeding_taping: { value: "choice_1" } },
      },
      pbv2SnapshotJson: {
        treeJson: {
          schemaVersion: 2,
          nodes: {
            weeding: {
              id: "weeding",
              kind: "question",
              label: "Weeding and Taping",
              input: { type: "select", selectionKey: "weeding_taping" },
              choices: [
                { id: "choice_1", value: "included", label: "Included" },
              ],
            },
          },
          edges: [],
        },
      },
      selectedOptions: [],
      materialUsages: [],
      updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    });

    expect(finishing).toContain("Weeding and Taping: Included");
    expect(finishing.join(" ")).not.toContain("choice_1");
  });
});
