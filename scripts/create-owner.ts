#!/usr/bin/env tsx
/**
 * Bootstrap Owner User Creation Script
 * 
 * Creates the first owner user with password for AUTH_PROVIDER=standard authentication.
 * Safe for production - requires explicit command-line execution with validated inputs.
 * 
 * Usage:
 *   npx tsx scripts/create-owner.ts --email=admin@example.com --password=SecurePass123 --org=org_titan_001
 * 
 * Options:
 *   --email=<email>       - Owner's email address (required)
 *   --password=<password> - Owner's password (required, min 8 chars)
 *   --org=<orgId>         - Organization ID (required)
 *   --first=<name>        - First name (optional, default: "Admin")
 *   --last=<name>         - Last name (optional, default: "User")
 * 
 * Behavior:
 * - If user exists in specified org: updates password
 * - If user exists in different org: refuses with error
 * - If user doesn't exist: creates new owner user
 * - Creates userOrganizations entry with role 'owner'
 * - Idempotent: safe to run multiple times
 * 
 * Security:
 * - Passwords hashed with bcrypt (cost 10)
 * - Never logs passwords or hashes
 * - Validates inputs before any database operations
 */

import 'dotenv/config';
import { db } from '../server/db';
import { users, userOrganizations, organizations } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '../server/auth/passwordUtils';

// Parse command-line arguments
function parseArgs(): { email?: string; password?: string; org?: string; first?: string; last?: string } {
  const args: any = {};
  
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--(\w+)=(.+)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  });
  
  return args;
}

