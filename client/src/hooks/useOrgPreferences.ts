/**
 * Hook for managing organization preferences
 * Reads/writes to organizations.settings.preferences JSONB field
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./use-toast";
import type { QuickBooksSyncPolicy } from "@shared/quickBooksPreferences";
import type { ProductionDocumentNumberDisplayMode } from "@shared/documentNumbering";
import type { BillingInvoiceTriggerPolicy } from "@shared/billingInvoicePolicy";
import type { InboundEmailIntakeSettings } from "@shared/inboundEmailIntakeSettings";
import type { InvoiceSendAutomationPreferences } from "@shared/invoiceSendAutomation";

export interface OrgPreferences {
  prepressDefaultEnabled?: boolean;

  basic?: {
    attachQuotePdfByDefault?: boolean;
    attachOrderPdfByDefault?: boolean;
  };

  emailTemplates?: {
    replyToEmail?: string;
    quoteEmailSubject?: string;
    quoteEmailBody?: string;
  };

  fileUploadNaming?: {
    fileUploadJobPrefixMode?: "none" | "numeric_only" | "full_job_number";
    prepressFileLabelMode?: "optional" | "required";
  };

  quotes?: {
    requireApproval?: boolean;
    savedQuotesVisibleInPortalByDefault?: boolean;
  };
  orders?: {
    requireDueDateForProduction?: boolean;
    requireBillingAddressForProduction?: boolean;
    requireShippingAddressForProduction?: boolean;
    allowCompletedOrderEdits?: boolean;
    requireAllLineItemsDoneToComplete?: boolean;
    requireLineItemsDoneToComplete?: boolean;
    saveRoutingMode?: "save_only" | "route_eligible" | "ask_each_time";
  };
  inventoryPolicy?: {
    mode?: "off" | "advisory" | "enforced";
    // Back-compat (older stored prefs)
    reservationsEnabled?: boolean;
    autoReserveOnApplyPbV2?: boolean;
    autoReserveOnOrderConfirm?: boolean;
    enforcementMode?: "off" | "warn_only" | "block_on_shortage";
    allowNegative?: boolean;
  };

  quickBooks?: {
    syncPolicy?: QuickBooksSyncPolicy;
  };

  inboundEmail?: InboundEmailIntakeSettings;

  billingInvoiceTriggerPolicy?: BillingInvoiceTriggerPolicy;

  invoiceSendAutomation?: InvoiceSendAutomationPreferences;

  production?: {
    materialsOverrideMode?: "prepress_only" | "prepress_and_production";
    documentNumberDisplayMode?: ProductionDocumentNumberDisplayMode;
  };

  proofing?: {
    defaultProofDisclaimerText?: string;
    proofApprovalLockEnabled?: boolean;
    policy?: "automatic" | "manual_requested_only";
  };

  fulfillment?: {
    pickupRetentionDaysAfterPickedUp?: number;
    verificationPolicy?: "strict_separate_verification" | "packing_completes_fulfillment";
  };

  sidebar?: {
    showOperationalBadges?: boolean;
  };
}

type InventoryPolicyPatch = {
  enabled?: boolean;
  reservationsEnabled?: boolean;
  mode?: "off" | "advisory" | "enforced";
  enforcementMode?: "off" | "warn_only" | "block_on_shortage";
  autoReserveOnApplyPbV2?: boolean;
  autoReserveOnOrderConfirm?: boolean;
  allowNegative?: boolean;
};

export function useOrgPreferences() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery<OrgPreferences>({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await fetch("/api/organization/preferences", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch preferences");
      }
      return response.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (newPreferences: OrgPreferences) => {
      const response = await fetch("/api/organization/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newPreferences),
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update preferences");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      toast({
        title: "Preferences updated",
        description: "Your changes have been saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const inventoryPolicyMutation = useMutation({
    mutationFn: async (patch: InventoryPolicyPatch) => {
      const response = await fetch("/api/organization/preferences/inventory-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        credentials: "include",
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error((payload as any).message || "Failed to update inventory policy");
      }

      if ((payload as any)?.success === false) {
        throw new Error((payload as any).message || "Failed to update inventory policy");
      }

      return payload as any;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization/preferences"] });
      toast({
        title: "Inventory policy updated",
        description: "Your changes have been saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update inventory policy",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    preferences: preferences || {},
    isLoading,
    updatePreferences: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    updateInventoryPolicy: inventoryPolicyMutation.mutateAsync,
    isUpdatingInventoryPolicy: inventoryPolicyMutation.isPending,
  };
}
