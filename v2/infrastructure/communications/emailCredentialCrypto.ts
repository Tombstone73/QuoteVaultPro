import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const prefix = "email:v1";

export class EmailCredentialCryptoError extends Error {
  constructor(message: string) { super(message); this.name = "EmailCredentialCryptoError"; }
}

const rawKey = () => process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY?.trim()
  || process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEY?.trim()
  // Existing platform-secret infrastructure; this fallback allows secure
  // adoption without creating a new DEV configuration dependency.
  || process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim()
  || process.env.AI_ENCRYPTION_KEY?.trim()
  || "";
const keyId = () => process.env.EMAIL_INTEGRATION_ENCRYPTION_KEY_ID?.trim()
  || process.env.AI_SETTINGS_ENCRYPTION_KEY_ID?.trim()
  || "primary";
const key = () => {
  const raw = rawKey();
  if (!raw) throw new EmailCredentialCryptoError("Provider credential encryption is not configured.");
  const decoded = Buffer.from(raw, "base64");
  return decoded.length === 32 ? decoded : createHash("sha256").update(raw, "utf8").digest();
};

export const emailCredentialEncryptionConfigured = () => Boolean(rawKey());
export const encryptEmailCredential = (plaintext: string) => {
  if (!plaintext.trim()) throw new EmailCredentialCryptoError("Email credential cannot be empty.");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext.trim(), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { keyId: keyId(), encrypted: [prefix, keyId(), iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":") };
};
export const decryptEmailCredential = (envelope: string) => {
  const [kind, version, _id, iv, tag, ciphertext] = envelope.split(":");
  if (`${kind ?? ""}:${version ?? ""}` !== prefix || !_id || !iv || !tag || !ciphertext) throw new EmailCredentialCryptoError("Email credential envelope is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
};
