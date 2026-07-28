import { describe, expect, jest, test } from "@jest/globals";
import {
  canCompleteAndReleasePrepress,
  completeAndReleasePrepress,
  markPrepressItemsPrintReady,
} from "./prepressActions";

function jsonResponse(ok: boolean, data: Record<string, unknown>) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

describe("Prepress complete and release action", () => {
  test("completes prepress through the authoritative finalization endpoint", async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(true, { success: true, data: { status: "complete", workflowState: "ready_for_production" } })) as unknown as typeof fetch;

    const result = await completeAndReleasePrepress({
      lineItemId: "line-1",
      sessionId: "session-1",
      hasCompletedSession: false,
    }, fetchFn);

    expect(fetchFn).toHaveBeenNthCalledWith(1, "/api/prepress/session/session-1/complete", expect.objectContaining({ method: "POST" }));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.skippedCompletion).toBe(false);
  });

  test("does not complete prepress twice when the session is already complete", async () => {
    const fetchFn = jest.fn(async () => jsonResponse(true, { success: true })) as unknown as typeof fetch;

    const result = await completeAndReleasePrepress({
      lineItemId: "line-1",
      sessionId: null,
      hasCompletedSession: true,
    }, fetchFn);

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.skippedCompletion).toBe(true);
  });

  test("enables the combined action only for a releasable completed or completable job", () => {
    expect(canCompleteAndReleasePrepress({ canCompleteNow: true, canReleaseNow: false, releaseAllowedAfterCompletion: true })).toBe(true);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: false, canReleaseNow: true, releaseAllowedAfterCompletion: false })).toBe(true);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: true, canReleaseNow: false, releaseAllowedAfterCompletion: false })).toBe(false);
    expect(canCompleteAndReleasePrepress({ canCompleteNow: false, canReleaseNow: false, releaseAllowedAfterCompletion: true })).toBe(false);
  });

  test("completes selected line items without pre-completion promotion", async () => {
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
    expect(fetchFn).not.toHaveBeenCalledWith(expect.stringContaining("use-artwork-as-print-file"), expect.anything());
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("can complete and release selected print-ready lines", async () => {
    const fetchFn = jest.fn(async () => jsonResponse(true, { success: true, data: {} })) as unknown as typeof fetch;

    const [result] = await markPrepressItemsPrintReady([
      { lineItemId: "line-1", workflowState: "in_prepress", sessionId: "session-1", hasCompletedSession: false },
    ], { fetchFn, releaseToProduction: true });

    expect(result.status).toBe("released");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith("/api/prepress/session/session-1/complete", expect.any(Object));
  });
});
