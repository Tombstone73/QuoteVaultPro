import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiRequest } from "@/lib/queryClient";

// ---- Types derived from the real server contract ----
// Source: server/routes/portalProof.routes.ts + server/services/proofAccessTokenService.ts

export type PortalProofStatus = "pending" | "approved" | "rejected" | "revision_requested";
export type ProofAction = "approve" | "reject" | "revision_request";

export type PortalProofAttachment = {
  id: string;
  fileName: string;
  originalFilename: string | null;
  mimeType: string | null;
  createdAt: string;
  originalUrl: string | null;
  downloadUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  pages: Array<{
    pageIndex: number;
    thumbUrl: string | null;
    previewUrl: string | null;
  }>;
};

export type PortalProofData = {
  proofVersion: {
    id: string;
    versionNumber: number;
    createdAt: string;
  };
  attachments: PortalProofAttachment[];
  status: PortalProofStatus;
};

export type PortalProofActionResult = {
  approval: {
    id: string;
    lineItemId: string;
    proofVersionId: string;
    decision: ProofAction;
  };
  workflowTransition: {
    toState: string;
  };
  status: PortalProofStatus;
};

// ---- Query: GET /api/portal/proof/:token ----

export function useProofToken(token: string) {
  return useQuery<PortalProofData>({
    queryKey: ["portal", "proof", token],
    queryFn: async () => {
      const res = await apiFetch(`/api/portal/proof/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = Object.assign(
          new Error(body?.error ?? "Failed to load proof"),
          { status: res.status },
        );
        throw err;
      }
      const json = await res.json();
      return json.data as PortalProofData;
    },
    enabled: Boolean(token),
    retry: false,
    // No stale/refetch — token is immutable; action updates come from the mutation
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

// ---- Mutation: POST /api/portal/proof/:token/action ----

export function useSubmitProofAction(token: string) {
  const queryClient = useQueryClient();

  return useMutation<
    PortalProofActionResult,
    Error & { status?: number },
    { action: ProofAction; comment?: string }
  >({
    mutationFn: async ({ action, comment }) => {
      const res = await apiRequest("POST", `/api/portal/proof/${token}/action`, {
        action,
        ...(comment?.trim() ? { comment: comment.trim() } : {}),
      });
      const json = await res.json();
      return json.data as PortalProofActionResult;
    },
    onSuccess: () => {
      // Invalidate so that a page refresh reflects the resolved state
      queryClient.invalidateQueries({ queryKey: ["portal", "proof", token] });
    },
  });
}
