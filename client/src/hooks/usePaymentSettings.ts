import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PaymentProvider = "none" | "stripe" | "eps";
export type EpsPaymentMode = "hosted_cnp" | "token_cnp" | "card_present" | "ach" | "gift_card";

export type PaymentSettingsView = {
  provider: PaymentProvider;
  stripeEnabled: boolean;
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
  epsMode: "test" | "live";
  epsTestAccountNumber: string | null;
  epsTestApiKeyConfigured: boolean;
  epsTestApiKeyMasked: string | null;
  epsTestBaseUrl: string;
  epsLiveAccountNumber: string | null;
  epsLiveApiKeyConfigured: boolean;
  epsLiveApiKeyMasked: string | null;
  epsLiveBaseUrl: string;
};

export type UpdatePaymentSettingsInput = Partial<
  Omit<PaymentSettingsView, "epsApiKeyConfigured" | "epsReady" | "missing" | "epsTestApiKeyConfigured" | "epsTestApiKeyMasked" | "epsLiveApiKeyConfigured" | "epsLiveApiKeyMasked"> & {
    epsTestApiKey: string | null;
    epsLiveApiKey: string | null;
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

export function useRecordEpsHostedResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      paymentId: string;
      epsTransactionId: string;
      authCode?: string | null;
      tokenLast4?: string | null;
      approvedAmountCents: number;
      responseCode?: string | null;
      responseMessage?: string | null;
      internalNote?: string | null;
      result: "approved" | "failed" | "canceled";
      amountOverride?: boolean;
    }) => {
      const response = await fetch("/api/payments/eps/record-hosted-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || payload?.message || "Failed to record EPS payment result");
      }
      return payload.data as {
        payment: any;
        invoice?: any;
        response: {
          status: "approved" | "failed";
          responseMessage?: string | null;
        };
      };
    },
    onSuccess: (data) => {
      const invoiceId = data?.payment?.invoiceId || data?.invoice?.id;
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (invoiceId) {
        queryClient.invalidateQueries({ queryKey: ["invoices", invoiceId] });
        queryClient.invalidateQueries({ queryKey: ["invoicePayments", invoiceId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/operational-summary"] });
    },
  });
}
