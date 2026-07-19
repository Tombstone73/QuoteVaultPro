export type PrepressCombinedActionInput = {
  lineItemId: string;
  sessionId?: string | null;
  hasCompletedSession: boolean;
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

export async function requestCompletePrepressSession(sessionId: string, fetchFn: typeof fetch = fetch) {
  const response = await fetchFn(`/api/prepress/session/${sessionId}/complete`, {
    method: "POST",
    credentials: "include",
  });
  return parsePrepressResponse(response, "Failed to complete prepress");
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

  try {
    const releaseResponse = await requestReleasePrepressLineItem(input.lineItemId, fetchFn);
    return { completionResponse, releaseResponse, skippedCompletion: input.hasCompletedSession };
  } catch (error: any) {
    throw new PrepressCompleteAndReleaseError(
      `Prepress is complete, but release to production failed: ${error?.message || "Unknown error"}`,
      prepressCompleted,
    );
  }
}
