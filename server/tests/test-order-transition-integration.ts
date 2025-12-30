/**
 * Integration test for order transition endpoint
 * 
 * Manual test script to verify transition validation works end-to-end.
 * Run with: npx tsx server/tests/test-order-transition-integration.ts
 */

import { db } from '../db';
import { orders, orderLineItems, customers, users, products } from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const ORG_ID = 'org_titan_001';
const TEST_USER_ID = 'local-test-user';

async function testOrderTransitions() {
  console.log('🧪 Order Transition Integration Tests\n');

  try {
    // 1. Find or create a test customer
    let [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.organizationId, ORG_ID))
      .limit(1);

    if (!customer) {
      console.log('Creating test customer...');
      [customer] = await db
        .insert(customers)
        .values({
          organizationId: ORG_ID,
          companyName: 'Test Customer for Transitions',
          email: 'test-transition@example.com',
          customerType: 'business',
        })
        .returning();
      console.log(`✅ Created customer: ${customer.id}\n`);
    } else {
      console.log(`✅ Using existing customer: ${customer.id}\n`);
    }

    // 2. Create a test order with 0 line items (should fail new -> in_production)
    console.log('Test 1: new -> in_production with 0 line items (should fail)');
    const [testOrder1] = await db
      .insert(orders)
      .values({
        organizationId: ORG_ID,
        orderNumber: `TEST-TRANS-${Date.now()}-1`,
        customerId: customer.id,
        status: 'new',
        priority: 'normal',
        fulfillmentStatus: 'pending',
        subtotal: '100.00',
        tax: '0.00',
        total: '100.00',
        discount: '0.00',
        billToName: 'Test Customer',
        createdByUserId: TEST_USER_ID,
      })
      .returning();

    console.log(`Created order: ${testOrder1.orderNumber} (${testOrder1.id})`);
    
    // Verify it has 0 line items
    const lineItems1 = await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, testOrder1.id));
    console.log(`Line items count: ${lineItems1.length}`);
    
    if (lineItems1.length === 0) {
      console.log('✅ Test 1 setup complete: Order has 0 line items as expected\n');
    } else {
      console.log('❌ Test 1 setup failed: Order should have 0 line items\n');
    }

    // 3. Create a test order with 1 line item and due date (should succeed new -> in_production)
    console.log('Test 2: new -> in_production with 1 line item and due date (should succeed)');
    const [testOrder2] = await db
      .insert(orders)
      .values({
        organizationId: ORG_ID,
        orderNumber: `TEST-TRANS-${Date.now()}-2`,
        customerId: customer.id,
        status: 'new',
        priority: 'normal',
        fulfillmentStatus: 'pending',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
        subtotal: '200.00',
        tax: '0.00',
        total: '200.00',
        discount: '0.00',
        billToName: 'Test Customer',
        createdByUserId: TEST_USER_ID,
      })
      .returning();

    console.log(`Created order: ${testOrder2.orderNumber} (${testOrder2.id})`);

    // Find a product for the line item
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.organizationId, ORG_ID))
      .limit(1);

    if (!product) {
      console.log('⚠️  No products found - skipping Test 2');
      console.log('   Create a product first, then re-run this test.\n');
    } else {
      // Add a line item (using raw table insert to avoid schema issues)
      await db.insert(orderLineItems).values({
        orderId: testOrder2.id,
        productId: product.id,
        productType: 'banner',
        description: 'Test Banner',
        width: '24',
        height: '36',
        quantity: 1,
        unitPrice: '200.00',
        totalPrice: '200.00',
        isTaxable: true,
      } as any); // Type assertion to bypass strict schema validation in test

      const lineItems2 = await db
        .select()
        .from(orderLineItems)
        .where(eq(orderLineItems.orderId, testOrder2.id));
      console.log(`Line items count: ${lineItems2.length}`);
      console.log(`Due date: ${testOrder2.dueDate}`);
      console.log(`Billing info: ${testOrder2.billToName}`);
      console.log('✅ Test 2 setup complete: Order ready for production\n');
    }

    console.log('📋 Manual Testing Steps:');
    console.log('1. Start the dev server: npm run dev');
    console.log('2. Login and navigate to orders');
    console.log(`3. Find order ${testOrder1.orderNumber} and try to change status to "in_production"`);
    console.log('   Expected: Should show error "Cannot start production: Order must have at least one line item"');
    console.log(`4. Find order ${testOrder2.orderNumber} and try to change status to "in_production"`);
    console.log('   Expected: Should succeed and show status changed to "in_production"');
    console.log('\nAPI Testing:');
    console.log(`curl -X POST http://localhost:5000/api/orders/${testOrder1.id}/transition \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"toStatus":"in_production"}\'');
    console.log('\nExpected: 400 error with NO_LINE_ITEMS code\n');
    console.log(`curl -X POST http://localhost:5000/api/orders/${testOrder2.id}/transition \\`);
    console.log('  -H "Content-Type: application/json" \\');
    console.log('  -d \'{"toStatus":"in_production"}\'');
    console.log('\nExpected: 200 success with updated order\n');

    // Cleanup note
    console.log('🧹 Cleanup: Test orders will remain in database for manual testing.');
    console.log(`   Delete manually or remove orders: ${testOrder1.id}, ${testOrder2.id}`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

testOrderTransitions();
