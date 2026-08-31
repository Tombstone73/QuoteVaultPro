import assert from "node:assert/strict";
import { failure, success, V2ApplicationError } from "../../src/errors/applicationError.js";
import { StripeProviderIngress, type VerifiedStripeEvent } from "../../infrastructure/billing/stripeProviderIngress.js";

const paymentEvent = (id: string, operationId: string): VerifiedStripeEvent => ({
  id,
  type: "payment_intent.succeeded",
  created: 1_780_000_000,
  data: { object: { id: `pi_${operationId}`, metadata: { v2ProviderOperationId: operationId, v2OrganizationId: "org-a", v2InvoiceId: "invoice-a" } } },
});
const refundEvent = (id: string, operationId: string, paymentId: string): VerifiedStripeEvent => ({
  id,
  type: "refund.updated",
  created: 1_780_000_100,
  data: { object: { id: `re_${operationId}`, status: "succeeded", metadata: { v2ProviderOperationId: operationId, v2OrganizationId: "org-a", v2InvoiceId: "invoice-a", v2PaymentId: paymentId } } },
});

const run = async () => {
  const events = new Map<string, VerifiedStripeEvent>();
  const materializedPayments = new Map<string, string>();
  const materializedRefunds = new Map<string, string>();
  const calls: Array<{ kind: "payment" | "refund"; requestId: string; eventId: string; operationId: string }> = [];
  const ingress = new StripeProviderIngress({
    constructEvent(payload, signature) {
      assert.equal(signature, "sig_test", "the ingress must pass the provider signature to the verifier");
      const event = events.get(payload.toString("utf8"));
      if (!event) throw new V2ApplicationError("VALIDATION_ERROR", "Invalid test event.");
      return event;
    },
  }, {
    async confirmProviderPayment(context, input) {
      calls.push({ kind: "payment", requestId: context.businessRequest!.id, eventId: input.providerEventId, operationId: input.providerOperationId });
      const existing = materializedPayments.get(input.providerOperationId);
      const paymentId = existing ?? `payment-${materializedPayments.size + 1}`;
      materializedPayments.set(input.providerOperationId, paymentId);
      return success({ paymentId: paymentId as any, invoiceId: input.invoiceId, amount: { cents: 0, currency: "USD" as any }, method: "card" as const, source: "provider" as const, occurredAt: input.occurredAt });
    },
    async confirmProviderRefund(context, input) {
      calls.push({ kind: "refund", requestId: context.businessRequest!.id, eventId: input.providerEventId, operationId: input.providerOperationId });
      const existing = materializedRefunds.get(input.providerOperationId);
      const refundId = existing ?? `refund-${materializedRefunds.size + 1}`;
      materializedRefunds.set(input.providerOperationId, refundId);
      return success({ refundId: refundId as any, invoiceId: input.invoiceId, paymentId: input.paymentId, amount: { cents: 0, currency: "USD" as any }, source: "provider" as const, occurredAt: input.occurredAt });
    },
  } as any);

  events.set("partial-payment", paymentEvent("evt_payment_partial", "payment-op-partial"));
  events.set("remaining-payment", paymentEvent("evt_payment_remaining", "payment-op-remaining"));
  events.set("partial-refund", refundEvent("evt_refund_partial", "refund-op-partial", "payment-1"));
  events.set("remaining-refund", refundEvent("evt_refund_remaining", "refund-op-remaining", "payment-1"));

  await ingress.receive(Buffer.from("partial-payment"), "sig_test");
  await ingress.receive(Buffer.from("remaining-payment"), "sig_test");
  await ingress.receive(Buffer.from("partial-refund"), "sig_test");
  await ingress.receive(Buffer.from("remaining-refund"), "sig_test");
  await ingress.receive(Buffer.from("partial-payment"), "sig_test");

  assert.equal(materializedPayments.size, 2, "two separately-authorized partial/full payment operations materialize exactly two immutable facts");
  assert.equal(materializedRefunds.size, 2, "partial and completing refunds remain separate immutable refund facts");
  assert.equal(materializedPayments.get("payment-op-partial"), "payment-1", "a replay does not create a second payment fact");
  assert.deepEqual(calls.map((call) => call.requestId), ["stripe-webhook:evt_payment_partial", "stripe-webhook:evt_payment_remaining", "stripe-webhook:evt_refund_partial", "stripe-webhook:evt_refund_remaining", "stripe-webhook:evt_payment_partial"], "the Stripe event id is the durable V2 operation-request identity");
  assert.equal(calls.filter((call) => call.kind === "payment" && call.operationId === "payment-op-partial").length, 2, "replayed provider deliveries are delegated to the V2 idempotency boundary");

  events.set("missing-metadata", { id: "evt_missing", type: "payment_intent.succeeded", data: { object: { id: "pi_missing", metadata: {} } } });
  assert.deepEqual(await ingress.receive(Buffer.from("missing-metadata"), "sig_test"), { disposition: "ignored", eventId: "evt_missing" }, "an event cannot mutate V2 finance without V2-owned operation metadata");
  await assert.rejects(() => ingress.receive(Buffer.from("partial-payment"), "wrong-signature"), /signature/i, "signature verification fails before finance mutation");

  const directEvents = new Map<string, VerifiedStripeEvent>();
  const directIngress = new StripeProviderIngress({ constructEvent: (payload) => directEvents.get(payload.toString())! }, {
    async confirmProviderPayment() { return success({ paymentId:"payment-direct" as any,invoiceId:"invoice-a" as any,amount:{cents:1,currency:"USD" as any},method:"card",source:"provider",occurredAt:new Date().toISOString() }); },
    async confirmProviderRefund() { return failure(new V2ApplicationError("INTERNAL_ERROR","not used")); },
  } as any, { async assertOperationAccount(organizationId, operationId, accountId) { assert.equal(organizationId,"org-a"); assert.equal(operationId,"direct-op"); assert.equal(accountId,"acct_direct"); } });
  directEvents.set("direct", { ...paymentEvent("evt_direct","direct-op"), account:"acct_direct", data:{object:{id:"pi_direct",metadata:{v2ProviderOperationId:"direct-op",v2OrganizationId:"org-a",v2InvoiceId:"invoice-a",v2StripeAccountId:"acct_direct"}}} });
  await directIngress.receive(Buffer.from("direct"), "sig");
  directEvents.set("wrong-account", { ...directEvents.get("direct")!, id:"evt_wrong", account:"acct_other" });
  await assert.rejects(() => directIngress.receive(Buffer.from("wrong-account"), "sig"), /conflicts/i, "a connected-account event cannot cross a tenant operation boundary");
};

void run().then(() => console.log("[stripe-provider-ingress] pure verification passed"));
