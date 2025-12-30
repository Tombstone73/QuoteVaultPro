/**
 * Example: Update Order Transition Preferences
 * 
 * This script demonstrates how to configure order transition validation
 * requirements at the organization level using the database directly.
 * 
 * In production, use the API endpoints:
 * - GET /api/organization/preferences
 * - PUT /api/organization/preferences
 */

import { db } from './server/db';
import { organizations } from '@shared/schema';
import { eq } from 'drizzle-orm';

interface OrgPreferences {
  quotes?: {
    requireApproval?: boolean;
  };
  orders?: {
    requireDueDateForProduction?: boolean;
    requireBillingAddressForProduction?: boolean;
    requireShippingAddressForProduction?: boolean;
  };
}

async function updateOrderTransitionPreferences(
  organizationId: string,
  orderPrefs: OrgPreferences['orders']
) {
  try {
    console.log(`\n🔧 Updating order transition preferences for org: ${organizationId}`);
    
    // Get current organization settings
    const [org] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    
    if (!org) {
      console.error('❌ Organization not found');
      return;
    }
    
    // Merge new preferences
    const currentSettings = (org.settings || {}) as any;
    const currentPreferences = currentSettings.preferences || {};
    
    const updatedSettings = {
      ...currentSettings,
      preferences: {
        ...currentPreferences,
        orders: {
          ...currentPreferences.orders,
          ...orderPrefs,
        },
      } as OrgPreferences,
    };
    
    // Update database
    await db
      .update(organizations)
      .set({ 
        settings: updatedSettings as any,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));
    
    console.log('✅ Preferences updated successfully:');
    console.log(JSON.stringify(updatedSettings.preferences.orders, null, 2));
    
  } catch (error) {
    console.error('❌ Error updating preferences:', error);
  }
}

// Example usage scenarios:

async function setStrictValidation(orgId: string) {
  console.log('\n📋 Scenario: STRICT validation (safe defaults)');
  await updateOrderTransitionPreferences(orgId, {
    requireDueDateForProduction: true,
    requireBillingAddressForProduction: true,
    requireShippingAddressForProduction: false,
  });
}

async function setRelaxedValidation(orgId: string) {
  console.log('\n📋 Scenario: RELAXED validation (flexible workflow)');
  await updateOrderTransitionPreferences(orgId, {
    requireDueDateForProduction: false,
    requireBillingAddressForProduction: false,
    requireShippingAddressForProduction: false,
  });
}

async function setShippingRequired(orgId: string) {
  console.log('\n📋 Scenario: SHIPPING required (delivery-focused)');
  await updateOrderTransitionPreferences(orgId, {
    requireDueDateForProduction: true,
    requireBillingAddressForProduction: true,
    requireShippingAddressForProduction: true, // Enable shipping validation
  });
}

async function main() {
  const DEFAULT_ORG_ID = 'org_titan_001';
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Order Transition Preferences Configuration Examples');
  console.log('═══════════════════════════════════════════════════════════');
  
  // Uncomment the scenario you want to apply:
  
  // await setStrictValidation(DEFAULT_ORG_ID);
  // await setRelaxedValidation(DEFAULT_ORG_ID);
  // await setShippingRequired(DEFAULT_ORG_ID);
  
  console.log('\n💡 To apply a configuration, uncomment one of the scenarios above.');
  console.log('📝 Or use the API endpoints in production:\n');
  console.log('   GET  /api/organization/preferences');
  console.log('   PUT  /api/organization/preferences');
  console.log('\n═══════════════════════════════════════════════════════════\n');
  
  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { updateOrderTransitionPreferences, setStrictValidation, setRelaxedValidation, setShippingRequired };
