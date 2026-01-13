import { describe, test, expect } from "@jest/globals";
import { validateEvaluationGate } from "../../validator/validateEvalGate";

describe("pbv2/validator/validateEvalGate", () => {
  test("persist + DRAFT => ERROR", () => {
    const result = validateEvaluationGate({ status: "DRAFT" }, "persist");
    expect(result.errors.some((f) => f.code === "PBV2_E_EVAL_TREE_VERSION_STATUS_INVALID")).toBe(true);
  });

  test("preview + DRAFT => WARNING", () => {
    const result = validateEvaluationGate({ status: "DRAFT" }, "preview");
    expect(result.warnings.some((f) => f.code === "PBV2_E_EVAL_TREE_VERSION_STATUS_INVALID")).toBe(true);
  });
});
