import { describe, expect, test, beforeEach } from "@jest/globals";
import { decryptAiSecret, encryptAiSecret, isAiSecretEncryptionConfigured } from "../services/ai/aiSecretsEncryption";

describe("AI secret encryption", () => {
  beforeEach(() => {
    process.env.AI_SETTINGS_ENCRYPTION_KEY = "test-encryption-key";
    process.env.AI_SETTINGS_ENCRYPTION_KEY_ID = "test-key";
  });

  test("encrypts and decrypts API keys without storing plaintext", () => {
    const secret = "sk-test-secret-value";
    const encrypted = encryptAiSecret(secret);

    expect(encrypted.keyId).toBe("test-key");
    expect(encrypted.encrypted).not.toContain(secret);
    expect(decryptAiSecret(encrypted.encrypted)).toBe(secret);
  });

  test("reports missing encryption configuration", () => {
    delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
    delete process.env.AI_ENCRYPTION_KEY;

    expect(isAiSecretEncryptionConfigured()).toBe(false);
    expect(() => encryptAiSecret("sk-test")).toThrow("AI settings encryption key is not configured");
  });
});
