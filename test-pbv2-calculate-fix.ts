/**
 * Manual smoke test for PBV2 calculate endpoint fix
 * 
 * This tests:
 * 1. Empty selections (selectedOptions: {}) returns 200 with valid tree
 * 2. Invalid selections return 400 (not 500) with PBV2_E_INVALID_SELECTIONS code
 * 3. Tree schemaVersion is properly passed through
 * 
 * Run with: npx tsx test-pbv2-calculate-fix.ts
 * Requires dev server running on localhost:5000
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:5000';

// Test credentials (adjust for your dev environment)
const TEST_USERNAME = 'admin';
const TEST_PASSWORD = 'admin123';

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }

  // Extract session cookie
  const cookies = res.headers.raw()['set-cookie'];
  if (!cookies || cookies.length === 0) {
    throw new Error('No session cookie returned from login');
  }

  return cookies[0].split(';')[0]; // Return just the session cookie
}

async function testEmptySelections(sessionCookie: string, productId: string) {
  console.log('\n=== Test 1: Empty selections (should return 200) ===');

  const res = await fetch(`${BASE_URL}/api/quotes/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({
      productId,
      quantity: 10,
      width: 12,
      height: 18,
      selectedOptions: {}, // Empty selections
    }),
  });

  const data = await res.json();

  console.log(`Status: ${res.status}`);
  console.log(`Response:`, JSON.stringify(data, null, 2));

  if (res.status === 200 && data.success) {
    console.log('✅ PASS: Empty selections returned 200 with valid pricing');
    return true;
  } else if (res.status === 500) {
    console.log('❌ FAIL: Still returning 500 (bug not fixed)');
    return false;
  } else {
    console.log(`⚠️  UNEXPECTED: Got ${res.status}, expected 200`);
    return false;
  }
}

async function testInvalidSelections(sessionCookie: string, productId: string) {
  console.log('\n=== Test 2: Invalid selections (should return 400 with PBV2_E_INVALID_SELECTIONS) ===');

  const res = await fetch(`${BASE_URL}/api/quotes/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({
      productId,
      quantity: 10,
      width: 12,
      height: 18,
      selectedOptions: 'not an object', // Invalid type
    }),
  });

  const data = await res.json();

  console.log(`Status: ${res.status}`);
  console.log(`Response:`, JSON.stringify(data, null, 2));

  if (res.status === 400 && data.code === 'PBV2_E_INVALID_SELECTIONS') {
    console.log('✅ PASS: Invalid selections returned 400 with correct error code');
    return true;
  } else if (res.status === 500) {
    console.log('❌ FAIL: Still returning 500 for invalid selections');
    return false;
  } else {
    console.log(`⚠️  UNEXPECTED: Got ${res.status}, expected 400 with PBV2_E_INVALID_SELECTIONS`);
    return false;
  }
}

async function testValidSelections(sessionCookie: string, productId: string) {
  console.log('\n=== Test 3: Valid selections (should return 200 with options pricing) ===');

  // This test requires knowing a valid option node ID from the product's tree
  // For now, we'll test with empty selections that should work
  const res = await fetch(`${BASE_URL}/api/quotes/calculate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({
      productId,
      quantity: 10,
      width: 12,
      height: 18,
      selectedOptions: {}, // Valid empty selections
    }),
  });

  const data = await res.json();

  console.log(`Status: ${res.status}`);
  console.log(`Response (truncated):`, JSON.stringify({
    success: data.success,
    linePrice: data.linePrice,
    priceBreakdown: data.priceBreakdown,
    pbv2TreeVersionId: data.pbv2TreeVersionId,
  }, null, 2));

  if (res.status === 200 && data.success && data.pbv2TreeVersionId) {
    console.log('✅ PASS: Valid selections returned 200 with pbv2TreeVersionId');
    return true;
  } else {
    console.log(`❌ FAIL: Expected 200 with pbv2TreeVersionId, got ${res.status}`);
    return false;
  }
}

async function main() {
  // Product ID to test (must have an active PBV2 tree with schemaVersion=2)
  // Adjust this to a product that exists in your dev database
  const TEST_PRODUCT_ID = process.argv[2];

  if (!TEST_PRODUCT_ID) {
    console.error('Usage: npx tsx test-pbv2-calculate-fix.ts <productId>');
    console.error('Example: npx tsx test-pbv2-calculate-fix.ts prod_abc123');
    process.exit(1);
  }

  console.log('=== PBV2 Calculate Fix Smoke Test ===');
  console.log(`Product ID: ${TEST_PRODUCT_ID}`);

  try {
    // Login
    console.log('\n--- Logging in ---');
    const sessionCookie = await login();
    console.log('✅ Login successful');

    // Run tests
    const results = [
      await testEmptySelections(sessionCookie, TEST_PRODUCT_ID),
      await testInvalidSelections(sessionCookie, TEST_PRODUCT_ID),
      await testValidSelections(sessionCookie, TEST_PRODUCT_ID),
    ];

    // Summary
    console.log('\n=== Test Summary ===');
    const passed = results.filter(r => r).length;
    const total = results.length;
    console.log(`Passed: ${passed}/${total}`);

    if (passed === total) {
      console.log('✅ All tests passed!');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Test execution failed:', error);
    process.exit(1);
  }
}

main();
