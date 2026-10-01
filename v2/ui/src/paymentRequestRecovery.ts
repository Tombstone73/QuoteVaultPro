import type { PaymentWorkspaceInvoice, PaymentWorkspaceRecordInput } from "../../src/modules/billing/paymentWorkspace";
import type { PaymentsRecordResult } from "./paymentsWorkspaceApi";

export type PaymentRequestForm = Readonly<{
  customerId: string;
  invoicePage: number;
  selected: readonly Readonly<{ invoice: PaymentWorkspaceInvoice; appliedText: string }>[];
  tenderText: string;
}>;
type Recovery = {
  input: PaymentWorkspaceRecordInput;
  form: PaymentRequestForm;
  unknown: boolean;
  receipt?: PaymentsRecordResult;
  lease: number;
};

// Transient intent/receipt evidence, never credentials or financial authority.
// Only the host's fresh verified actor+tenant may select a checkpoint. No I/O,
// automatic replay, identity inference, or browser storage is performed here.
const recoveries = new Map<string, Recovery>();
let nextLease = 0;
const key = (userId: string | undefined, organizationId: string) => userId && organizationId ? JSON.stringify([userId, organizationId]) : undefined;
export const readPaymentRequestRecovery = (userId: string | undefined, organizationId: string) => {
  const identity = key(userId, organizationId);
  return identity ? recoveries.get(identity) : undefined;
};

export function bindPaymentRequestRecovery(userId: string | undefined, organizationId: string) {
  const identity = key(userId, organizationId), lease = ++nextLease;
  const existing = identity ? recoveries.get(identity) : undefined;
  if (existing) existing.lease = lease;
  return {
    begin(input: PaymentWorkspaceRecordInput, form: PaymentRequestForm) {
      if (identity) recoveries.set(identity, { input: structuredClone(input), form: structuredClone(form), unknown: false, lease });
    },
    settle(input: PaymentWorkspaceRecordInput, receipt?: PaymentsRecordResult, failureCode?: string): "receipt" | "initial_no_write" | "unknown" | "superseded" | "local" {
      if (!identity) return "local";
      const current = recoveries.get(identity);
      if (!current || current.lease !== lease || current.input.businessRequestId !== input.businessRequestId || current.receipt) return "superseded";
      if (receipt) { current.receipt = structuredClone(receipt); return "receipt"; }
      // A later declined retry cannot disprove a previous unknown outcome.
      if (failureCode === "STALE_STATE" && !current.unknown) { recoveries.delete(identity); return "initial_no_write"; }
      current.unknown = true;
      return "unknown";
    },
    release() {
      const current = identity ? recoveries.get(identity) : undefined;
      if (!current || current.lease !== lease) return;
      if (!current.receipt) current.unknown = true;
      current.lease = 0;
    },
  };
}
