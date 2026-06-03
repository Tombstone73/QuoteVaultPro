import type { CurrentBugAiReviewResponse } from "@shared/aiReviewContracts";

export function getAiReviewPollingInterval(data: CurrentBugAiReviewResponse | undefined): number | false {
  const status = data?.review?.status;
  return status === "pending" || status === "processing" ? 3000 : false;
}
