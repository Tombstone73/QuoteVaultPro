/**
 * tokenHash.ts — shared SHA-256 hex-digest helper for secure token storage.
 *
 * Used by:
 *   - orgOnboardingService (create invite)
 *   - invites route (accept invite)
 *   - passwordResetTokens (existing usage, inline there)
 *
 * Rule: NEVER store a raw token. Always store sha256Hex(rawToken).
 */
import crypto from "crypto";

/** Returns the lowercase hex SHA-256 digest of a raw token string. */
export function sha256Hex(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
