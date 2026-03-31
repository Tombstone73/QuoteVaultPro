import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { toast } from "sonner";

interface ConvertQuoteResult {
  orderId: string;
  orderNumber: string;
}

export function useConvertQuote() {
  const queryClient = useQueryClient();
  const { isMockMode } = useRuntimeConfig();

  return useMutation<ConvertQuoteResult, Error, string>({
    mutationFn: async (quoteId: string) => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 800));
        toast.info("Demo mode — quote approval simulated");
        return { orderId: "ord_mock_new", orderNumber: "ORD-2024-9999" };
      }

      return api.post<ConvertQuoteResult>(`/portal/convert-quote/${quoteId}`, {});
    },
    onSuccess: (data) => {
      toast.success(`Quote approved — Order ${data.orderNumber} created`);
      queryClient.invalidateQueries({ queryKey: ["portal", "quotes"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "orders"] });
    },
    onError: (err) => {
      toast.error(`Failed to approve quote: ${err.message}`);
    },
  });
}
