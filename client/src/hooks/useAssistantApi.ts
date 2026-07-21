import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  AssistantCapabilities,
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
} from "@/features/assistant/types";

const capabilitiesKey = ["/api/assistant/capabilities"] as const;
const conversationsKey = ["/api/assistant/conversations"] as const;

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

export function useAssistantConversations(enabled: boolean) {
  return useQuery({
    queryKey: conversationsKey,
    enabled,
    retry: false,
    queryFn: async (): Promise<AssistantConversationSummary[]> => {
      const response = await apiRequest("GET", "/api/assistant/conversations");
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

export function useSendAssistantTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId, message, context }: {
      conversationId: string;
      message: string;
      context: AssistantContextEnvelope;
    }) => {
      const response = await apiRequest("POST", `/api/assistant/conversations/${conversationId}/turns`, {
        message,
        context,
      });
      return response.json();
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: conversationsKey });
      queryClient.invalidateQueries({ queryKey: [...conversationsKey, variables.conversationId] });
    },
  });
}
