import { getPrintAgentRealtimeConfiguration, getPrintAgentWakeTopic, publishPrintAgentWake } from "../services/printAgentWake";
import { jest } from "@jest/globals";

const tokenHash = "a".repeat(64);
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-only-on-server",
};

describe("Print Agent Supabase wake publisher", () => {
  test("returns only the public subscription configuration to an agent", () => {
    expect(getPrintAgentRealtimeConfiguration(env)).toEqual({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
    expect(JSON.stringify(getPrintAgentRealtimeConfiguration(env))).not.toContain("service-role");
  });

  test("uses a unique high-entropy agent capability topic", () => {
    expect(getPrintAgentWakeTopic(tokenHash)).toBe(`printershero:traveler-wake:${tokenHash}`);
    expect(getPrintAgentWakeTopic("b".repeat(64))).not.toBe(getPrintAgentWakeTopic(tokenHash));
    expect(() => getPrintAgentWakeTopic("not-a-token-hash")).toThrow("Invalid Print Agent token identity");
  });

  test("publishes a data-free queue_changed wake with a bounded retry", async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const wake = await publishPrintAgentWake(tokenHash, { env, fetchImpl: fetchImpl as any, sleep: async () => undefined });
    expect(wake).toEqual({ published: true, attempts: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("/realtime/v1/api/broadcast/");
    expect(String(url)).not.toContain("service-role-only-on-server");
    expect(options.body).toBe(JSON.stringify({ type: "queue_changed" }));
    expect(options.body).not.toContain(tokenHash);
  });

  test("does not turn a durable job into a failure when realtime is not configured", async () => {
    await expect(publishPrintAgentWake(tokenHash, { env: {} })).resolves.toEqual({ published: false, attempts: 0, reason: "realtime_not_configured" });
  });
});
