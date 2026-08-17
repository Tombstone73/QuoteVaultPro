import type { OperationContext } from "../../application/operation.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { ConfirmProviderRefundInput } from "./contracts.js";
import { BillingPaymentsApplicationService } from "./paymentApplication.js";

/** Refund reconciliation only inspects the original provider operation; it never submits another refund. */
export interface ProviderRefundStatusAdapter {
  retrieve(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<
    | Readonly<{ kind: "succeeded"; providerEventId: string; providerTransactionId: string; occurredAt: string }>
    | Readonly<{ kind: "failed" }>
    | Readonly<{ kind: "unknown" }>
  >;
}
export interface ProviderRefundReconciliationStore {
  unresolved(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<Readonly<{ invoiceId: string; paymentId: string }> | null>;
  markFailed(input: Readonly<{ organizationId: string; providerOperationId: string }>): Promise<void>;
}

export class ProviderRefundReconciler {
  constructor(private readonly payments: BillingPaymentsApplicationService, private readonly store: ProviderRefundReconciliationStore, private readonly provider: ProviderRefundStatusAdapter) {}
  async reconcile(context: OperationContext, input: Omit<ConfirmProviderRefundInput, "providerEventId" | "providerTransactionId" | "occurredAt">): Promise<ApplicationResult<Readonly<{ state: "succeeded" | "failed" | "unknown"; refundId?: string }>>> {
    try {
      const unresolved=await this.store.unresolved({organizationId:input.organizationId,providerOperationId:input.providerOperationId});
      if(!unresolved||unresolved.invoiceId!==input.invoiceId||unresolved.paymentId!==input.paymentId)throw new V2ApplicationError("NOT_FOUND","Provider Refund operation was not found.");
      const result=await this.provider.retrieve({organizationId:input.organizationId,providerOperationId:input.providerOperationId});
      if(result.kind==="unknown")return success({state:"unknown"});
      if(result.kind==="failed"){await this.store.markFailed({organizationId:input.organizationId,providerOperationId:input.providerOperationId});return success({state:"failed"});}
      const confirmed=await this.payments.confirmProviderRefund(context,{...input,providerEventId:result.providerEventId,providerTransactionId:result.providerTransactionId,occurredAt:result.occurredAt});
      if(!confirmed.ok)return confirmed;
      return success({state:"succeeded",refundId:confirmed.value.refundId});
    }catch(error){return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Provider Refund reconciliation could not complete."));}
  }
}
