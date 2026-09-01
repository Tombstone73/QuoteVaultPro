import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source() {
  return readFile(path.resolve(process.cwd(), "client/src/components/StateTransitionButtons.tsx"), "utf8");
}

describe("Complete Production button contract", () => {
  it("prevents duplicate clicks and refreshes the canonical Order projections", async () => {
    const button = await source();

    expect(button).toContain("disabled={disabled || isProcessing}");
    expect(button).toContain("orderDetailQueryKey(orderId)");
    expect(button).toContain("orderTimelineQueryKey(orderId)");
    expect(button).toContain("['orders', 'list']");
  });

  it("shows the backend's structured error instead of treating all conflicts as an override", async () => {
    const button = await source();

    expect(button).not.toContain("LINE_ITEMS_NOT_COMPLETE");
    expect(button).not.toContain("autoMarkRemainingDone");
  });

  it("shows actual prerequisite stages and requires explicit bypass confirmation", async () => {
    const button = await source();

    expect(button).toContain("PRODUCTION_BYPASS_CONFIRMATION_REQUIRED");
    expect(button).toContain("Production steps are incomplete");
    expect(button).toContain("bypass.stages.map");
    expect(button).toContain("Bypass & Complete Production");
    expect(button).toContain("attemptComplete({ confirmBypass: true })");
    expect(button).toContain("Cancel");
  });
});
