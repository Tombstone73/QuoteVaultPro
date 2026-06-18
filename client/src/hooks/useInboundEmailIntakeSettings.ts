import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/queryClient";
import {
  defaultInboundEmailIntakeSettings,
  inboundEmailIntakeSettingsSchema,
  type InboundEmailIntakeSettings,
} from "@shared/inboundEmailIntakeSettings";
import {
  inboundEmailPullResultSchema,
  type InboundEmailPullResult,
} from "@shared/inboundEmailIngestion";
import {
  inboundEmailMailboxListResponseSchema,
  inboundEmailMailboxViewSchema,
  type InboundEmailMailboxListResponse,
  type InboundEmailMailboxView,
} from "@shared/inboundEmailMailboxes";
import type {
  InboundEmailIgnoreRuleCreateRequest,
  InboundEmailIgnoreRuleDto,
  InboundEmailIgnoreRuleListResponse,
  InboundEmailIgnoreRuleUpdateRequest,
  InboundEmailIgnoreRuleTypeValue,
  InboundEmailPullDiagnosticsResponse,
} from "@shared/inboundOrdersApi";

type InboundEmailSettingsResponse = {
  success: boolean;
  data?: unknown;
  message?: string;
};

async function readInboundEmailSettings(): Promise<InboundEmailIntakeSettings> {
  const response = await apiFetch("/api/inbound-orders/email-settings");
  const payload = await response.json().catch(() => ({})) as InboundEmailSettingsResponse;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Failed to load inbound email settings");
  }

  const parsed = inboundEmailIntakeSettingsSchema.safeParse(payload.data);
  return parsed.success ? parsed.data : defaultInboundEmailIntakeSettings;
}

async function readInboundEmailMailboxes(): Promise<InboundEmailMailboxListResponse> {
  const response = await apiFetch("/api/inbound-orders/email/mailboxes");
  const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Failed to load inbound email mailboxes");
  }

  const parsed = inboundEmailMailboxListResponseSchema.safeParse(payload.data);
  if (!parsed.success) {
    throw new Error("Inbound email mailbox list returned an invalid response.");
  }
  return parsed.data;
}

async function readInboundEmailIgnoreRules(): Promise<InboundEmailIgnoreRuleListResponse["data"]> {
  const response = await apiFetch("/api/inbound-orders/email/ignore-rules");
  const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Failed to load inbound email ignore rules");
  }
  const data = payload.data as InboundEmailIgnoreRuleListResponse["data"] | undefined;
  return { rules: Array.isArray(data?.rules) ? data.rules : [] };
}

async function readInboundEmailPullDiagnostics(subject: string): Promise<InboundEmailPullDiagnosticsResponse["data"]> {
  const query = subject.trim() ? `?subject=${encodeURIComponent(subject.trim())}` : "";
  const response = await apiFetch(`/api/inbound-orders/email/pull-diagnostics${query}`);
  const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || "Failed to load inbound email pull diagnostics");
  }
  return payload.data as InboundEmailPullDiagnosticsResponse["data"];
}

export function useInboundEmailIntakeSettings() {
  return useQuery<InboundEmailIntakeSettings>({
    queryKey: ["/api/inbound-orders/email-settings"],
    queryFn: readInboundEmailSettings,
    staleTime: 60_000,
    retry: false,
  });
}

export function useInboundEmailMailboxes() {
  return useQuery<InboundEmailMailboxListResponse>({
    queryKey: ["/api/inbound-orders/email/mailboxes"],
    queryFn: readInboundEmailMailboxes,
    staleTime: 60_000,
    retry: false,
  });
}

export function useInboundEmailIgnoreRules() {
  return useQuery<InboundEmailIgnoreRuleListResponse["data"]>({
    queryKey: ["/api/inbound-orders/email/ignore-rules"],
    queryFn: readInboundEmailIgnoreRules,
    staleTime: 60_000,
    retry: false,
  });
}

