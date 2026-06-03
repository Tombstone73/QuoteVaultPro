import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const ENVELOPE_VERSION = "v1";

export class AiSecretEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSecretEncryptionError";
  }
}

function getRawKey(): string {
  return (
    process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim() ||
    process.env.AI_ENCRYPTION_KEY?.trim() ||
    ""
  );
}

function getKeyId(): string {
  return process.env.AI_SETTINGS_ENCRYPTION_KEY_ID?.trim() || "primary";
}

function deriveKey(raw: string): Buffer {
  if (!raw) {
    throw new AiSecretEncryptionError("AI settings encryption key is not configured.");
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isAiSecretEncryptionConfigured(): boolean {
  return Boolean(getRawKey());
}

export function encryptAiSecret(plaintext: string): { encrypted: string; keyId: string } {
  const trimmed = plaintext.trim();
  if (!trimmed) {
    throw new AiSecretEncryptionError("AI secret cannot be empty.");
  }

  const keyId = getKeyId();
  const key = deriveKey(getRawKey());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    keyId,
    encrypted: [
      ENVELOPE_VERSION,
      keyId,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":"),
  };
}

export function decryptAiSecret(envelope: string): string {
  const [version, _keyId, ivText, tagText, ciphertextText] = envelope.split(":");
  if (version !== ENVELOPE_VERSION || !ivText || !tagText || !ciphertextText) {
    throw new AiSecretEncryptionError("AI secret envelope is invalid.");
  }

  const key = deriveKey(getRawKey());
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function getSecretLast4(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.slice(Math.max(0, trimmed.length - 4));
}
