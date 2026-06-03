import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PaymentProvider = "none" | "eps";
export type EpsPaymentMode = "hosted_cnp" | "token_cnp" | "card_present" | "ach" | "gift_card";

export type PaymentSettingsView = {
  provider: PaymentProvider;
  epsEnabled: boolean;
  epsAccountNumber: string | null;
  epsApiKeyConfigured: boolean;
  epsCnpBaseUrl: string;
  epsCardPresentBaseUrl: string;
  epsAchBaseUrl: string;
  epsGiftBaseUrl: string;
  epsDeviceSerialNumber: string | null;
  epsSupportedModes: EpsPaymentMode[];
  epsReady: boolean;
  missing: string[];
};

export type UpdatePaymentSettingsInput = Partial<
  Omit<PaymentSettingsView, "epsApiKeyConfigured" | "epsReady" | "missing"> & {
    epsApiKey: string | null;
  }
>;

export function usePaymentSettings() {
  return useQuery<PaymentSettingsView>({
    queryKey: ["/api/payment-settings"],
    queryFn: async () => {
      const response = await fetch("/api/payment-settings", { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || "Failed to load payment settings");
      }
      return payload.data as PaymentSettingsView;
    },
  });
}

export function useUpdatePaymentSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePaymentSettingsInput) => {
      const response = await fetch("/api/payment-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || "Failed to save payment settings");
      }
      return payload.data as PaymentSettingsView;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-settings"] });
    },
  });
}

export function useCreateEpsHostedSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { invoiceId: string; amountCents: number; idempotencyKey?: string | null }) => {
      const response = await fetch("/api/payments/eps/hosted-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || "Failed to create EPS hosted session");
      }
      return payload.data as {
        payment: any;
        hostedPaymentUrl?: string | null;
        reused?: boolean;
        response: {
          status: "approved" | "pending" | "failed";
          responseMessage?: string | null;
        };
      };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoices", variables.invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoicePayments", variables.invoiceId] });
    },
  });
}
