import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("@/lib/apiConfig", () => ({ getApiUrl: (path: string) => path }));

import { apiCall } from "./useFulfillment";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({ success: true, data }),
    text: async () => "",
  } as Response;
}

describe("fulfillment apiCall request headers", () => {
  const fetchMock = jest.fn();
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    fetchMock.mockReset();
    (globalThis as any).fetch = originalFetch;
  });

  test("sends the JSON content type without custom headers", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    (globalThis as any).fetch = fetchMock;

    await apiCall("/api/fulfillment/ping", { method: "POST", body: "{}" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(init.credentials).toBe("include");
  });

  test("preserves JSON and idempotency headers for pickup handoffs", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ handoffId: "handoff-1" }));
    (globalThis as any).fetch = fetchMock;

    await apiCall("/api/fulfillment/pickup/ticket-1/handoffs", {
      method: "POST",
      headers: { "Idempotency-Key": "request-123" },
      body: JSON.stringify({ items: [{ orderLineItemId: "line-1", quantity: 200 }], clientRequestId: "request-123" }),
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("request-123");
    expect(init.method).toBe("POST");
  });

  test("allows a caller to intentionally override a default header", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    (globalThis as any).fetch = fetchMock;

    await apiCall("/api/fulfillment/export", { headers: { Accept: "text/csv", "Content-Type": "text/plain" } });

    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get("Accept")).toBe("text/csv");
    expect(headers.get("Content-Type")).toBe("text/plain");
  });
});
