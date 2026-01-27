/**
 * Password Reset Service
 * 
 * Handles forgot/reset password flow with secure token management:
 * - Tokens are random 32-byte hex strings (64 characters)
 * - Stored as SHA256 hashes (never plaintext)
 * - Single-use (used_at tracking)
 * - 60-minute expiry
 * - Email delivery via existing emailService
 * 
 * SECURITY:
 * - Never log tokens or hashes
 * - Always return generic success messages (no email enumeration)
 * - Require org membership for password reset
 */

import crypto from 'crypto';
import { db } from '../db';
import { users, passwordResetTokens, authIdentities, userOrganizations } from '@shared/schema';
import { eq, and, sql, gt } from 'drizzle-orm';
import { hashPassword } from './passwordUtils';
import { emailService } from '../emailService';

const TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const TOKEN_EXPIRY_MINUTES = 60;

/**
 * Generate a cryptographically secure random token
 * 
 * @returns { token: string, tokenHash: string }
 */
function generateToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(TOKEN_LENGTH).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Hash a token for database lookup
 * 
 * @param token - Raw token string
 * @returns SHA256 hash of token
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Request password reset for a user
 * 
 * Flow:
 * 1. Lookup user by email (case-insensitive)
 * 2. Check org membership (multi-tenant safety)
 * 3. Ensure password identity exists (upsert if needed)
 * 4. Create reset token (expires in 60 minutes)
 * 5. Send email with reset link
 * 
 * SECURITY: Always returns success (no email enumeration)
 * 
 * @param email - User email address
 * @param requestId - Optional request ID for logging/tracking
 * @returns Promise<{ success: true }>
 */
export async function requestPasswordReset(
  email: string,
  requestId?: string
): Promise<{ success: true }> {
  try {
    const logPrefix = requestId ? `[passwordReset:${requestId}]` : '[passwordReset]';

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Lookup user (case-insensitive)
    const userResult = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = ${normalizedEmail}`)
      .limit(1);

    const user = userResult[0];

    if (!user) {
      // Don't leak whether email exists - return success but log
      console.log(`${logPrefix} User not found for email: ${normalizedEmail}`);
      return { success: true };
    }

    // Check org membership (multi-tenant safety)
    const memberships = await db
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.userId, user.id))
      .limit(1);

    if (memberships.length === 0) {
      console.log(`${logPrefix} User ${user.id} has no org memberships - blocking reset`);
      return { success: true }; // Don't leak membership info
    }

    // Ensure password identity exists (create if missing)
    // Use upsert: if user only had OAuth, create password identity for them
    await db
      .insert(authIdentities)
      .values({
        userId: user.id,
        provider: 'password',
        passwordHash: null, // Will be set when they reset
        passwordSetAt: null,
      })
      .onConflictDoNothing();

    // Generate reset token
    const { token, tokenHash } = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000);

    // Store token hash in database
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    // Send reset email
    const resetUrl = `${process.env.APP_URL || 'http://localhost:5000'}/reset-password?token=${token}`;
    
    // Get user's organization for email config
    const orgId = memberships[0].organizationId;

    try {
      await emailService.sendEmail(orgId, {
        to: user.email!,
        subject: 'Password Reset Request - QuoteVaultPro',
        html: `
<p>Hello${user.firstName ? ` ${user.firstName}` : ''},</p>
<p>You requested a password reset for your QuoteVaultPro account.</p>
<p><a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0066cc; color: white; text-decoration: none; border-radius: 4px;">Reset Password</a></p>
<p>Or copy and paste this link into your browser:<br>${resetUrl}</p>
<p>This link will expire in ${TOKEN_EXPIRY_MINUTES} minutes.</p>
<p>If you didn't request this reset, you can safely ignore this email.</p>
<p>Best regards,<br>QuoteVaultPro Team</p>
        `.trim(),
      });

      console.log(`${logPrefix} Password reset email sent to ${user.email}`);
    } catch (emailError: any) {
      console.error(`${logPrefix} Failed to send reset email:`, emailError.message);
      // Don't throw - email failure shouldn't break reset flow
      // User can retry if needed
    }
  } catch (error: any) {
    // Log error but don't expose to user
    console.error('[passwordReset] Error processing reset request:', error.message);
    // Still return success to prevent enumeration
  }

  return { success: true };
}

/**
 * Reset password using token
 * 
 * Flow:
 * 1. Hash token and lookup in database
 * 2. Validate: not expired, not used, exists
 * 3. Mark token as used (single-use enforcement)
 * 4. Hash new password
 * 5. Upsert password identity
 * 6. Return success
 * 
 * @param token - Raw reset token from email link
 * @param newPassword - New plaintext password
 * @returns Promise<{ success: boolean; message?: string; userId?: string }>
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<{ success: boolean; message?: string; userId?: string }> {
  try {
    // Hash token for lookup
    const tokenHash = hashToken(token);

    // Lookup token (must be unused and not expired)
    const tokenResult = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          eq(passwordResetTokens.usedAt, null), // Not used
          gt(passwordResetTokens.expiresAt, new Date()) // Not expired
        )
      )
      .limit(1);

    const resetToken = tokenResult[0];

    if (!resetToken) {
      return {
        success: false,
        message: 'Invalid or expired reset token. Please request a new password reset.',
      };
    }

    // Mark token as used (single-use)
    await db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, resetToken.id));

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Upsert password identity
    await db
      .insert(authIdentities)
      .values({
        userId: resetToken.userId,
        provider: 'password',
        passwordHash,
        passwordSetAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [authIdentities.userId, authIdentities.provider],
        set: {
          passwordHash,
          passwordSetAt: new Date(),
          updatedAt: new Date(),
        },
      });

    console.log(`[passwordReset] Password reset successfully for user ${resetToken.userId}`);

    return {
      success: true,
      userId: resetToken.userId,
    };
  } catch (error: any) {
    console.error('[passwordReset] Error resetting password:', error.message);
    return {
      success: false,
      message: 'Failed to reset password. Please try again.',
    };
  }
}

/**
 * Clean up expired reset tokens (maintenance task)
 * 
 * Call this periodically (e.g., daily cron job) to remove old tokens.
 * 
 * @returns Promise<number> - Number of deleted tokens
 */
export async function cleanupExpiredTokens(): Promise<number> {
  try {
    const result = await db
      .delete(passwordResetTokens)
      .where(sql`${passwordResetTokens.expiresAt} < NOW()`)
      .returning();

    const deletedCount = result.length;
    console.log(`[passwordReset] Cleaned up ${deletedCount} expired tokens`);
    return deletedCount;
  } catch (error: any) {
    console.error('[passwordReset] Error cleaning up tokens:', error.message);
    return 0;
  }
}
