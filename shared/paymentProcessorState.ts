export type PaymentProcessor = "none" | "stripe" | "eps";

export type PaymentProcessorReadiness = {
  provider: PaymentProcessor;
  stripeEnabled: boolean;
  stripeReady: boolean;
  epsEnabled: boolean;
  epsReady: boolean;
};

/** A persisted hosted-payment default never falls back to another processor. */
export function normalizePaymentProcessorDefault(input: PaymentProcessorReadiness): PaymentProcessor {
  if (input.provider === "stripe") {
    return input.stripeEnabled && input.stripeReady ? "stripe" : "none";
  }
  if (input.provider === "eps") {
    return input.epsEnabled && input.epsReady ? "eps" : "none";
  }
  return "none";
}
