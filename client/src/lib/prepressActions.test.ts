import { describe, expect, jest, test } from "@jest/globals";
import {
  canCompleteAndReleasePrepress,
  completeAndReleasePrepress,
  markPrepressItemsPrintReady,
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

  test("promotes and completes multiple selected line items through canonical session endpoints", async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url === "/api/prepress/session/start") {
        return jsonResponse(true, { success: true, data: { id: "session-created" } });
      }
      return jsonResponse(true, { success: true, data: { finalFileId: `final-${url}` } });
    }) as unknown as typeof fetch;

    const results = await markPrepressItemsPrintReady([
      { lineItemId: "line-1", workflowState: "ready_for_prepress", sessionId: null, hasCompletedSession: false },
      { lineItemId: "line-2", workflowState: "in_prepress", sessionId: "session-2", hasCompletedSession: false },
    ], { fetchFn });

    expect(results.map((result) => result.status)).toEqual(["completed", "completed"]);
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/session/start", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/session/session-created/complete", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/session/session-2/complete", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/line-item/line-1/use-artwork-as-print-file", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/line-item/line-2/use-artwork-as-print-file", expect.objectContaining({ method: "POST" }));
    const completionCalls = (fetchFn as unknown as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith("/complete"));
    expect(completionCalls).toHaveLength(2);
    for (const [, request] of completionCalls) {
      expect(JSON.parse(String(request.body))).toEqual({ useExistingArtworkAsPrintFile: false });
    }
  });

  test("reports proof-blocked lines without preventing safe selected lines", async () => {
    const fetchFn = jest.fn(async () => jsonResponse(true, { success: true, data: { finalFileId: "final-2" } })) as unknown as typeof fetch;

    const results = await markPrepressItemsPrintReady([
      {
        lineItemId: "line-proof",
        workflowState: "in_prepress",
        sessionId: "session-proof",
        hasCompletedSession: false,
        blockedReason: "Awaiting proof approval",
      },
      { lineItemId: "line-safe", workflowState: "in_prepress", sessionId: "session-safe", hasCompletedSession: false },
    ], { fetchFn });

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineItemId: "line-proof", status: "failed", message: "Awaiting proof approval" }),
      expect.objectContaining({ lineItemId: "line-safe", status: "completed" }),
    ]));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test("can complete and release selected print-ready lines", async () => {
    const fetchFn = jest.fn(async () => jsonResponse(true, { success: true, data: {} })) as unknown as typeof fetch;

    const [result] = await markPrepressItemsPrintReady([
      { lineItemId: "line-1", workflowState: "in_prepress", sessionId: "session-1", hasCompletedSession: false },
    ], { fetchFn, releaseToProduction: true });

    expect(result.status).toBe("released");
    expect(fetchFn).toHaveBeenNthCalledWith(3, "/api/prepress/line-item/line-1/send-to-print", expect.any(Object));
  });
});
