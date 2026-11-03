import { afterEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { EPS_CALLBACK_MAX_BODY_BYTES, EPS_CALLBACK_PATH, registerEpsCallbackRoutes } from "../routes/epsCallback.routes";
import { buildHostedPtkRequest } from "../services/payments/epsGatewayClient";
import { configuredEpsHostedUrls } from "../services/payments/epsHostedUrls";

function app() {
  const result = express();
  result.set("trust proxy", 1);
  registerEpsCallbackRoutes(result);
  result.use(express.json({ limit: "5mb" }));
  return result;
}

afterEach(() => { jest.restoreAllMocks(); });

describe("unverified EPS callback boundary", () => {
  test.each([
    { TransactionResult: true, TransactionID: "untrusted", ApprovedAmount: "100.00" },
    { TransactionResult: false, TransactionID: "declined-looking" },
    { status: "pending" },
    { paymentId: "unknown", organizationId: "foreign", BusinessId: "wrong-merchant", amount: "999.99" },
  ])("does not interpret or accept an undocumented JSON result %#", async payload => {
    const response = await request(app()).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").send(payload);
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ success: false, code: "EPS_CALLBACK_VERIFICATION_UNAVAILABLE", reference: expect.any(String) });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(response.body)).not.toContain("untrusted");
  });

  test("retries, duplicates and out-of-order claims never promote an unverified result", async () => {
    const target = app();
    for (const body of [{ result: "approved" }, { result: "pending" }, { result: "declined" }, { result: "approved" }]) {
      const response = await request(target).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").send(body);
      expect(response.status).toBe(503);
    }
  });

  test("browser redirects and guessed authentication headers grant no financial authority", async () => {
    const target = app();
    const redirected = await request(target).get(EPS_CALLBACK_PATH + "?success=true&paymentId=unknown");
    expect(redirected.status).toBe(405);
    expect(redirected.headers.allow).toBe("POST");
    const forged = await request(target).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https")
      .set("Authorization", "Bearer attacker").set("apikey", "attacker").set("X-EPS-Signature", "guessed").send({ approved: true });
    expect(forged.status).toBe(503);
  });

  test("requires HTTPS and the only confirmed content type", async () => {
    expect((await request(app()).post(EPS_CALLBACK_PATH).send({})).status).toBe(426);
    expect((await request(app()).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").type("form").send("result=approved")).status).toBe(415);
  });

  test("caps the raw body before the application's larger parser; malformed/scalar/array JSON stays safe", async () => {
    const target = app();
    const tooLarge = await request(target).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").send({ value: "x".repeat(EPS_CALLBACK_MAX_BODY_BYTES) });
    expect(tooLarge.status).toBe(413);
    for (const body of ['{"secret":"PRIVATE",', '"PRIVATE"', '[]', 'null']) {
      const response = await request(target).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").type("json").send(body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain("PRIVATE");
    }
    const compressed = await request(target).post(EPS_CALLBACK_PATH).set("X-Forwarded-Proto", "https").set("Content-Encoding", "gzip").type("json").send(gzipSync(Buffer.from('{}')));
    expect(compressed.status).toBe(415);
  });

  test("logs structural rejection metadata only, never card data, credentials or URLs", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await request(app()).post(EPS_CALLBACK_PATH + "?private=QUERY_SECRET").set("X-Forwarded-Proto", "https")
      .set("Authorization", "Bearer HEADER_SECRET").send({ card: "4111111111111111", cvv: "123", apiKey: "BODY_SECRET" });
    expect(response.status).toBe(503);
    const logged = JSON.stringify(warn.mock.calls);
    for (const value of ["QUERY_SECRET", "HEADER_SECRET", "BODY_SECRET", "4111111111111111"]) expect(logged).not.toContain(value);
    expect(warn).toHaveBeenCalledWith("[EPS_CALLBACK]", { reference: expect.any(String), stage: "verification", category: "contract_unavailable", posted: false });
  });

  test("production registration precedes the application's JSON parser and logging", () => {
    const source = readFileSync("server/index.ts", "utf8");
    expect(source.indexOf("registerEpsCallbackRoutes(app)")).toBeLessThan(source.indexOf("app.use(express.json("));
    expect(source.indexOf("registerEpsCallbackRoutes(app)")).toBeLessThan(source.indexOf("capturedJsonResponse"));
  });
});

describe("confirmed getptk URL fields", () => {
  const base = { accountNumber: "fixture-merchant", amountCents: 500, ticketId: "fixture-invoice", userId: "fixture-staff" };
  test("forwards exact lowercase vendor fields without treating redirects as approval", () => {
    const fields = buildHostedPtkRequest({ ...base, hostedUrls: configuredEpsHostedUrls({
      EPS_HOSTED_SUCCESS_URL: "https://dev.example.invalid/return?outcome=success",
      EPS_HOSTED_FAILURE_URL: "https://dev.example.invalid/return?outcome=failure",
      EPS_HOSTED_RESPONSE_URL: "https://api-dev.example.invalid/api/payments/eps/response",
    }) });
    expect(fields).toMatchObject({ successurl: "https://dev.example.invalid/return?outcome=success", failureurl: "https://dev.example.invalid/return?outcome=failure", responseurl: "https://api-dev.example.invalid/api/payments/eps/response", amount: "5.00" });
    expect(fields).not.toHaveProperty("approved");
  });
  test("absent URL configuration preserves the existing hosted flow", () => {
    const fields = buildHostedPtkRequest({ ...base, hostedUrls: configuredEpsHostedUrls({}) });
    for (const key of ["successurl", "failureurl", "responseurl"]) expect(fields).not.toHaveProperty(key);
  });
  test.each(["http://example.invalid/callback", "javascript:alert(1)", "https://user:PRIVATE@example.invalid/", "https://example.invalid/#PRIVATE"])("rejects unsafe destination without echoing it: %s", url => {
    expect(() => buildHostedPtkRequest({ ...base, hostedUrls: { responseUrl: url } })).toThrow("EPS hosted destinations must be HTTPS");
    try { buildHostedPtkRequest({ ...base, hostedUrls: { responseUrl: url } }); } catch (error) { expect(String(error)).not.toContain("PRIVATE"); }
  });
});
