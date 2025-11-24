import 'dotenv/config';
import { db } from './server/db';
import { orders, orderLineItems, globalVariables, customers, users } from './shared/schema';
import { eq } from 'drizzle-orm';

async function testOrdersSchema() {
  console.log('Testing Orders schema...\n');

  try {
    // Test 1: Verify tables exist by querying
    console.log('1. Checking if orders table exists...');
    const allOrders = await db.select().from(orders).limit(1);
    console.log(`✓ Orders table accessible (found ${allOrders.length} records)\n`);

    console.log('2. Checking if order_line_items table exists...');
    const allLineItems = await db.select().from(orderLineItems).limit(1);
    console.log(`✓ Order line items table accessible (found ${allLineItems.length} records)\n`);

    // Test 2: Verify globalVariables has orderNumber
    console.log('3. Checking orderNumber in globalVariables...');
    const orderNumberVar = await db.select()
      .from(globalVariables)
      .where(eq(globalVariables.name, 'orderNumber'))
      .limit(1);
    
    if (orderNumberVar.length > 0) {
      console.log(`✓ orderNumber variable exists with value: ${orderNumberVar[0].value}\n`);
    } else {
      console.log('✗ orderNumber variable NOT FOUND - creating it now...\n');
      await db.insert(globalVariables).values({
        name: 'orderNumber',
        value: '1',
        description: 'Auto-incrementing order number counter',
        category: 'system',
        isActive: true,
      });
      console.log('✓ orderNumber variable created\n');
    }

    // Test 3: Check if we have customers and users (needed for creating orders)
    console.log('4. Checking for existing customers...');
    const existingCustomers = await db.select().from(customers).limit(1);
    console.log(`Found ${existingCustomers.length} customer(s)\n`);

    console.log('5. Checking for existing users...');
    const existingUsers = await db.select().from(users).limit(1);
    console.log(`Found ${existingUsers.length} user(s)\n`);

    if (existingCustomers.length === 0) {
      console.log('⚠ No customers found - you\'ll need to create a customer before creating orders');
    }

    if (existingUsers.length === 0) {
      console.log('⚠ No users found - you\'ll need to create a user before creating orders');
    }

    console.log('\n✅ Schema test complete! Orders system is ready.');
    
  } catch (error) {
    console.error('\n❌ Error testing schema:', error);
    throw error;
  }

  process.exit(0);
}

testOrdersSchema().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