export function useInboundEmailPullDiagnostics(subject = "") {
  return useQuery<InboundEmailPullDiagnosticsResponse["data"]>({
    queryKey: ["/api/inbound-orders/email/pull-diagnostics", subject.trim()],
    queryFn: () => readInboundEmailPullDiagnostics(subject),
    staleTime: 30_000,
    retry: false,
  });
}

export function useCreateInboundEmailIgnoreRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: InboundEmailIgnoreRuleCreateRequest) => {
      const response = await apiFetch("/api/inbound-orders/email/ignore-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to create inbound email ignore rule");
      }
      return payload.data as InboundEmailIgnoreRuleDto;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/ignore-rules"] });
    },
  });
}

export function useUpdateInboundEmailIgnoreRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ruleId, ...input }: { ruleId: string } & InboundEmailIgnoreRuleUpdateRequest) => {
      const response = await apiFetch(`/api/inbound-orders/email/ignore-rules/${encodeURIComponent(ruleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to update inbound email ignore rule");
      }
      return payload.data as InboundEmailIgnoreRuleDto;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/ignore-rules"] });
    },
  });
}

export function useDeleteInboundEmailIgnoreRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ruleId: string) => {
      const response = await apiFetch(`/api/inbound-orders/email/ignore-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to delete inbound email ignore rule");
      }
      return payload.data as InboundEmailIgnoreRuleDto;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/ignore-rules"] });
    },
  });
}

export function useUpdateInboundEmailMailboxEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ mailboxId, enabled }: { mailboxId: string; enabled: boolean }) => {
      const response = await apiFetch(`/api/inbound-orders/email/mailboxes/${encodeURIComponent(mailboxId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to update inbound email mailbox");
      }
      const parsed = inboundEmailMailboxViewSchema.safeParse(payload.data);
      if (!parsed.success) {
        throw new Error("Inbound email mailbox update returned an invalid response.");
      }
      return parsed.data as InboundEmailMailboxView;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/mailboxes"] });
    },
  });
}

export function useSetDefaultInboundEmailMailbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const response = await apiFetch(`/api/inbound-orders/email/mailboxes/${encodeURIComponent(mailboxId)}/default`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to set default inbound email mailbox");
      }
      const parsed = inboundEmailMailboxViewSchema.safeParse(payload.data);
      if (!parsed.success) {
        throw new Error("Inbound email mailbox update returned an invalid response.");
      }
      return parsed.data as InboundEmailMailboxView;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/mailboxes"] });
    },
  });
}

export function useDeleteInboundEmailMailbox() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const response = await apiFetch(`/api/inbound-orders/email/mailboxes/${encodeURIComponent(mailboxId)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw new Error(payload.message || "Failed to delete inbound email mailbox");
      }
      return payload.data as { id: string };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders/email/mailboxes"] });
    },
  });
}

export function useStartInboundGmailMailboxOAuth() {
  return useMutation({
    mutationFn: async (reconnectMailboxId?: string | null) => {
      const query = reconnectMailboxId ? `?reconnectMailboxId=${encodeURIComponent(reconnectMailboxId)}` : "";
      const response = await apiFetch(`/api/inbound-orders/email/mailboxes/gmail/start${query}`);
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; data?: { url?: string } };
      if (!response.ok || payload.success === false || !payload.data?.url) {
        throw new Error(payload.message || "Failed to start inbound Gmail connection");
      }
      return payload.data.url;
    },
  });
}

export function usePullLatestInboundEmails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const response = await apiFetch("/api/inbound-orders/email/pull-latest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({})) as { success?: boolean; message?: string; code?: string; data?: unknown };
      if (!response.ok || payload.success === false) {
        throw Object.assign(new Error(payload.message || "Failed to pull latest inbound emails"), {
          code: payload.code,
          data: payload.data,
        });
      }
      const parsed = inboundEmailPullResultSchema.safeParse(payload.data);
      if (!parsed.success) {
        throw new Error("Inbound email pull returned an invalid response.");
      }
      return parsed.data as InboundEmailPullResult;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
    },
  });
}
