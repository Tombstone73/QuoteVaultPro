import type { OperationContext } from "../../application/operation.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ConfirmProviderPaymentInput } from "./contracts.js";
import { BillingPaymentsApplicationService } from "./paymentApplication.js";

/** Safe provider status contract: identifiers/state only, never card or secret payloads. */
export interface ProviderPaymentStatusAdapter {
  retrieve(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<
    | Readonly<{ kind: "succeeded"; providerEventId: string; providerTransactionId: string; occurredAt: string }>
    | Readonly<{ kind: "failed" }>
    | Readonly<{ kind: "unknown" }>
  >;
}
export interface ProviderPaymentReconciliationStore {
  unresolved(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<Readonly<{ invoiceId: string }> | null>;
  markFailed(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<void>;
}

/**
 * Callback handlers and workers both call this unit. Success always enters the
 * canonical Payment confirmation operation; unknown results leave recovery
 * pending and failed results cannot manufacture a Payment.
 */
export class ProviderPaymentReconciler {
  constructor(private readonly payments: BillingPaymentsApplicationService, private readonly store: ProviderPaymentReconciliationStore, private readonly provider: ProviderPaymentStatusAdapter) {}
  async reconcile(context: OperationContext, input: Omit<ConfirmProviderPaymentInput, "providerEventId" | "providerTransactionId" | "occurredAt">): Promise<ApplicationResult<Readonly<{ state: "succeeded" | "failed" | "unknown"; paymentId?: string }>>> {
    try {
      const unresolved = await this.store.unresolved({ organizationId: input.organizationId, providerOperationId: input.providerOperationId });
      if (!unresolved || unresolved.invoiceId !== input.invoiceId) throw new V2ApplicationError("NOT_FOUND", "Provider Payment operation was not found.");
      const result = await this.provider.retrieve({ organizationId: input.organizationId, providerOperationId: input.providerOperationId });
      if (result.kind === "unknown") return success({ state: "unknown" });
      if (result.kind === "failed") { await this.store.markFailed({ organizationId: input.organizationId, providerOperationId: input.providerOperationId }); return success({ state: "failed" }); }
      const confirmed = await this.payments.confirmProviderPayment(context, { ...input, providerEventId: result.providerEventId, providerTransactionId: result.providerTransactionId, occurredAt: result.occurredAt });
      if (!confirmed.ok) return confirmed;
      return success({ state: "succeeded", paymentId: confirmed.value.paymentId });
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Provider Payment reconciliation could not complete.")); }
  }
}
