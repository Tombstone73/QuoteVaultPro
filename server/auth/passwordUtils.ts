/**
 * Password utilities for standard authentication
 * 
 * Provides bcrypt password hashing and verification for AUTH_PROVIDER=standard.
 * Uses bcrypt cost factor 10 (recommended for production balance of security/performance).
 * 
 * SECURITY: Never log passwords or hashes. Never expose hashes in API responses.
 */

import bcrypt from 'bcryptjs';

// Bcrypt cost factor (2^10 = 1024 rounds)
// Higher = more secure but slower. 10 is recommended for most applications.
const SALT_ROUNDS = 10;

// Minimum password length for MVP (8 chars)
// Future: Add complexity requirements (uppercase, lowercase, numbers, symbols)
const MIN_PASSWORD_LENGTH = 8;

/**
 * Hash a plaintext password using bcrypt
 * 
 * @param password - Plaintext password to hash
 * @returns Promise<string> - Bcrypt hash string (60 characters)
 * @throws Error if password is empty or hashing fails
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.trim().length === 0) {
    throw new Error('Password cannot be empty');
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    return hash;
  } catch (error: any) {
    throw new Error(`Password hashing failed: ${error.message}`);
  }
}

/**
 * Verify a plaintext password against a bcrypt hash
 * 
 * @param password - Plaintext password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise<boolean> - True if password matches hash, false otherwise
 * @throws Error if inputs are invalid or verification fails
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    const isValid = await bcrypt.compare(password, hash);
    return isValid;
  } catch (error: any) {
    // Don't throw on comparison failure - return false instead
    // This prevents timing attacks and simplifies error handling
    console.error('[passwordUtils] Password verification error:', error.message);
    return false;
  }
}

/**
 * Validate password strength (MVP: minimum length only)
 * 
 * Returns validation result with success flag and error message if invalid.
 * 
 * Future enhancements:
 * - Require uppercase + lowercase
 * - Require at least one number
 * - Require at least one special character
 * - Check against common password lists
 * - Check for sequential characters (123, abc, etc.)
 * 
 * @param password - Password to validate
 * @returns Object with { valid: boolean, message?: string }
 */
export function validatePasswordStrength(password: string): { valid: boolean; message?: string } {
  if (!password) {
    return {
      valid: false,
      message: 'Password is required'
    };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
    };
  }

  // MVP: Only check length
  // Future: Add complexity requirements here
  
  return { valid: true };
}

/**
 * Generate a random secure password (for testing/admin tools)
 * 
 * Generates a cryptographically secure random password meeting strength requirements.
 * Uses crypto.randomBytes for true randomness.
 * 
 * @param length - Password length (default: 16)
 * @returns string - Random password
 */
export function generateSecurePassword(length: number = 16): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  const crypto = require('crypto');
  
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  
  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes[i] % charset.length;
    password += charset[randomIndex];
  }
  
  return password;
}
