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
});
