export type StripePaymentConfirmData = {
  paymentStatus: string;
  updated: boolean;
  invoice: unknown | null;
  rollup: unknown | null;
};

export type StripePaymentConfirmSuccessResponse = {
  success: true;
  data: StripePaymentConfirmData;
};

export type StripePaymentConfirmFailureResponse = {
  success: false;
  error: string;
  code?: string;
};

export type StripePaymentConfirmResponse = StripePaymentConfirmSuccessResponse | StripePaymentConfirmFailureResponse;

export function isStripePaymentConfirmSucceeded(value: unknown): value is StripePaymentConfirmSuccessResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<StripePaymentConfirmResponse>;
  const data = (response as StripePaymentConfirmSuccessResponse).data;
  return response.success === true && Boolean(data) && data.paymentStatus === "succeeded";
}
