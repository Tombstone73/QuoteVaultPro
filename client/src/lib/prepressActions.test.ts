import { describe, expect, jest, test } from "@jest/globals";
import {
  canCompleteAndReleasePrepress,
  completeAndReleasePrepress,
  PrepressCompleteAndReleaseError,
} from "./prepressActions";

function jsonResponse(ok: boolean, data: Record<string, unknown>) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("Prepress complete and release action", () => {
  test("completes prepress and then releases through the existing endpoints", async () => {
    const fetchFn = jest.fn(async (url: string) => url.includes("/complete")
      ? jsonResponse(true, { success: true, data: { status: "complete" } })
      : jsonResponse(true, { success: true, data: { workflowState: "ready_for_production" } })) as unknown as typeof fetch;

    const result = await completeAndReleasePrepress({
      lineItemId: "line-1",
      sessionId: "session-1",
      hasCompletedSession: false,
    }, fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(1, "/api/prepress/session/session-1/complete", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenNthCalledWith(2, "/api/prepress/line-item/line-1/send-to-print", expect.objectContaining({ method: "POST" }));
    expect(result.skippedCompletion).toBe(false);
  });

  test("leaves the workflow completed and reports a partial failure when release fails", async () => {
    const fetchFn = jest.fn(async (url: string) => url.includes("/complete")
      ? jsonResponse(true, { success: true })
      : jsonResponse(false, { error: "Material reservation failed" })) as unknown as typeof fetch;

    await expect(completeAndReleasePrepress({
      lineItemId: "line-1",
      sessionId: "session-1",
      hasCompletedSession: false,
    }, fetchFn)).rejects.toMatchObject({
      prepressCompleted: true,
      message: expect.stringContaining("Material reservation failed"),
    } satisfies Partial<PrepressCompleteAndReleaseError>);
  });

  test("does not complete prepress twice when the session is already complete", async () => {
    const fetchFn = jest.fn(async () => jsonResponse(true, { success: true })) as unknown as typeof fetch;

    const result = await completeAndReleasePrepress({
      lineItemId: "line-1",
      sessionId: null,
      hasCompletedSession: true,
    }, fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/line-item/line-1/send-to-print", expect.any(Object));
    expect(result.skippedCompletion).toBe(true);
  });

  test("enables the combined action only for a releasable completed or completable job", () => {
    expect(canCompleteAndReleasePrepress({ canCompleteNow: true, canReleaseNow: false, releaseAllowedAfterCompletion: true })).toBe(true);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: false, canReleaseNow: true, releaseAllowedAfterCompletion: false })).toBe(true);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: true, canReleaseNow: false, releaseAllowedAfterCompletion: false })).toBe(false);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: false, canReleaseNow: false, releaseAllowedAfterCompletion: true })).toBe(false);
  });
});
