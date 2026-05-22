import { describe, expect, it, jest } from "@jest/globals";
import {
  createNavigationGuardRegistry,
  DEFAULT_UNSAVED_CHANGES_MESSAGE,
  normalizeNavigationTarget,
} from "./navigationGuardCore";

describe("navigation guard registry", () => {
  it("allows navigation when no guards are registered", () => {
    const registry = createNavigationGuardRegistry();
    const confirm = jest.fn(() => false);

    const decision = registry.decideNavigation("/orders", confirm);

    expect(decision.allowed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("allows navigation when a registered guard is clean", () => {
    const registry = createNavigationGuardRegistry();
    const guard = jest.fn(() => "blocked");
    registry.registerGuard(guard, () => false);

    const decision = registry.decideNavigation("/orders", jest.fn(() => false));

    expect(decision.allowed).toBe(true);
    expect(guard).not.toHaveBeenCalled();
  });

  it("blocks dirty navigation before callers mutate URL or render state", () => {
    const registry = createNavigationGuardRegistry();
    const confirm = jest.fn(() => false);
    registry.registerGuard(() => "Leave without saving?", () => true);

    const decision = registry.decideNavigation("/orders", confirm);

    expect(decision).toMatchObject({
      allowed: false,
      targetPath: "/orders",
      message: "Leave without saving?",
    });
    expect(confirm).toHaveBeenCalledWith("Leave without saving?");
  });

  it("uses the default message when a dirty guard returns true", () => {
    const registry = createNavigationGuardRegistry();
    registry.registerGuard(() => true, () => true);

    const decision = registry.decideNavigation("/orders", jest.fn(() => false));

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.message).toBe(DEFAULT_UNSAVED_CHANGES_MESSAGE);
    }
  });

  it("allows navigation after dirty state becomes clean", () => {
    const registry = createNavigationGuardRegistry();
    let dirty = true;
    registry.registerGuard(() => "Leave without saving?", () => dirty);

    expect(registry.decideNavigation("/customers", jest.fn(() => false)).allowed).toBe(false);

    dirty = false;
    const decision = registry.decideNavigation("/orders", jest.fn(() => false));

    expect(decision.allowed).toBe(true);
    expect(decision.targetPath).toBe("/orders");
  });

  it("does not retain a pending target after a blocked attempt", () => {
    const registry = createNavigationGuardRegistry();
    let dirty = true;
    registry.registerGuard(() => "Leave without saving?", () => dirty);

    const blocked = registry.decideNavigation("/customers", jest.fn(() => false));
    expect(blocked.allowed).toBe(false);

    dirty = false;
    const afterSave = registry.decideNavigation("/orders", jest.fn(() => false));

    expect(afterSave.allowed).toBe(true);
    expect(afterSave.targetPath).toBe("/orders");
  });

  it("allows programmatic navigation after save clears the guard", () => {
    const registry = createNavigationGuardRegistry();
    let dirty = true;
    const unregister = registry.registerGuard(() => "Leave without saving?", () => dirty);

    dirty = false;
    unregister();

    const decision = registry.decideNavigation("/orders", jest.fn(() => false));

    expect(decision.allowed).toBe(true);
    expect(decision.activeGuardIds).toEqual([]);
  });

  it("normalizes same-origin absolute URLs without touching external URLs", () => {
    expect(normalizeNavigationTarget("https://example.test/orders?tab=open#top", "https://example.test")).toBe(
      "/orders?tab=open#top",
    );
    expect(normalizeNavigationTarget("https://other.test/orders", "https://example.test")).toBe(
      "https://other.test/orders",
    );
    expect(normalizeNavigationTarget(-1, "https://example.test")).toBe("history:-1");
  });
});
