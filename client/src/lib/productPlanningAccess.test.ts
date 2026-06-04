import { describe, expect, it } from "@jest/globals";
import { canUseProductPlanning } from "./productPlanningAccess";

describe("canUseProductPlanning", () => {
  it("rejects normal staff and customer roles", () => {
    expect(canUseProductPlanning({ role: "employee" })).toBe(false);
    expect(canUseProductPlanning({ role: "manager" })).toBe(false);
    expect(canUseProductPlanning({ role: "customer" })).toBe(false);
  });

  it("allows org admins and owners", () => {
    expect(canUseProductPlanning({ role: "admin" })).toBe(true);
    expect(canUseProductPlanning({ role: "owner" })).toBe(true);
  });

  it("allows platform developers and platform admins", () => {
    expect(canUseProductPlanning({ role: "employee", isPlatformDeveloper: true })).toBe(true);
    expect(canUseProductPlanning({ role: "employee", isPlatformAdmin: true })).toBe(true);
  });
});
