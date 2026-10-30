import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import request from "supertest";
import { google } from "googleapis";
import { registerInboundOrderRoutes } from "../routes/inboundOrders.routes";
import { getInboundGmailRedirectUri, getEmailSettingsRedirectUrl, INBOUND_GMAIL_CALLBACK_PATH as callback } from "../lib/inboundGmailOAuthUrls";

const envKeys = ["SESSION_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "APP_URL", "APP_PUBLIC_WEB_ORIGIN", "GOOGLE_INBOUND_OAUTH_REDIRECT_URI"];
let saved: Record<string, string | undefined>;
const connected = { id: "mailbox_1", enabled: false, authJson: { refreshToken: "existing-valid-token" } };
const connectGmailMailbox = jest.fn<(...args: any[]) => Promise<any>>();

function app(role = "admin") {
  const app = express();
  registerInboundOrderRoutes(app, {
    isAuthenticated: (req: any, _res: any, next: any) => { req.user = { id: "staff_1" }; next(); },
    tenantContext: (req: any, _res: any, next: any) => { req.organizationId = "tenant_1"; req.actorOrgRole = role; next(); },
    assertInternalUser: () => true,
    inboundEmailMailboxSettingsService: { connectGmailMailbox } as any,
  });
  app.use((_req, res) => { res.status(200).type("html").send("SPA_SENTINEL"); });
  return app;
}
async function start(instance = app()) {
  const response = await request(instance).get(`${callback.replace(/callback$/, "start")}?reconnectMailboxId=mailbox_1`);
  expect(response.status).toBe(200);
  return new URL(response.body.data.url);
}
const returnUrl = (response: any) => new URL(response.headers.location);

beforeEach(() => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SESSION_SECRET: "synthetic-session-secret", GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-secret", APP_URL: "https://dev.printershero.com" });
  delete process.env.APP_PUBLIC_WEB_ORIGIN;
  delete process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI;
  connectGmailMailbox.mockReset().mockResolvedValue(connected);
  // Fail closed at both Google boundaries even if a security regression calls them.
  jest.spyOn(google.auth.OAuth2.prototype, "getToken").mockImplementation((async () => { throw new Error("Unstubbed test OAuth request"); }) as any);
  jest.spyOn(google, "oauth2").mockImplementation(() => { throw new Error("Unstubbed test profile request"); });
});
afterEach(() => {
  for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  jest.restoreAllMocks();
});

