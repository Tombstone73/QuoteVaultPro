import { jest } from "@jest/globals";

jest.mock("../db", () => ({ db: {} }));

import { shouldDeferSystemGuideForActiveProductIntake } from "../services/assistant/assistantService";

describe("active Product Intake correction routing", () => {
  const activeIntake = [{
    role: "assistant",
    structuredCards: [{ kind: "product_intake_summary", details: { sessionId: "session_1" } }],
  }] as any;

  test("defers system-guide wording to the canonical active-session correction path", () => {
    expect(shouldDeferSystemGuideForActiveProductIntake(activeIntake, "Remove the Size option group. Set the price to $2.00 per square foot with a $25.00 minimum charge. Leave production routing, sheet settings, and rotation unset.")).toBe(true);
  });

  test("keeps generic guide questions and explicit new-product requests on their normal routes", () => {
    expect(shouldDeferSystemGuideForActiveProductIntake(activeIntake, "What is production routing?")).toBe(false);
    expect(shouldDeferSystemGuideForActiveProductIntake(activeIntake, "Create a new product with $2.00 per square foot pricing.")).toBe(false);
  });
});
