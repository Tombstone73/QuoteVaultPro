import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/queryClient";
import {
  defaultInboundEmailIntakeSettings,
  inboundEmailIntakeSettingsSchema,
  type InboundEmailIntakeSettings,
} from "@shared/inboundEmailIntakeSettings";

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

export function useInboundEmailIntakeSettings() {
  return useQuery<InboundEmailIntakeSettings>({
    queryKey: ["/api/inbound-orders/email-settings"],
    queryFn: readInboundEmailSettings,
    staleTime: 60_000,
    retry: false,
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
      return payload;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/inbound-orders"] });
    },
  });
}
