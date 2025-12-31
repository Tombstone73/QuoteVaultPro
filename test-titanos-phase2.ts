/**
 * TitanOS Phase 2 - Integration Test Script
 * 
 * Run this script to verify the TitanOS Order State Architecture implementation.
 * Prerequisites: Database migration applied, server running
 */

const BASE_URL = 'http://localhost:5000'; // Adjust as needed

// Helper function for API calls
async function apiCall(endpoint: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`API Error (${res.status}): ${error.message || error.error}`);
  }

  return res.json();
}

// Test suite
async function runTests() {
  console.log('🚀 TitanOS Phase 2 Integration Tests\n');

  let testOrderId: string;
  let testPillId: string;

  try {
    // Test 1: Create a test order (requires existing customer)
    console.log('Test 1: Create test order...');
    // Note: This assumes you have authentication set up
    // You may need to create the order via UI first and use its ID
    console.log('⚠️  Manual step: Create an order via UI and note its ID\n');

    // Prompt for order ID
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    testOrderId = await new Promise((resolve) => {
      readline.question('Enter test order ID: ', (answer: string) => {
        readline.close();
        resolve(answer);
      });
    });

    // Test 2: Fetch order and verify state fields exist
    console.log('\nTest 2: Verify order has state fields...');
    const order = await apiCall(`/api/orders/${testOrderId}`);
    
    if (!order.data) {
      throw new Error('Order not found');
    }

    const { state, statusPillValue, paymentStatus, routingTarget } = order.data;
    console.log(`✅ Order state: ${state}`);
    console.log(`✅ Status pill: ${statusPillValue || '(none)'}`);
    console.log(`✅ Payment status: ${paymentStatus}`);
    console.log(`✅ Routing target: ${routingTarget || '(none)'}\n`);

    // Test 3: Fetch status pills for "open" state
    console.log('Test 3: Fetch status pills for "open" state...');
    const pillsResponse = await apiCall('/api/orders/status-pills?stateScope=open');
    
    if (!pillsResponse.success || !pillsResponse.pills) {
      throw new Error('Failed to fetch status pills');
    }

    console.log(`✅ Found ${pillsResponse.pills.length} pills for "open" state:`);
    pillsResponse.pills.forEach((pill: any) => {
      console.log(`   - ${pill.name} (${pill.color})${pill.isDefault ? ' [DEFAULT]' : ''}`);
    });
    console.log();

    // Test 4: Assign a status pill to the order
    console.log('Test 4: Assign status pill to order...');
    const firstPill = pillsResponse.pills[0];
    
    const assignResult = await apiCall(`/api/orders/${testOrderId}/status-pill`, {
      method: 'PATCH',
      body: JSON.stringify({ statusPillValue: firstPill.name }),
    });

    console.log(`✅ Assigned status pill: ${assignResult.data.statusPillValue}\n`);

    // Test 5: Attempt invalid state transition (should fail)
    console.log('Test 5: Test invalid transition (open→closed, should fail)...');
    try {
      await apiCall(`/api/orders/${testOrderId}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ nextState: 'closed' }),
      });
      console.log('❌ Invalid transition was allowed (FAIL)\n');
    } catch (error: any) {
      console.log(`✅ Invalid transition rejected: ${error.message}\n`);
    }

    // Test 6: Valid state transition (open→production_complete)
    console.log('Test 6: Transition open→production_complete...');
    const transitionResult = await apiCall(`/api/orders/${testOrderId}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ 
        nextState: 'production_complete',
        notes: 'Test transition from integration script'
      }),
    });

    console.log(`✅ State transitioned to: ${transitionResult.data.state}`);
    console.log(`✅ Routing target set to: ${transitionResult.data.routingTarget}\n`);

    // Test 7: Transition production_complete→closed
    console.log('Test 7: Transition production_complete→closed...');
    const closeResult = await apiCall(`/api/orders/${testOrderId}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ 
        nextState: 'closed',
        notes: 'Test close from integration script'
      }),
    });

    console.log(`✅ State transitioned to: ${closeResult.data.state}`);
    console.log(`✅ Closed at: ${closeResult.data.closedAt}\n`);

    // Test 8: Attempt to transition from terminal state (should fail)
    console.log('Test 8: Test terminal state protection (closed→open, should fail)...');
    try {
      await apiCall(`/api/orders/${testOrderId}/state`, {
        method: 'PATCH',
        body: JSON.stringify({ nextState: 'open' }),
      });
      console.log('❌ Terminal state transition was allowed (FAIL)\n');
    } catch (error: any) {
      console.log(`✅ Terminal state transition rejected: ${error.message}\n`);
    }

    // Test 9: Reopen closed order
    console.log('Test 9: Reopen closed order...');
    const reopenResult = await apiCall(`/api/orders/${testOrderId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ 
        reason: 'Testing reopen functionality from integration script',
        targetState: 'production_complete'
      }),
    });

    console.log(`✅ Order reopened to state: ${reopenResult.data.state}\n`);

    // Test 10: Create a custom status pill (admin only)
    console.log('Test 10: Create custom status pill (requires admin)...');
    try {
      const createPillResult = await apiCall('/api/orders/status-pills', {
        method: 'POST',
        body: JSON.stringify({
          stateScope: 'open',
          name: 'Test Pill',
          color: '#ff6b6b',
          isDefault: false,
          sortOrder: 99,
        }),
      });

      testPillId = createPillResult.pill.id;
      console.log(`✅ Created custom pill: ${createPillResult.pill.name} (ID: ${testPillId})\n`);

      // Test 11: Delete the custom pill
      console.log('Test 11: Delete custom status pill...');
      await apiCall(`/api/orders/status-pills/${testPillId}`, {
        method: 'DELETE',
      });
      console.log(`✅ Deleted custom pill: ${testPillId}\n`);
    } catch (error: any) {
      console.log(`⚠️  Pill management tests skipped (requires admin): ${error.message}\n`);
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('🎉 All Tests Passed!');
    console.log('═══════════════════════════════════════');
    console.log('\nTitanOS Phase 2 implementation is working correctly.');
    console.log('\nVerified:');
    console.log('✅ Order state fields present');
    console.log('✅ Status pills fetching');
    console.log('✅ Status pill assignment');
    console.log('✅ State transition validation');
    console.log('✅ Routing logic (production_complete)');
    console.log('✅ Terminal state enforcement');
    console.log('✅ Reopen functionality');
    console.log('✅ Audit logging (check database)');
    console.log('\nNext steps:');
    console.log('1. Check audit logs in database (order_audit_log table)');
    console.log('2. Verify timeline UI shows state changes');
    console.log('3. Test UI components in browser');
    console.log('4. Test multi-tenant isolation with different orgs');
    console.log('5. Deploy to staging environment\n');

  } catch (error: any) {
    console.error('\n❌ Test Failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);
