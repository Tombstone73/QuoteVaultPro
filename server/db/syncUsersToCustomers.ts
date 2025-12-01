/**
 * Sync Users to Customers Utility
 * 
 * Ensures every user with an email has a corresponding customer record.
 * This is critical for customer quick quotes and order management.
 */

import { db } from '../db';
import { users, customers, userOrganizations } from '@shared/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { DEFAULT_ORGANIZATION_ID } from '../tenantContext';

/**
 * Get the organization ID for a user, or return default
 */
async function getUserOrganizationId(userId: string): Promise<string> {
  const [membership] = await db
    .select({ organizationId: userOrganizations.organizationId })
    .from(userOrganizations)
    .where(eq(userOrganizations.userId, userId))
    .limit(1);
  
  return membership?.organizationId || DEFAULT_ORGANIZATION_ID;
}

export async function syncUsersToCustomers(): Promise<{
  linked: number;
  created: number;
  skipped: number;
  errors: string[];
}> {
  const stats = {
    linked: 0,
    created: 0,
    skipped: 0,
    errors: [] as string[],
  };

  console.log('[Sync] Starting user-to-customer sync...');

  try {
    // Get all users with email addresses
    const allUsers = await db
      .select()
      .from(users)
      .where(and(
        isNull(sql`${users.email} IS NULL`),
        sql`${users.email} != ''`
      ));

    console.log(`[Sync] Found ${allUsers.length} users to process`);

    for (const user of allUsers) {
      if (!user.email) {
        stats.skipped++;
        continue;
      }

      try {
        // Check if customer already linked
        const linkedCustomer = await db
          .select()
          .from(customers)
          .where(eq(customers.userId, user.id))
          .limit(1);

        if (linkedCustomer.length > 0) {
          console.log(`[Sync] User ${user.email} already linked to customer ${linkedCustomer[0].id}`);
          stats.linked++;
          continue;
        }

        // Get user's organization ID
        const organizationId = await getUserOrganizationId(user.id);

        // Try to find existing customer by email (case-insensitive) in same org
        const existingCustomer = await db
          .select()
          .from(customers)
          .where(and(
            sql`LOWER(${customers.email}) = LOWER(${user.email})`,
            eq(customers.organizationId, organizationId)
          ))
          .limit(1);

        if (existingCustomer.length > 0) {
          // Link existing customer to user
          await db
            .update(customers)
            .set({ userId: user.id, updatedAt: new Date() })
            .where(eq(customers.id, existingCustomer[0].id));

          console.log(`[Sync] Linked existing customer ${existingCustomer[0].id} to user ${user.email}`);
          stats.linked++;
        } else {
          // Create new customer for this user
          const displayName = user.firstName && user.lastName
            ? `${user.firstName} ${user.lastName}`
            : user.firstName || user.email.split('@')[0];

          const [newCustomer] = await db
            .insert(customers)
            .values({
              companyName: displayName,
              email: user.email,
              userId: user.id,
              customerType: 'individual',
              status: 'active',
              organizationId,
            })
            .returning();

          console.log(`[Sync] Created new customer ${newCustomer.id} for user ${user.email}`);
          stats.created++;
        }
      } catch (error) {
        const errorMsg = `Error processing user ${user.email}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[Sync] ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    console.log('[Sync] Completed user-to-customer sync:', stats);
    return stats;
  } catch (error) {
    console.error('[Sync] Fatal error during sync:', error);
    throw error;
  }
}

/**
 * Get or create customer for a user
 * Used during quote creation to ensure every user has a customer record
 */
export async function ensureCustomerForUser(userId: string): Promise<string> {
  // First check if customer already linked
  const linkedCustomer = await db
    .select()
    .from(customers)
    .where(eq(customers.userId, userId))
    .limit(1);

  if (linkedCustomer.length > 0) {
    return linkedCustomer[0].id;
  }

  // Get user details
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    throw new Error(`User ${userId} not found`);
  }

  // Get user's organization ID
  const organizationId = await getUserOrganizationId(userId);

  // Try to find existing customer by email in same org
  if (user.email) {
    const existingCustomer = await db
      .select()
      .from(customers)
      .where(and(
        sql`LOWER(${customers.email}) = LOWER(${user.email})`,
        eq(customers.organizationId, organizationId)
      ))
      .limit(1);

    if (existingCustomer.length > 0) {
      // Link and return
      await db
        .update(customers)
        .set({ userId: user.id, updatedAt: new Date() })
        .where(eq(customers.id, existingCustomer[0].id));

      console.log(`[EnsureCustomer] Linked existing customer ${existingCustomer[0].id} to user ${user.email}`);
      return existingCustomer[0].id;
    }
  }

  // Create new customer
  const displayName = user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.email?.split('@')[0] || `User ${userId.slice(0, 8)}`;

  const [newCustomer] = await db
    .insert(customers)
    .values({
      companyName: displayName,
      email: user.email || null,
      userId: user.id,
      customerType: 'individual',
      status: 'active',
      organizationId,
    })
    .returning();

  console.log(`[EnsureCustomer] Created new customer ${newCustomer.id} for user ${user.email || userId}`);
  return newCustomer.id;
}