describe("inbound Gmail backend callback", () => {
  test.each([
    ["https://dev.printershero.com", "https://api-dev.printershero.com"],
    ["https://www.printershero.com", "https://api.printershero.com"],
    ["https://printershero.com", "https://api.printershero.com"],
  ])("%s constructs the environment's backend callback", async (web, api) => {
    process.env.APP_URL = web;
    const url = await start();
    expect(url.searchParams.get("redirect_uri")).toBe(api + callback);
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).not.toContain("gmail.modify");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  test("public web runtime contract takes precedence over legacy APP_URL", async () => {
    process.env.APP_PUBLIC_WEB_ORIGIN = "https://dev.printershero.com";
    process.env.APP_URL = "https://www.printershero.com";
    expect((await start()).searchParams.get("redirect_uri")).toBe("https://api-dev.printershero.com" + callback);
    expect(getEmailSettingsRedirectUrl({})).toBe("https://dev.printershero.com/settings/email");
  });

  test.each([
    "https://dev.printershero.com" + callback,
    "https://api.printershero.com" + callback,
    "https://api-dev.printershero.com/wrong",
    "https://user:secret@api-dev.printershero.com" + callback,
    "https://api-dev.printershero.com" + callback + "?code=secret",
  ])("fails closed for incompatible configured callback %s", async value => {
    process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI = value;
    expect((await request(app()).get(callback.replace(/callback$/, "start"))).status).toBe(503);
    expect(connectGmailMailbox).not.toHaveBeenCalled();
  });

  test("supports explicit correct callback and local same-server development", () => {
    process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI = "https://api-dev.printershero.com" + callback;
    expect(getInboundGmailRedirectUri({})).toBe(process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI);
    delete process.env.GOOGLE_INBOUND_OAUTH_REDIRECT_URI;
    delete process.env.APP_URL;
    expect(getInboundGmailRedirectUri({ protocol: "http", get: () => "localhost:5000" })).toBe("http://localhost:5000" + callback);
  });

  test.each(["", "?state=invalid", "?state=x&state=y&code=secret", "?code=secret"]) ("invalid callback %s is controlled before SPA fallback", async query => {
    const response = await request(app()).get(callback + query);
    expect(response.status).toBe(302);
    expect(returnUrl(response).pathname).toBe("/settings/email");
    expect(returnUrl(response).searchParams.get("inboundGmailError")).toMatch(/^invalid_/);
    expect(response.text).not.toContain("SPA_SENTINEL");
    expect(response.text).not.toContain("secret");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(connectGmailMailbox).not.toHaveBeenCalled();
  });

  test("valid state still requires code and preserves the existing connection", async () => {
    const state = (await start()).searchParams.get("state")!;
    const response = await request(app()).get(callback).query({ state });
    expect(returnUrl(response).searchParams.get("inboundGmailError")).toBe("missing_code");
    expect(connectGmailMailbox).not.toHaveBeenCalled();
    expect(connected.authJson.refreshToken).toBe("existing-valid-token");
  });

  test("expired and tampered tenant state cannot exchange codes", async () => {
    const state = (await start()).searchParams.get("state")!;
    const exchange = jest.spyOn(google.auth.OAuth2.prototype, "getToken");
    const pieces = state.split(":");
    pieces[1] = Buffer.from(JSON.stringify({ organizationId: "foreign_tenant" })).toString("base64url");
    for (const invalid of [pieces.join(":"), state.replace(/[^:]+$/, "😀".repeat(16))]) {
      const response = await request(app()).get(callback).query({ state: invalid, code: "secret-code" });
      expect(returnUrl(response).searchParams.get("inboundGmailError")).toBe("invalid_state");
    }
    const now = Date.now(); jest.spyOn(Date, "now").mockReturnValue(now + 31 * 60_000);
    const response = await request(app()).get(callback).query({ state, code: "secret-code" });
    expect(returnUrl(response).searchParams.get("inboundGmailError")).toBe("invalid_state");
    expect(exchange).not.toHaveBeenCalled();
    expect(connectGmailMailbox).not.toHaveBeenCalled();
  });

  test("denial validates state and returns only a safe known error", async () => {
    const state = (await start()).searchParams.get("state")!;
    for (const [error, expected] of [["access_denied", "cancelled"], ["provider-secret-error", "authorization_failed"]]) {
      const response = await request(app()).get(callback).query({ state, error });
      expect(returnUrl(response).searchParams.get("inboundGmailError")).toBe(expected);
      expect(response.text).not.toContain("provider-secret-error");
    }
    expect(connectGmailMailbox).not.toHaveBeenCalled();
  });

  test("exchange failure logs no provider payload and leaves the connection intact", async () => {
    const state = (await start()).searchParams.get("state")!;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(google.auth.OAuth2.prototype, "getToken").mockImplementation((async () => { throw new Error("sensitive-code-token-body"); }) as any);
    const response = await request(app()).get(callback).query({ state, code: "sensitive-code" });
    expect(returnUrl(response).searchParams.get("inboundGmailError")).toBe("token_exchange_failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive");
    expect(connectGmailMailbox).not.toHaveBeenCalled();
  });

  test("verified reconnect uses signed tenant/actor/mailbox and returns to settings only after storage", async () => {
    const state = (await start()).searchParams.get("state")!;
    const exchange = jest.spyOn(google.auth.OAuth2.prototype, "getToken").mockImplementation((async () => ({ tokens: { refresh_token: "new-token", scope: "gmail.readonly" } })) as any);
    jest.spyOn(google, "oauth2").mockReturnValue({ userinfo: { get: async () => ({ data: { email: "synthetic@example.com", verified_email: true } }) } } as any);
    const response = await request(app()).get(callback).query({ state, code: "synthetic-code" });
    expect(exchange).toHaveBeenCalledWith("synthetic-code");
    expect(connectGmailMailbox).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "tenant_1", actorUserId: "staff_1", reconnectMailboxId: "mailbox_1", redirectUri: "https://api-dev.printershero.com" + callback }));
    expect(returnUrl(response).toString()).toBe("https://dev.printershero.com/settings/email?inboundGmailConnected=true");
    connectGmailMailbox.mockRejectedValue(Object.assign(new Error("sensitive-db-error"), { statusCode: 404 }));
    const failed = await request(app()).get(callback).query({ state, code: "synthetic-code" });
    expect(returnUrl(failed).searchParams.get("inboundGmailError")).toBe("mailbox_not_found");
    expect(returnUrl(failed).searchParams.has("inboundGmailConnected")).toBe(false);
  });

  test("non-admin cannot initiate reconnect", async () => {
    expect((await request(app("employee")).get(callback.replace(/callback$/, "start"))).status).toBe(403);
  });

  test("missing refresh token and unverified profile never replace an existing connection", async () => {
    const state = (await start()).searchParams.get("state")!;
    const exchange = jest.spyOn(google.auth.OAuth2.prototype, "getToken").mockImplementation((async () => ({ tokens: {} })) as any);
    const missing = await request(app()).get(callback).query({ state, code: "synthetic-code" });
    expect(returnUrl(missing).searchParams.get("inboundGmailError")).toBe("no_refresh_token");
    exchange.mockImplementation((async () => ({ tokens: { refresh_token: "new-token" } })) as any);
    jest.spyOn(google, "oauth2").mockReturnValue({ userinfo: { get: async () => ({ data: { email: "synthetic@example.com", verified_email: false } }) } } as any);
    const unverified = await request(app()).get(callback).query({ state, code: "synthetic-code" });
    expect(returnUrl(unverified).searchParams.get("inboundGmailError")).toBe("profile_lookup_failed");
    expect(connectGmailMailbox).not.toHaveBeenCalled();
    expect(connected.authJson.refreshToken).toBe("existing-valid-token");
  });
});