// Validate email format
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Main script
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔐 BOOTSTRAP OWNER USER CREATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  
  // Parse arguments
  const args = parseArgs();
  const { email, password, org, first = 'Admin', last = 'User' } = args;
  
  // Validate required arguments
  if (!email || !password || !org) {
    console.error('❌ ERROR: Missing required arguments');
    console.error('');
    console.error('Usage:');
    console.error('  npx tsx scripts/create-owner.ts --email=admin@example.com --password=SecurePass123 --org=org_titan_001');
    console.error('');
    console.error('Required:');
    console.error('  --email=<email>       - Owner\'s email address');
    console.error('  --password=<password> - Owner\'s password (min 8 chars)');
    console.error('  --org=<orgId>         - Organization ID');
    console.error('');
    console.error('Optional:');
    console.error('  --first=<name>        - First name (default: "Admin")');
    console.error('  --last=<name>         - Last name (default: "User")');
    console.error('');
    process.exit(1);
  }
  
  // Validate email
  if (!isValidEmail(email)) {
    console.error(`❌ ERROR: Invalid email format: ${email}`);
    console.error('');
    process.exit(1);
  }
  
  // Validate password strength
  const passwordValidation = validatePasswordStrength(password);
  if (!passwordValidation.valid) {
    console.error(`❌ ERROR: ${passwordValidation.message}`);
    console.error('');
    process.exit(1);
  }
  
  console.log('📋 Configuration:');
  console.log(`  Email:        ${email}`);
  console.log(`  Organization: ${org}`);
  console.log(`  First Name:   ${first}`);
  console.log(`  Last Name:    ${last}`);
  console.log(`  Password:     [REDACTED] (${password.length} characters)`);
  console.log('');
  
  try {
    // 1) Check if organization exists
    console.log('🔍 Step 1: Verifying organization...');
    const orgResult = await db.select().from(organizations).where(eq(organizations.id, org)).limit(1);
    
    if (orgResult.length === 0) {
      console.error(`❌ ERROR: Organization "${org}" does not exist`);
      console.error('');
      console.error('Available organizations:');
      const allOrgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).limit(10);
      allOrgs.forEach(o => console.error(`  - ${o.id} (${o.name})`));
      console.error('');
      process.exit(1);
    }
    
    console.log(`✅ Organization found: ${orgResult[0].name}`);
    console.log('');
    
    // 2) Check if user exists
    console.log('🔍 Step 2: Checking if user exists...');
    const existingUserResult = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email})`)
      .limit(1);
    
    let userId: string;
    let userAction: 'created' | 'updated' | 'exists';
    
    if (existingUserResult.length > 0) {
      // User exists
      const existingUser = existingUserResult[0];
      userId = existingUser.id;
      
      console.log(`⚠️  User already exists: ${existingUser.email}`);
      console.log(`   User ID: ${userId}`);
      console.log('');
      
      // Check if user is already in the specified org
      const membershipResult = await db
        .select()
        .from(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, userId),
            eq(userOrganizations.organizationId, org)
          )
        )
        .limit(1);
      
      if (membershipResult.length === 0) {
        // User exists but not in this org - check if they're in another org
        const otherOrgResult = await db
          .select()
          .from(userOrganizations)
          .where(eq(userOrganizations.userId, userId))
          .limit(1);
        
        if (otherOrgResult.length > 0) {
          console.error('❌ ERROR: User exists in a different organization');
          console.error(`   User ${email} belongs to organization: ${otherOrgResult[0].organizationId}`);
          console.error(`   Cannot add to organization: ${org}`);
          console.error('');
          console.error('   Users can belong to multiple organizations, but this script');
          console.error('   refuses to add existing users to prevent accidental data issues.');
          console.error('   Use the admin UI to manage user organization memberships.');
          console.error('');
          process.exit(1);
        }
      }
      
      // Update password
      console.log('🔄 Step 3: Updating password...');
      const passwordHash = await hashPassword(password);
      
      await db
        .update(users)
        .set({
          passwordHash,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      
      console.log('✅ Password updated successfully');
      userAction = 'updated';
      
    } else {
      // User doesn't exist - create new user
      console.log('✨ User does not exist - creating new owner user...');
      console.log('');
      
      console.log('🔄 Step 3: Hashing password...');
      const passwordHash = await hashPassword(password);
      console.log('✅ Password hashed');
      console.log('');
      
      console.log('🔄 Step 4: Creating user...');
      const newUserResult = await db
        .insert(users)
        .values({
          email,
          firstName: first,
          lastName: last,
          passwordHash,
          isAdmin: true,
          role: 'owner',
        })
        .returning({ id: users.id });
      
      userId = newUserResult[0].id;
      console.log(`✅ User created: ${userId}`);
      userAction = 'created';
    }
    
    // 3) Ensure user has organization membership
    console.log('');
    console.log('🔄 Step 5: Ensuring organization membership...');
    
    const membershipCheck = await db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, org)
        )
      )
      .limit(1);
    
    if (membershipCheck.length === 0) {
      // Create organization membership
      await db.insert(userOrganizations).values({
        userId,
        organizationId: org,
        role: 'owner',
        isDefault: true,
      });
      
      console.log('✅ Organization membership created with role: owner');
    } else {
      // Update role to owner if not already
      if (membershipCheck[0].role !== 'owner') {
        await db
          .update(userOrganizations)
          .set({ role: 'owner' })
          .where(
            and(
              eq(userOrganizations.userId, userId),
              eq(userOrganizations.organizationId, org)
            )
          );
        
        console.log('✅ Organization membership role updated to: owner');
      } else {
        console.log('✅ Organization membership already exists with role: owner');
      }
    }
    
    // Success summary
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ BOOTSTRAP COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Summary:');
    console.log(`  User ${userAction}: ${email}`);
    console.log(`  User ID: ${userId}`);
    console.log(`  Organization: ${org} (${orgResult[0].name})`);
    console.log(`  Role: owner`);
    console.log(`  Password: ${userAction === 'created' ? 'Set' : 'Updated'}`);
    console.log('');
    console.log('Next steps:');
    console.log('1. Deploy your application to Railway with AUTH_PROVIDER=standard');
    console.log('2. Navigate to https://your-app.railway.app');
    console.log(`3. Login with: ${email}`);
    console.log('4. Use the password you just set');
    console.log('');
    console.log('✅ Ready for production authentication!');
    console.log('═══════════════════════════════════════════════════════════════');
    
  } catch (error: any) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('❌ ERROR DURING BOOTSTRAP');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error.message);
    
    if (error.code) {
      console.error('Code:', error.code);
    }
    
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    
    console.error('');
    console.error('Common issues:');
    console.error('- DATABASE_URL not set or incorrect');
    console.error('- Database migration not applied (run migration 0033 first)');
    console.error('- Network connectivity to database');
    console.error('- Organization ID does not exist');
    console.error('');
    process.exit(1);
  }
}

// Run script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
