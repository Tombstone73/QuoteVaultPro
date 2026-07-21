import { describe, expect, test } from "@jest/globals";

import {
  choicePricingExample,
  normalizeChoiceLabels,
  normalizeChoicePricingAnswer,
  stripDefaultChoiceAnnotation,
} from "../services/productIntakeWizard/productIntakeOptionHelpers";

describe("Product Intake option pricing helpers", () => {
  test("normalizes obvious yes/no per-grommet pricing", () => {
    expect(normalizeChoicePricingAnswer(".25 per grommet", ["no", "yes"])).toBe("no=0, yes=0.25");
    expect(choicePricingExample(["no", "yes"])).toBe("no=0, yes=0.25");
  });

  test("leaves ambiguous natural language unchanged for strict validation", () => {
    expect(normalizeChoicePricingAnswer("make yes cost more", ["no", "yes"])).toBe("make yes cost more");
    expect(normalizeChoicePricingAnswer("$25 setup fee", ["matte", "gloss"])).toBe("$25 setup fee");
  });

  test("strips default annotations without changing the customer-facing label", () => {
    expect(stripDefaultChoiceAnnotation("no (default option)")).toEqual({ label: "no", isDefault: true });
    expect(stripDefaultChoiceAnnotation("yes")).toEqual({ label: "yes", isDefault: false });
    expect(normalizeChoiceLabels(["no (default option)", "yes"])).toEqual({ labels: ["no", "yes"], defaultChoice: "no" });
  });
});
