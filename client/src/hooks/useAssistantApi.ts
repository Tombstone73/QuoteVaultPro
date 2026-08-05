import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  AssistantCapabilities,
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
  AssistantReportResolutionSelectionResponse,
} from "@/features/assistant/types";

const capabilitiesKey = ["/api/assistant/capabilities"] as const;
const conversationsKey = ["/api/assistant/conversations"] as const;

export type AssistantConversationUpdate = {
  title?: string;
  status?: "active" | "archived";
};

function unwrap<T>(payload: T | { data?: T }): T {
  return (payload && typeof payload === "object" && "data" in payload
    ? (payload as { data?: T }).data
    : payload) as T;
}

export function useAssistantCapabilities(enabled: boolean) {
  return useQuery({
    queryKey: capabilitiesKey,
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async (): Promise<AssistantCapabilities> => {
      const response = await apiRequest("GET", "/api/assistant/capabilities");
      return unwrap<AssistantCapabilities>(await response.json());
    },
  });
}

export function useAssistantConversations(enabled: boolean, status: "active" | "archived" = "active") {
  return useQuery({
    queryKey: [...conversationsKey, status],
    enabled,
    retry: false,
    queryFn: async (): Promise<AssistantConversationSummary[]> => {
      const response = await apiRequest("GET", `/api/assistant/conversations${status === "archived" ? "?status=archived" : ""}`);
      const payload = unwrap<AssistantConversationSummary[] | { conversations?: AssistantConversationSummary[] }>(await response.json());
      return Array.isArray(payload) ? payload : payload?.conversations ?? [];
    },
  });
}

export function useAssistantConversation(conversationId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...conversationsKey, conversationId],
    enabled: enabled && Boolean(conversationId),
    retry: false,
    queryFn: async (): Promise<AssistantConversationDetail> => {
      const response = await apiRequest("GET", `/api/assistant/conversations/${conversationId}`);
      return unwrap<AssistantConversationDetail>(await response.json());
    },
  });
}

export function useCreateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AssistantConversationDetail> => {
      const response = await apiRequest("POST", "/api/assistant/conversations", {});
      return unwrap<AssistantConversationDetail>(await response.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

/**
 * Updates assistant-owned metadata only. Conversation titles and archive state
 * are never represented as assistant commands or confirmation-plan actions.
 */
export function useUpdateAssistantConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, patch }: { conversationId: string; patch: AssistantConversationUpdate }): Promise<AssistantConversationSummary> => {
      const response = await apiRequest("PATCH", `/api/assistant/conversations/${encodeURIComponent(conversationId)}`, patch);
      return unwrap<AssistantConversationSummary>(await response.json());
    },
    onMutate: async ({ conversationId, patch }) => {
      await queryClient.cancelQueries({ queryKey: conversationsKey });
      const previous = queryClient.getQueriesData<AssistantConversationSummary[]>({ queryKey: conversationsKey });
      for (const [queryKey, data] of previous) {
        if (!Array.isArray(data)) continue;
        queryClient.setQueryData<AssistantConversationSummary[]>(queryKey, patch.status === "archived"
          ? data.filter((conversation) => conversation.id !== conversationId)
          : data.map((conversation) => conversation.id === conversationId
            ? { ...conversation, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) }
            : conversation));
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [queryKey, data] of context?.previous ?? []) queryClient.setQueryData(queryKey, data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

export function useSendAssistantTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, message, context }: {
      conversationId: string;
      message: string;
      context: AssistantContextEnvelope;
    }) => {
      const response = await apiRequest("POST", `/api/assistant/conversations/${conversationId}/turns`, assistantTurnRequestBody(message, context));
      return response.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
      queryClient.invalidateQueries({ queryKey: [...conversationsKey, variables.conversationId] });
    },
  });
}

/** Submits canonical PBV2 IDs to the server-bound pending order session. */
export function useSubmitAssistantOrderOptionSelections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, orderIntakeSessionId, productId, pbv2TreeVersionId, selections, useRemainingDefaults, context }: {
      conversationId: string;
      orderIntakeSessionId: string;
      productId: string;
      pbv2TreeVersionId: string;
      selections: Array<{ nodeId: string; valueId: string }>;
      useRemainingDefaults: boolean;
      context: AssistantContextEnvelope;
    }) => {
      const response = await apiRequest("POST", `/api/assistant/conversations/${encodeURIComponent(conversationId)}/order-option-selections/${encodeURIComponent(orderIntakeSessionId)}`, { productId, pbv2TreeVersionId, selections, useRemainingDefaults, context });
      return response.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
      queryClient.invalidateQueries({ queryKey: [...conversationsKey, variables.conversationId] });
    },
  });
}

