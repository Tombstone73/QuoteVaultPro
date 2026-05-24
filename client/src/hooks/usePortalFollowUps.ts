import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Envelope<T> = {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
};

export type PortalFollowUpStatus = "new" | "pending" | "completed";

export type PortalFollowUpDto = {
  id: string;
  eventType: string;
  status: PortalFollowUpStatus;
  title: string;
  description: string | null;
  customerName: string | null;
  entityType: string;
  entityId: string;
  followUpArea: string | null;
  actionUrl: string | null;
  createdAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
};

export type PortalFollowUpSummaryDto = {
  unresolvedCount: number;
  items: PortalFollowUpDto[];
};

export const portalFollowUpKeys = {
  all: ["internal", "portal-follow-ups"] as const,
  list: (status = "open") => ["internal", "portal-follow-ups", status] as const,
};

async function internalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith("/api/internal/")) {
    throw new Error("Internal portal follow-up requests must use the internal API boundary");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || payload.error || "Failed to load portal follow-ups");
  }
  return payload.data as T;
}

export function usePortalFollowUps(enabled = true, status = "open") {
  return useQuery({
    queryKey: portalFollowUpKeys.list(status),
    queryFn: () => internalFetch<PortalFollowUpSummaryDto>(`/api/internal/portal-follow-ups?status=${encodeURIComponent(status)}&limit=5`),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useUpdatePortalFollowUpStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PortalFollowUpStatus }) =>
      internalFetch<PortalFollowUpDto>(`/api/internal/portal-follow-ups/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: portalFollowUpKeys.all });
      queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
    },
  });
}
