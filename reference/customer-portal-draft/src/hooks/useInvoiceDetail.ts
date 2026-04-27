import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adaptInvoiceDetail } from "@/lib/adapters";
import { mockInvoiceDetail } from "@/lib/mock-data";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import type { PortalInvoiceDetail } from "@/types/portal";

export function useInvoiceDetail(invoiceId: string | undefined) {
  const { isMockMode, dataMode } = useRuntimeConfig();

  return useQuery<PortalInvoiceDetail>({
    queryKey: ["portal", "invoice", invoiceId, dataMode],
    queryFn: async () => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 400));
        return mockInvoiceDetail(invoiceId!);
      }

      const raw = await api.get<Record<string, unknown>>(`/invoices/${invoiceId}`);
      return adaptInvoiceDetail(raw);
    },
    staleTime: 30_000,
    enabled: !!invoiceId,
  });
}
