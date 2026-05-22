import { describe, expect, test } from "@jest/globals";
import {
  normalizePreviewError,
  buildClientPreviewError,
  buildUnexpectedPreviewError,
  categorizePreviewDetails,
  findMissingRequiredSelections,
  PBV2_PREVIEW_CLIENT_VALIDATION,
} from "../pbv2/pricing/previewError";

describe("normalizePreviewError", () => {
  test("generic invalid preview error (message only) can be expanded", () => {
    const error = normalizePreviewError({ message: "Invalid preview payload" }, 400);
    expect(error.kind).toBe("generic_error");
    expect(error.message).toBe("Invalid preview payload");
    expect(error.details).toEqual([]);
    // Banner still renders an expandable area; rawMessage is the fallback body.
    expect(error.rawMessage).toBe("Invalid preview payload");
  });

  test("structured validation details render field paths/messages", () => {
    const error = normalizePreviewError(
      {
        success: false,
        message: "Invalid preview payload",
        errorCode: "PBV2_INVALID_PREVIEW_PAYLOAD",
        details: [
          {
            path: "selections.grommets",
            message: "Required option group 'Grommets' has no selected value.",
            expected: "one selected choice",
            received: null,
          },
        ],
      },
      400,
    );
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.errorCode).toBe("PBV2_INVALID_PREVIEW_PAYLOAD");
    expect(error.details).toHaveLength(1);
    expect(error.details[0].path).toBe("selections.grommets");
    expect(error.details[0].expected).toBe("one selected choice");
    expect(error.details[0].received).toBeNull();
  });

  test("normalizes raw zod issues into details", () => {
    const error = normalizePreviewError(
      { message: "Invalid", issues: [{ path: ["width"], message: "Expected number, received string" }] },
      400,
    );
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.details[0].path).toBe("width");
  });

  test("normalizes formula error lists (code becomes the path)", () => {
    const error = normalizePreviewError(
      {
        success: false,
        message: "Formula evaluation failed",
        errors: [{ code: "PBV2_FORMULA_ERROR", message: "Unknown variable q2" }],
      },
      200,
    );
    expect(error.details[0].message).toBe("Unknown variable q2");
    expect(error.details[0].path).toBe("PBV2_FORMULA_ERROR");
  });

  test("treats 5xx without details as an unexpected error", () => {
    expect(normalizePreviewError({ message: "boom" }, 500).kind).toBe("unexpected_error");
  });
});

describe("buildClientPreviewError / buildUnexpectedPreviewError", () => {
  test("client preview error carries the client-validation code", () => {
    const error = buildClientPreviewError("Fix preview inputs before pricing.", [
      { path: "width", message: "Width must be greater than 0." },
    ]);
    expect(error.errorCode).toBe(PBV2_PREVIEW_CLIENT_VALIDATION);
    expect(error.kind).toBe("validation_error_with_details");
    expect(error.details).toHaveLength(1);
  });

  test("unexpected error has a kind but no details", () => {
    const error = buildUnexpectedPreviewError("network down");
    expect(error.kind).toBe("unexpected_error");
    expect(error.details).toEqual([]);
  });
});

describe("findMissingRequiredSelections", () => {
  const groups = [
    { groupId: "g1", groupName: "Grommets", isRequired: true, selectionKeys: ["grommets"] },
    { groupId: "g2", groupName: "Finish", isRequired: false, selectionKeys: ["finish"] },
  ];

  test("missing required option selection shows useful detail", () => {
    const details = findMissingRequiredSelections(groups, {});
    expect(details).toHaveLength(1);
    expect(details[0].message).toContain("Grommets");
    expect(details[0].message).toMatch(/no selected value/i);
    expect(details[0].path).toBe("selections.grommets");
    expect(details[0].received).toBeNull();
  });

  test("produces no detail when the required selection is present", () => {
    expect(findMissingRequiredSelections(groups, { grommets: "corners" })).toEqual([]);
  });

  test("ignores optional groups even when empty", () => {
    expect(findMissingRequiredSelections(groups, { grommets: "corners", finish: "" })).toEqual([]);
  });
});

describe("categorizePreviewDetails", () => {
  test("buckets details into the debug sub-sections", () => {
    const sections = categorizePreviewDetails([
      { path: "selections.grommets", message: "Required option group has no selected value" },
      { path: "width", message: "Width must be a positive number." },
      { path: "formulaVariables.p", message: "Missing variable p" },
      { path: "treeJson", message: "tree is malformed" },
    ]);
    expect(sections.missingSelections).toHaveLength(1);
    expect(sections.invalidNumericInputs).toHaveLength(1);
    expect(sections.missingVariables).toHaveLength(1);
    expect(sections.other).toHaveLength(1);
  });
});
