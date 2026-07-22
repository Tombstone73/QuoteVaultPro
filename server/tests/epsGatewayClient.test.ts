import {
  buildHostedPtkRequest,
  EpsGatewayClient,
  formatCentsAsEpsAmount,
  normalizeEpsResponse,
  redactEpsPayload,
} from "../services/payments/epsGatewayClient";
import {
  PaymentProviderError,
  toSafePaymentSettings,
  validateEpsIdempotencyKey,
} from "../services/payments/paymentProviderSafety";

describe("EPS gateway client", () => {
  test("formats TitanOS cents as EPS decimal amount strings", () => {
    expect(formatCentsAsEpsAmount(0)).toBe("0.00");
    expect(formatCentsAsEpsAmount(52)).toBe("0.52");
    expect(formatCentsAsEpsAmount(2975)).toBe("29.75");
    expect(() => formatCentsAsEpsAmount(10.5)).toThrow("amountCents");
    expect(() => formatCentsAsEpsAmount(-1)).toThrow("amountCents");
  });

  test("maps hosted PTK requests to documented EPS getptk payload fields", () => {
    const payload = buildHostedPtkRequest({
      accountNumber: "1661825323",
      amountCents: 52,
      firstName: "John",
      lastName: "Doe",
      ticketId: "601",
      userId: "John",
      address: "123 Main Street",
      zip: "98029",
      email: "johndoe@example.com",
    });

    expect(payload).toEqual({
      method: "creditsale",
      account: "1661825323",
      paysource: "INTERNET",
      amount: "0.52",
      firstname: "John",
      lastname: "Doe",
      ticketid: "601",
      userid: "John",
      json: "no",
      address: "123 Main Street",
      zip: "98029",
      cvv: "yes",
      notifyemail1: "johndoe@example.com",
    });
  });

  test("normalizes hosted PTK and approved token responses", () => {
    expect(
      normalizeEpsResponse({
        success: "true",
        status: 200,
        message: "PTK Stored",
        data: { state: "STORED", ptk: "EokmyfhVcn76" },
      }),
    ).toMatchObject({
      approved: false,
      pending: true,
      status: "pending",
      ptk: "EokmyfhVcn76",
      responseMessage: "PTK Stored",
    });

    expect(
      normalizeEpsResponse({
        success: true,
        message: "PTK Generated",
        data: { state: "PTK", ptk: "nested-ptk-value" },
      }),
    ).toMatchObject({
      approved: false,
      pending: true,
      status: "pending",
      ptk: "nested-ptk-value",
      responseMessage: "PTK Generated",
    });

    expect(
      normalizeEpsResponse({
        TransactionResult: true,
        ResponseMsg: "Success",
        ApprovedAmount: "29.75",
        TransactionID: "19312981",
        AuthCode: "VTLMC1",
        CardType: "MASTERCARD",
        AccountNum: "0045",
        ResponseCode: "A0000",
        Method: "creditsale",
      }),
    ).toMatchObject({
      approved: true,
      pending: false,
      status: "approved",
      providerTransactionId: "19312981",
      approvedAmountCents: 2975,
      authCode: "VTLMC1",
      tokenLast4: "0045",
      cardType: "MASTERCARD",
      method: "creditsale",
    });
  });

  test("sends EPS API key in request header only", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: "true", message: "PTK Stored", data: { state: "STORED", ptk: "abc123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = new EpsGatewayClient({
      apiKey: "super-secret",
      accountNumber: "acct",
      fetchFn,
    });
    await client.getHostedPtk({ method: "creditsale", account: "acct", amount: "1.00" });

    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe("super-secret");
    expect(String(calls[0].init.body)).not.toContain("super-secret");
  });

  test("redacts PTK, token, card, and bank-like fields from safe payload metadata", () => {
    const redacted = redactEpsPayload({
      apikey: "secret-api-key",
      ptk: "EokmyfhVcn76",
      token: "tok_123456789",
      AccountNum: "4111111111111111",
      checkaccount: "123456789",
      checkrouting: "021000021",
      nested: { expirationdate: "12/29", cvv: "123" },
      amount: "29.75",
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("secret-api-key");
    expect(serialized).not.toContain("EokmyfhVcn76");
    expect(serialized).not.toContain("tok_123456789");
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("123456789");
    expect(serialized).toContain("29.75");
  });
});

describe("EPS payment provider safety", () => {
  test("safe settings DTO never exposes EPS API key", () => {
    const safe = toSafePaymentSettings({
      provider: "eps",
      epsEnabled: true,
      epsAccountNumber: "1661825323",
      epsApiKey: "secret-api-key",
      epsCnpBaseUrl: "https://postransactions.com/cnp",
      epsCardPresentBaseUrl: "https://postransactions.com/connet",
      epsAchBaseUrl: "https://postransactions.com/ach",
      epsGiftBaseUrl: "https://postransactions.com/gift",
      epsDeviceSerialNumber: "2290019197",
      epsSupportedModes: ["hosted_cnp"],
    } as any);

    expect((safe as any).epsApiKey).toBeUndefined();
    expect(safe.epsApiKeyConfigured).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("secret-api-key");
  });

  test("missing EPS settings return safe missing-field metadata", () => {
    const safe = toSafePaymentSettings({
      provider: "eps",
      epsEnabled: true,
      epsAccountNumber: "",
      epsApiKey: "",
      epsCnpBaseUrl: "https://postransactions.com/cnp",
      epsCardPresentBaseUrl: "https://postransactions.com/connet",
      epsAchBaseUrl: "https://postransactions.com/ach",
      epsGiftBaseUrl: "https://postransactions.com/gift",
      epsSupportedModes: ["hosted_cnp"],
    } as any);

    expect(safe.epsReady).toBe(false);
    expect(safe.missing).toEqual(expect.arrayContaining(["epsAccountNumber", "epsApiKey"]));
    expect(JSON.stringify(safe)).not.toContain("secret-api-key");
  });

  test("idempotency protection rejects missing or weak creation keys", () => {
    expect(validateEpsIdempotencyKey("eps-123456")).toBe("eps-123456");
    expect(() => validateEpsIdempotencyKey("")).toThrow(PaymentProviderError);
    expect(() => validateEpsIdempotencyKey("short")).toThrow("idempotencyKey is required");
  });
});