/** The assistant turn body deliberately keeps all internal whitespace intact;
 * Markdown tables and CSV-style messages depend on their original newlines. */
export function assistantTurnRequestBody(message: string, context: AssistantContextEnvelope) {
  return { message, context };
}

/** Selects an opaque candidate from a server-persisted report-resolution set.
 * No company ID, report arguments, or plan data ever crosses this boundary. */
export function useSelectAssistantReportResolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      resolutionId,
      candidateId,
      expectedVersion,
    }: {
      resolutionId: string;
      candidateId: string;
      expectedVersion: number;
    }): Promise<AssistantReportResolutionSelectionResponse> => {
      const response = await apiRequest("POST", `/api/assistant/report-resolutions/${encodeURIComponent(resolutionId)}/select`, {
        candidateId,
        expectedVersion,
      });
      return unwrap<AssistantReportResolutionSelectionResponse>(await response.json());
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
      // The route is conversation-scoped server-side, so broadly invalidating
      // assistant conversation details also covers refresh/reopen state.
      queryClient.invalidateQueries({ queryKey: ["/api/assistant/conversations"] });
    },
  });
}

export function useCancelAssistantReportResolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ resolutionId, expectedVersion }: { resolutionId: string; expectedVersion: number }) => {
      const response = await apiRequest("POST", `/api/assistant/report-resolutions/${encodeURIComponent(resolutionId)}/cancel`, { expectedVersion });
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

/**
 * Cancelling a server-created plan is separate from confirming or executing it.
 * The client deliberately exposes no confirmation/execution mutation here.
 */
export function useCancelAssistantPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, expectedPlanVersion }: { planId: string; expectedPlanVersion: number }): Promise<unknown> => {
      const response = await apiRequest("POST", `/api/assistant/plans/${encodeURIComponent(planId)}/cancel`, { expectedPlanVersion });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}

export type AssistantCreatedExecutionPlan = {
  plan: unknown;
  confirmationToken: string;
};

/** Creates a server-resolved plan from a trusted assistant turn; no command name is accepted. */
export function useCreateAssistantExecutionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      turnId,
      context,
    }: {
      conversationId: string;
      turnId: string;
      context: AssistantContextEnvelope;
    }): Promise<AssistantCreatedExecutionPlan> => {
      const response = await apiRequest("POST", `/api/assistant/conversations/${encodeURIComponent(conversationId)}/plans`, { turnId, context });
      return unwrap<AssistantCreatedExecutionPlan>(await response.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}

/** Applies an opaque canonical Product Intent interaction. The browser sends
 * only the action ID (and an explicitly typed rename value when required). */
export function useCanonicalProductIntentInteraction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, proposalId, action, actionId, newProductName }: { conversationId: string; proposalId: string; action: "accept_recommendation" | "dismiss_recommendation" | "apply_candidate"; actionId: string; newProductName?: string }) => {
      const response = await apiRequest("POST", `/api/assistant/conversations/${encodeURIComponent(conversationId)}/product-intent-interactions`, { proposalId, action, actionId, ...(newProductName ? { newProductName } : {}) });
      return unwrap<{ card?: unknown; navigation?: { href: string; abandon: boolean; cloneProductId?: string } }>(await response.json());
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: conversationsKey }); },
  });
}

/**
 * The only production confirmation UI path. It posts an opaque, server-issued
 * token to the plan-bound confirmation endpoint; chat text is never involved.
 */
export function useConfirmAssistantQuoteInternalNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      planId,
      expectedPlanVersion,
      confirmationToken,
      context,
    }: {
      planId: string;
      expectedPlanVersion: number;
      confirmationToken: string;
      context: AssistantContextEnvelope;
    }): Promise<{ plan?: unknown; result?: unknown }> => {
      const response = await apiRequest("POST", `/api/assistant/plans/${encodeURIComponent(planId)}/confirmations`, {
        expectedPlanVersion,
        confirmationToken,
        context,
      });
      return unwrap<{ plan?: unknown; result?: unknown }>(await response.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
    },
  });
}
