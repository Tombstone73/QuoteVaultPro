import { encryptAiSecret } from "../services/ai/aiSecretsEncryption";
import { resolveActiveEpsCredentials, toSafePaymentSettings } from "../services/payments/paymentProvider.service";

describe("EPS test/live credentials", () => {
  beforeEach(() => { process.env.AI_SETTINGS_ENCRYPTION_KEY = "eps-test-encryption-key"; });

  test("uses only the active mode credentials", () => {
    const testSecret = encryptAiSecret("test-secret").encrypted;
    const liveSecret = encryptAiSecret("live-secret").encrypted;
    expect(resolveActiveEpsCredentials({ epsMode: "test", epsTestAccountNumber: "test-account", epsTestEncryptedApiKey: testSecret, epsTestBaseUrl: "https://test.example", epsLiveAccountNumber: "live-account", epsLiveEncryptedApiKey: liveSecret, epsLiveBaseUrl: "https://live.example" } as any)).toMatchObject({ mode: "test", accountNumber: "test-account", apiKey: "test-secret", baseUrl: "https://test.example" });
    expect(resolveActiveEpsCredentials({ epsMode: "live", epsTestAccountNumber: "test-account", epsTestEncryptedApiKey: testSecret, epsTestBaseUrl: "https://test.example", epsLiveAccountNumber: "live-account", epsLiveEncryptedApiKey: liveSecret, epsLiveBaseUrl: "https://live.example" } as any)).toMatchObject({ mode: "live", accountNumber: "live-account", apiKey: "live-secret", baseUrl: "https://live.example" });
  });

  test("safe settings expose test-mode status but never an API key", () => {
    const safe = toSafePaymentSettings({ provider: "eps", epsEnabled: true, epsMode: "test", epsTestAccountNumber: "test-account", epsTestEncryptedApiKey: encryptAiSecret("test-secret").encrypted, epsTestBaseUrl: "https://test.example", epsLiveAccountNumber: null, epsLiveEncryptedApiKey: null, epsLiveBaseUrl: "https://live.example", epsSupportedModes: ["hosted_cnp"] } as any);
    expect(safe.epsMode).toBe("test");
    expect(safe.epsReady).toBe(true);
    expect(JSON.stringify(safe)).not.toContain("test-secret");
    expect((safe as any).epsTestApiKey).toBeUndefined();
  });

  test("missing active credentials block readiness", () => {
    const safe = toSafePaymentSettings({ provider: "eps", epsEnabled: true, epsMode: "live", epsTestAccountNumber: "test-account", epsTestEncryptedApiKey: encryptAiSecret("test-secret").encrypted, epsLiveAccountNumber: null, epsLiveEncryptedApiKey: null, epsSupportedModes: ["hosted_cnp"] } as any);
    expect(safe.epsReady).toBe(false);
    expect(safe.missing).toEqual(expect.arrayContaining(["epsLiveAccountNumber", "epsLiveApiKey"]));
  });
});
