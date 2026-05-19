import { describe, expect, test } from "@jest/globals";
import { getClientBooleanOverride } from "../lib/clientBooleanOverride";

describe("order line item routing defaults", () => {
  test("omitted routing fields stay null so product/org defaults can initialize the draft", () => {
    expect(getClientBooleanOverride({}, "requiresDesign")).toBeNull();
    expect(getClientBooleanOverride({}, "requiresPrepress")).toBeNull();
  });

  test("explicit routing booleans are preserved as line item overrides", () => {
    expect(getClientBooleanOverride({ requiresDesign: true }, "requiresDesign")).toBe(true);
    expect(getClientBooleanOverride({ requiresDesign: false }, "requiresDesign")).toBe(false);
    expect(getClientBooleanOverride({ requiresPrepress: true }, "requiresPrepress")).toBe(true);
    expect(getClientBooleanOverride({ requiresPrepress: false }, "requiresPrepress")).toBe(false);
  });
});
