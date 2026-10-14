import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/queryClient";

export function useFilePrefixToolsStatus(organizationId?: string | null) {
  return useQuery<{ enabled: boolean }>({
    queryKey: ["/api/tools/bulk-file-renamer/status", organizationId],
    queryFn: async () => {
      const response = await apiFetch("/api/tools/bulk-file-renamer/status");
      if (!response.ok) return { enabled: false };
      return response.json();
    },
    enabled: Boolean(organizationId),
    staleTime: 0,
  });
}
