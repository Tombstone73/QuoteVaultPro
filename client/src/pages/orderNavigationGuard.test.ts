import { describe, expect, it } from "@jest/globals";
import { createOrderNavigationGuard, ORDER_UNSAVED_CHANGES_MESSAGE } from "./orderNavigationGuard";

describe("createOrderNavigationGuard", () => {
  it("does not block navigation when the order is clean", () => {
    const { guard, shouldBlock } = createOrderNavigationGuard(false);
    expect(shouldBlock()).toBe(false);
    expect(guard("/dashboard")).toBe(false);
  });

  it("blocks navigation with a confirm message when the order is dirty", () => {
    const { guard, shouldBlock } = createOrderNavigationGuard(true);
    expect(shouldBlock()).toBe(true);
    expect(guard("/dashboard")).toBe(ORDER_UNSAVED_CHANGES_MESSAGE);
  });

  it("re-deriving the guard after a save (dirty -> clean) stops blocking", () => {
    // order-detail re-registers the guard whenever isDirty changes. Simulate:
    // dirty guard blocks; once the save makes isDirty false, the freshly
    // derived guard no longer blocks.
    const dirty = createOrderNavigationGuard(true);
    expect(dirty.shouldBlock()).toBe(true);

    const cleanAfterSave = createOrderNavigationGuard(false);
    expect(cleanAfterSave.shouldBlock()).toBe(false);
    expect(cleanAfterSave.guard("/dashboard")).toBe(false);
  });

  it("produces independent callbacks per derivation (no shared mutable state)", () => {
    const a = createOrderNavigationGuard(true);
    const b = createOrderNavigationGuard(false);
    expect(a.shouldBlock()).toBe(true);
    expect(b.shouldBlock()).toBe(false);
  });
});
