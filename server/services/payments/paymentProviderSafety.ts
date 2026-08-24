import type { EpsMode } from "./epsGatewayClient";
import { normalizePaymentProcessorDefault } from "../../../shared/paymentProcessorState";

export type SafePaymentSettings = {
  provider: "none" | "stripe" | "eps";
  stripeEnabled: boolean;
  epsEnabled: boolean;
  epsAccountNumber: string | null;
  epsApiKeyConfigured: boolean;
  epsCnpBaseUrl: string;
  epsCardPresentBaseUrl: string;
  epsAchBaseUrl: string;
  epsGiftBaseUrl: string;
  epsDeviceSerialNumber: string | null;
  epsSupportedModes: EpsMode[];
  epsReady: boolean;
  missing: string[];
};

export class PaymentProviderError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, code = "PAYMENT_PROVIDER_ERROR", statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function defaultSafePaymentSettings(): SafePaymentSettings {
  return {
    provider: "none",
    stripeEnabled: false,
    epsEnabled: false,
    epsAccountNumber: null,
    epsApiKeyConfigured: false,
    epsCnpBaseUrl: "https://postransactions.com/cnp",
    epsCardPresentBaseUrl: "https://postransactions.com/connet",
    epsAchBaseUrl: "https://postransactions.com/ach",
    epsGiftBaseUrl: "https://postransactions.com/gift",
    epsDeviceSerialNumber: null,
    epsSupportedModes: ["hosted_cnp"],
    epsReady: false,
    missing: [],
  };
}

export function toSafePaymentSettings(row: Record<string, any> | null | undefined): SafePaymentSettings {
  if (!row) return defaultSafePaymentSettings();
  const supportedModes: EpsMode[] = Array.isArray(row.epsSupportedModes)
    ? row.epsSupportedModes.filter((mode: string): mode is EpsMode =>
        ["hosted_cnp", "token_cnp", "card_present", "ach", "gift_card"].includes(mode),
      )
    : ["hosted_cnp"];

  const configuredProvider = row.provider === "eps" || row.provider === "stripe" ? row.provider : "none";
  const epsMissing: string[] = [];
  if (!row.epsEnabled) epsMissing.push("epsEnabled");
  if (!asString(row.epsAccountNumber)) epsMissing.push("epsAccountNumber");
  if (!asString(row.epsApiKey)) epsMissing.push("epsApiKey");
  const provider = normalizePaymentProcessorDefault({
    provider: configuredProvider,
    stripeEnabled: Boolean(row.stripeEnabled),
    stripeReady: true,
    epsEnabled: Boolean(row.epsEnabled),
    epsReady: epsMissing.length === 0,
  });
  const missing = provider === "none"
    ? []
    : provider === "eps" || row.epsEnabled
      ? epsMissing
      : [];

  return {
    provider,
    stripeEnabled: Boolean(row.stripeEnabled),
    epsEnabled: Boolean(row.epsEnabled),
    epsAccountNumber: asString(row.epsAccountNumber) || null,
    epsApiKeyConfigured: Boolean(asString(row.epsApiKey)),
    epsCnpBaseUrl: asString(row.epsCnpBaseUrl) || "https://postransactions.com/cnp",
    epsCardPresentBaseUrl: asString(row.epsCardPresentBaseUrl) || "https://postransactions.com/connet",
    epsAchBaseUrl: asString(row.epsAchBaseUrl) || "https://postransactions.com/ach",
    epsGiftBaseUrl: asString(row.epsGiftBaseUrl) || "https://postransactions.com/gift",
    epsDeviceSerialNumber: asString(row.epsDeviceSerialNumber) || null,
    epsSupportedModes: supportedModes,
    epsReady: epsMissing.length === 0,
    missing,
  };
}

export function validateEpsIdempotencyKey(input: unknown): string {
  const key = asString(input);
  if (key.length < 8 || key.length > 160) {
    throw new PaymentProviderError("idempotencyKey is required and must be 8-160 characters.", "IDEMPOTENCY_KEY_REQUIRED", 400);
  }
  return key;
}
