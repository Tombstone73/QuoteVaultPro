import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adaptInvoiceList } from "@/lib/adapters";
import { mockInvoices } from "@/lib/mock-data";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { useAuth } from "@/contexts/AuthContext";
import type { PortalInvoiceListItem } from "@/types/portal";

export function useInvoices() {
  const { isMockMode, dataMode } = useRuntimeConfig();
  const { user } = useAuth();

  return useQuery<PortalInvoiceListItem[]>({
    queryKey: ["portal", "invoices", dataMode],
    queryFn: async () => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 600));
        return mockInvoices;
      }

      const raw = await api.get<Record<string, unknown>[]>(
        `/invoices?customerId=${user?.customerId}`
      );
      return adaptInvoiceList(raw);
    },
    staleTime: 60_000,
    enabled: !!user || isMockMode,
  });
}
