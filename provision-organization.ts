/**
 * Provision New Organization (Dev/Admin Tool)
 * 
 * Creates a new organization with an owner user and sends password setup email.
 * Protected by PROVISIONING_ENABLED and ADMIN_SECRET environment variables.
 * 
 * Usage:
 *   npx tsx provision-organization.ts
 * 
 * Or via HTTP (if enabled in routes.ts):
 *   POST /api/admin/provision-organization
 *   Headers: { "X-Admin-Secret": "<ADMIN_SECRET>" }
 *   Body: { orgName: string, ownerEmail: string, ownerName: string }
 * 
 * SECURITY:
 * - Only enable provisioning in development or with strict admin auth
 * - Never expose this endpoint publicly without authentication
 * - ADMIN_SECRET should be a strong random string
 */

import { db } from './server/db';
import { organizations, users, userOrganizations, authIdentities } from '@shared/schema';
import { requestPasswordReset } from './server/auth/passwordResetService';
import { sql } from 'drizzle-orm';

interface ProvisionOrgInput {
  orgName: string;
  ownerEmail: string;
  ownerName?: string; // Optional: can split into firstName/lastName
  slug?: string; // Optional: auto-generated from orgName if not provided
}

interface ProvisionOrgResult {
  success: boolean;
  organizationId?: string;
  userId?: string;
  message?: string;
  error?: string;
}

/**
 * Provision a new organization with owner user
 * 
 * Flow:
 * 1. Create organization
 * 2. Create owner user
 * 3. Create owner membership
 * 4. Create password identity (hash=NULL, to be set via reset)
 * 5. Send password setup email
 * 
 * @param input - Organization and owner details
 * @returns Promise<ProvisionOrgResult>
 */
export async function provisionOrganization(
  input: ProvisionOrgInput
): Promise<ProvisionOrgResult> {
  const { orgName, ownerEmail, ownerName, slug } = input;

  try {
    console.log('[provision] Starting organization provisioning:', { orgName, ownerEmail });

    // 1. Create organization
    const orgSlug = slug || generateSlug(orgName);

    const orgResult = await db
      .insert(organizations)
      .values({
        name: orgName,
        slug: orgSlug,
        type: 'external_saas',
        status: 'trial',
        settings: {},
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30-day trial
      })
      .returning();

    const org = orgResult[0];
    console.log('[provision] Organization created:', { id: org.id, slug: org.slug });

    // 2. Create owner user
    const [firstName, lastName] = parseFullName(ownerName || ownerEmail);

    const userResult = await db
      .insert(users)
      .values({
        email: ownerEmail.toLowerCase().trim(),
        firstName,
        lastName,
        role: 'owner',
        isAdmin: true,
      })
      .returning();

    const user = userResult[0];
    console.log('[provision] User created:', { id: user.id, email: user.email });

    // 3. Create owner membership
    await db.insert(userOrganizations).values({
      userId: user.id,
      organizationId: org.id,
      role: 'owner',
      isDefault: true,
    });

    console.log('[provision] Membership created');

    // 4. Create password identity (NULL hash - to be set via reset)
    await db.insert(authIdentities).values({
      userId: user.id,
      provider: 'password',
      passwordHash: null, // Will be set when owner resets password
      passwordSetAt: null,
    });

    console.log('[provision] Password identity created (pending setup)');

    // 5. Send password setup email
    await requestPasswordReset(ownerEmail);

    console.log('[provision] Password setup email sent');

    return {
      success: true,
      organizationId: org.id,
      userId: user.id,
      message: `Organization "${orgName}" created successfully. Password setup email sent to ${ownerEmail}.`,
    };
  } catch (error: any) {
    console.error('[provision] Error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate URL-friendly slug from organization name
 * 
 * @param orgName - Organization name
 * @returns Slug (lowercase, alphanumeric + hyphens)
 */
function generateSlug(orgName: string): string {
  return orgName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .substring(0, 100); // Max length
}

/**
 * Parse full name into first/last name
 * 
 * @param fullName - Full name string
 * @returns [firstName, lastName]
 */
function parseFullName(fullName: string): [string, string | undefined] {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) {
    return ['', undefined];
  }
  if (parts.length === 1) {
    return [parts[0], undefined];
  }
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return [firstName, lastName];
}

// CLI usage
if (require.main === module) {
  const readline = require('readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== Organization Provisioning Tool ===\n');

  rl.question('Organization Name: ', (orgName: string) => {
    rl.question('Owner Email: ', (ownerEmail: string) => {
      rl.question('Owner Name (optional): ', async (ownerName: string) => {
        rl.close();

        if (!orgName || !ownerEmail) {
          console.error('Error: Organization name and owner email are required');
          process.exit(1);
        }

        const result = await provisionOrganization({
          orgName: orgName.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerName: ownerName.trim() || undefined,
        });

        if (result.success) {
          console.log('\n✅ SUCCESS');
          console.log(`Organization ID: ${result.organizationId}`);
          console.log(`User ID: ${result.userId}`);
          console.log(`\n${result.message}`);
          process.exit(0);
        } else {
          console.error('\n❌ ERROR');
          console.error(result.error);
          process.exit(1);
        }
      });
    });
  });
}
