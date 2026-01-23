#!/usr/bin/env node
/**
 * Test auth provider selection logic
 * Run: node test-auth-selection.js
 */

const testCases = [
  {
    name: "No AUTH_PROVIDER set (default)",
    env: {},
    expected: "localAuth"
  },
  {
    name: "AUTH_PROVIDER=local",
    env: { AUTH_PROVIDER: "local" },
    expected: "localAuth"
  },
  {
    name: "AUTH_PROVIDER=replit",
    env: { AUTH_PROVIDER: "replit" },
    expected: "replitAuth"
  },
  {
    name: "AUTH_PROVIDER=unknown (fallback to local)",
    env: { AUTH_PROVIDER: "unknown" },
    expected: "localAuth"
  },
  {
    name: "AUTH_PROVIDER with whitespace",
    env: { AUTH_PROVIDER: "  REPLIT  " },
    expected: "replitAuth"
  },
  {
    name: "NODE_ENV=production without AUTH_PROVIDER (Railway scenario)",
    env: { NODE_ENV: "production" },
    expected: "localAuth"
  },
  {
    name: "NODE_ENV=development without AUTH_PROVIDER",
    env: { NODE_ENV: "development" },
    expected: "localAuth"
  },
];

console.log("Testing auth provider selection logic...\n");

let passCount = 0;
let failCount = 0;

for (const testCase of testCases) {
  const authProviderRaw = (testCase.env.AUTH_PROVIDER || '').trim().toLowerCase();
  
  let authProvider;
  
  if (authProviderRaw === 'replit') {
    authProvider = 'replitAuth';
  } else {
    authProvider = 'localAuth';
  }
  
  const passed = authProvider === testCase.expected;
  const status = passed ? "✅ PASS" : "❌ FAIL";
  
  if (passed) passCount++;
  else failCount++;
  
  console.log(`${status} ${testCase.name}`);
  console.log(`   Env: ${JSON.stringify(testCase.env)}`);
  console.log(`   Expected: ${testCase.expected}`);
  console.log(`   Got: ${authProvider}`);
  console.log();
}

console.log(`Test complete! ${passCount} passed, ${failCount} failed.`);
process.exit(failCount > 0 ? 1 : 0);
