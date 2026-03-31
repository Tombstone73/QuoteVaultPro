import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRuntimeConfig } from "@/contexts/RuntimeConfigContext";
import { toast } from "sonner";

interface CreateIntentResponse {
  clientSecret: string;
}

interface ConfirmPaymentResponse {
  success: boolean;
}

export function useCreatePaymentIntent() {
  const { isMockMode } = useRuntimeConfig();

  return useMutation<CreateIntentResponse, Error, string>({
    mutationFn: async (invoiceId: string) => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 800));
        // Return a fake client secret for demo mode
        return { clientSecret: "pi_demo_secret_mock" };
      }

      return api.post<CreateIntentResponse>(
        `/invoices/${invoiceId}/payments/stripe/create-intent`
      );
    },
  });
}

export function useConfirmPayment() {
  const { isMockMode } = useRuntimeConfig();
  const queryClient = useQueryClient();

  return useMutation<ConfirmPaymentResponse, Error, { invoiceId: string; paymentIntentId?: string }>({
    mutationFn: async ({ invoiceId, paymentIntentId }) => {
      if (isMockMode) {
        await new Promise((r) => setTimeout(r, 1000));
        toast.info("Demo mode — payment simulated successfully");
        return { success: true };
      }

      return api.post<ConfirmPaymentResponse>(
        `/invoices/${invoiceId}/payments/stripe/confirm`,
        { paymentIntentId }
      );
    },
    onSuccess: (_data, { invoiceId }) => {
      queryClient.invalidateQueries({ queryKey: ["portal", "invoices"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "invoice", invoiceId] });
    },
  });
}
