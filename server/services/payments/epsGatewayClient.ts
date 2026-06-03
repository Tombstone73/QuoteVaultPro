export type EpsMode = "hosted_cnp" | "token_cnp" | "card_present" | "ach" | "gift_card";

export type EpsClientConfig = {
  apiKey: string;
  accountNumber: string;
  cnpBaseUrl?: string;
  cardPresentBaseUrl?: string;
  achBaseUrl?: string;
  giftBaseUrl?: string;
  fetchFn?: typeof fetch;
};

export type EpsNormalizedResponse = {
  approved: boolean;
  pending: boolean;
  status: "approved" | "pending" | "failed";
  providerTransactionId: string | null;
  ptk: string | null;
  approvedAmountCents: number | null;
  authCode: string | null;
  responseCode: string | null;
  responseMessage: string | null;
  tokenLast4: string | null;
  cardType: string | null;
  method: string | null;
  rawSafe: Record<string, unknown>;
};

const DEFAULT_CNP_BASE_URL = "https://postransactions.com/cnp";
const DEFAULT_CARD_PRESENT_BASE_URL = "https://postransactions.com/connet";
const DEFAULT_ACH_BASE_URL = "https://postransactions.com/ach";
const DEFAULT_GIFT_BASE_URL = "https://postransactions.com/gift";

const SENSITIVE_KEY_PATTERN = /(apikey|api_key|ptk|cvv|card|pan|checkaccount|checkrouting|routing|accountnum|account_num|expiration|expdate|token)$/i;

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function buildUrl(base: string, path: string): string {
  return `${trimSlashes(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

export function formatCentsAsEpsAmount(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error("amountCents must be a non-negative integer");
  }
  return (amountCents / 100).toFixed(2);
}

export function parseEpsAmountToCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

export function epsLast4(value: unknown): string | null {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (!raw) return null;
  return raw.slice(-4);
}

export function redactEpsPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactEpsPayload(item));
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      const last4 = epsLast4(inner);
      out[key] = last4 ? `****${last4}` : "[REDACTED]";
    } else if (inner && typeof inner === "object") {
      out[key] = redactEpsPayload(inner);
    } else {
      out[key] = inner;
    }
  }
  return out;
}

function getString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function getBoolean(raw: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return null;
}

export function normalizeEpsResponse(input: unknown): EpsNormalizedResponse {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const data = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : {};
  const merged = { ...body, ...data };

  const successFlag = getBoolean(merged, ["TransactionResult", "success"]);
  const state = getString(merged, ["state"])?.toUpperCase() ?? null;
  const responseMessage = getString(merged, ["ResponseMsg", "message", "HostResponse"]) ?? null;
  const ptk = getString(merged, ["PTK", "ptk"]) ?? null;
  const providerTransactionId = getString(merged, ["TransactionID", "TransactionId", "transactionid", "TaskID"]) ?? null;
  const responseCode = getString(merged, ["ResponseCode", "responseCode"]) ?? null;
  const approvedAmountCents = parseEpsAmountToCents(getString(merged, ["ApprovedAmount", "amount"]));
  const authCode = getString(merged, ["AuthCode", "authCode"]) ?? null;
  const method = getString(merged, ["Method", "method"]) ?? null;
  const cardType = getString(merged, ["CardType", "cardType"]) ?? null;
  const tokenLast4 = epsLast4(getString(merged, ["AccountNum", "accountNum"]));

  const storedPtk = state === "STORED" && !!ptk;
  const approved =
    successFlag === true ||
    responseCode === "A0000" ||
    String(responseMessage || "").trim().toLowerCase() === "approval" ||
    String(responseMessage || "").trim().toLowerCase() === "success";
  const pending = storedPtk && !providerTransactionId;

  return {
    approved: approved && !pending,
    pending,
    status: pending ? "pending" : approved ? "approved" : "failed",
    providerTransactionId,
    ptk,
    approvedAmountCents,
    authCode,
    responseCode,
    responseMessage,
    tokenLast4,
    cardType,
    method,
    rawSafe: redactEpsPayload(merged) as Record<string, unknown>,
  };
}

export function buildHostedPtkRequest(input: {
  accountNumber: string;
  amountCents: number;
  ticketId: string;
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  address?: string | null;
  zip?: string | null;
}) {
  return {
    method: "creditsale",
    account: input.accountNumber,
    paysource: "INTERNET",
    amount: formatCentsAsEpsAmount(input.amountCents),
    firstname: input.firstName || "",
    lastname: input.lastName || "",
    ticketid: input.ticketId,
    userid: input.userId,
    json: "no",
    ...(input.address ? { address: input.address } : {}),
    ...(input.zip ? { zip: input.zip } : {}),
    cvv: "yes",
    ...(input.email ? { notifyemail1: input.email } : {}),
  };
}

export class EpsGatewayClient {
  private readonly fetchFn: typeof fetch;
  private readonly config: Required<Omit<EpsClientConfig, "fetchFn">>;

  constructor(config: EpsClientConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
    this.config = {
      apiKey: config.apiKey,
      accountNumber: config.accountNumber,
      cnpBaseUrl: config.cnpBaseUrl || DEFAULT_CNP_BASE_URL,
      cardPresentBaseUrl: config.cardPresentBaseUrl || DEFAULT_CARD_PRESENT_BASE_URL,
      achBaseUrl: config.achBaseUrl || DEFAULT_ACH_BASE_URL,
      giftBaseUrl: config.giftBaseUrl || DEFAULT_GIFT_BASE_URL,
    };
  }

  get hostedPaymentBaseUrl(): string {
    return buildUrl(this.config.cnpBaseUrl, "/cnp");
  }

  buildHostedPaymentUrl(ptk: string): string {
    const url = new URL(this.hostedPaymentBaseUrl);
    url.searchParams.set("ptk", ptk);
    return url.toString();
  }

  async getHostedPtk(payload: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    return this.postJson(buildUrl(this.config.cnpBaseUrl, "/getptk"), payload);
  }

  async tokenCnpRequest(payload: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    return this.postJson(buildUrl(this.config.cnpBaseUrl, "/request"), payload);
  }

  async achProcess(payload: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    return this.postJson(buildUrl(this.config.achBaseUrl, "/process"), payload);
  }

  async giftRequest(payload: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    return this.postJson(buildUrl(this.config.giftBaseUrl, "/requests"), payload);
  }

  async cardPresentTransact(params: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    const url = new URL(buildUrl(this.config.cardPresentBaseUrl, "/transact"));
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await this.fetchFn(url.toString(), {
      method: "GET",
      headers: { apikey: this.config.apiKey },
    });
    return this.parseResponse(response);
  }

  private async postJson(url: string, payload: Record<string, unknown>): Promise<EpsNormalizedResponse> {
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: this.config.apiKey,
      },
      body: JSON.stringify(payload),
    });
    return this.parseResponse(response);
  }

  private async parseResponse(response: Response): Promise<EpsNormalizedResponse> {
    const text = await response.text();
    let parsed: unknown = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { ResponseMsg: text };
      }
    }

    const normalized = normalizeEpsResponse(parsed);
    if (!response.ok) {
      return {
        ...normalized,
        approved: false,
        pending: false,
        status: "failed",
        responseCode: normalized.responseCode ?? String(response.status),
        responseMessage: normalized.responseMessage ?? response.statusText,
      };
    }

    return normalized;
  }
}
