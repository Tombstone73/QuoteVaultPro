export type PrepressCombinedActionInput = {
  lineItemId: string;
  sessionId?: string | null;
  hasCompletedSession: boolean;
};

export type PrepressPrintReadyItem = PrepressCombinedActionInput & {
  workflowState: string;
  blockedReason?: string | null;
};

export type PrepressPrintReadyResult = {
  lineItemId: string;
  status: "completed" | "released" | "failed";
  message: string;
  finalFileId?: string | null;
};

export class PrepressCompleteAndReleaseError extends Error {
  constructor(message: string, public readonly prepressCompleted: boolean) {
    super(message);
    this.name = "PrepressCompleteAndReleaseError";
  }
}

async function parsePrepressResponse(response: Response, fallbackMessage: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || fallbackMessage);
  return data;
}

export async function requestCompletePrepressSession(
  sessionId: string,
  fetchFn: typeof fetch = fetch,
  options: { useExistingArtworkAsPrintFile?: boolean } = {},
) {
  const response = await fetchFn(`/api/prepress/session/${sessionId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      useExistingArtworkAsPrintFile: options.useExistingArtworkAsPrintFile === true,
    }),
  });
  return parsePrepressResponse(response, "Failed to complete prepress");
}

export async function requestStartPrepressSession(lineItemId: string, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn("/api/prepress/session/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ lineItemId }),
  });
  return parsePrepressResponse(response, "Failed to start prepress");
}

export async function requestReleasePrepressLineItem(lineItemId: string, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(`/api/prepress/line-item/${lineItemId}/send-to-print`, {
    method: "POST",
    credentials: "include",
  });
  return parsePrepressResponse(response, "Failed to release to production");
}

export function canCompleteAndReleasePrepress(input: {
  canCompleteNow: boolean;
  canReleaseNow: boolean;
  releaseAllowedAfterCompletion: boolean;
}) {
  return input.canReleaseNow || (input.canCompleteNow && input.releaseAllowedAfterCompletion);
}

export async function completeAndReleasePrepress(
  input: PrepressCombinedActionInput,
  fetchFn: typeof fetch = fetch,
) {
  let prepressCompleted = input.hasCompletedSession;
  let completionResponse: any = null;

  if (!prepressCompleted) {
    if (!input.sessionId) {
      throw new PrepressCompleteAndReleaseError("An active prepress session is required.", false);
    }
    try {
      completionResponse = await requestCompletePrepressSession(input.sessionId, fetchFn);
      prepressCompleted = true;
    } catch (error: any) {
      throw new PrepressCompleteAndReleaseError(error?.message || "Failed to complete prepress", false);
    }
  }

  return { completionResponse, skippedCompletion: input.hasCompletedSession };
}

/**
 * Completion is authoritative on the backend: it validates the selected artwork,
 * finalizes it, enqueues the local copy, and routes the line. Items are processed
 * independently so one blocked line does not conceal successful lines.
 */
export async function markPrepressItemsPrintReady(
  items: PrepressPrintReadyItem[],
  options: { releaseToProduction?: boolean; fetchFn?: typeof fetch } = {},
): Promise<PrepressPrintReadyResult[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const results: PrepressPrintReadyResult[] = [];

  for (const item of items) {
    if (item.blockedReason) {
      results.push({ lineItemId: item.lineItemId, status: "failed", message: item.blockedReason });
      continue;
    }

    try {
      let sessionId = item.sessionId ?? null;
      let completionResponse: any = null;
      if (!item.hasCompletedSession) {
        if (!sessionId) {
          if (String(item.workflowState).toLowerCase() !== "ready_for_prepress") {
            throw new Error("Line item is not ready to start prepress.");
          }
          const startResponse = await requestStartPrepressSession(item.lineItemId, fetchFn);
          sessionId = startResponse?.data?.id ?? null;
        }
        if (!sessionId) throw new Error("Prepress session was not created.");
        completionResponse = await requestCompletePrepressSession(sessionId, fetchFn);
      }

      results.push({
        lineItemId: item.lineItemId,
        status: options.releaseToProduction ? "released" : "completed",
        message: "Prepress completed, production artwork finalized, and line routed.",
        finalFileId: completionResponse?.data?.finalFileId ?? null,
      });
    } catch (error) {
      results.push({
        lineItemId: item.lineItemId,
        status: "failed",
        message: error instanceof Error ? error.message : "Print-ready preparation failed.",
      });
    }
  }

  return results;
}
