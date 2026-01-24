#!/usr/bin/env tsx
/**
 * Auth Provider Diagnostic Tool
 * 
 * Run this script to diagnose auth provider configuration issues:
 *   npx tsx server/diagnostics/authCheck.ts
 * 
 * This tool checks:
 * - AUTH_PROVIDER environment variable
 * - Required variables for each auth provider
 * - Session store configuration
 * - Cookie security settings
 * - OIDC discovery (for replitAuth)
 */

import 'dotenv/config';

interface DiagnosticResult {
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

function checkEnvVar(name: string, required: boolean = false): DiagnosticResult {
  const value = process.env[name];
  
  if (!value) {
    return {
      status: required ? 'fail' : 'warn',
      message: required ? `❌ ${name} is REQUIRED but not set` : `⚠️  ${name} is not set (optional)`
    };
  }
  
  return {
    status: 'pass',
    message: `✅ ${name} is set`
  };
}

function checkUrl(name: string, expectedProtocol?: 'http' | 'https'): DiagnosticResult {
  const value = process.env[name];
  
  if (!value) {
    return { status: 'warn', message: `⚠️  ${name} is not set` };
  }
  
  try {
    const url = new URL(value);
    
    if (expectedProtocol && url.protocol !== `${expectedProtocol}:`) {
      return {
        status: 'warn',
        message: `⚠️  ${name} uses ${url.protocol} but ${expectedProtocol}: is recommended`
      };
    }
    
    return {
      status: 'pass',
      message: `✅ ${name} is valid: ${url.origin}`
    };
  } catch {
    return {
      status: 'fail',
      message: `❌ ${name} is not a valid URL: ${value}`
    };
  }
}

async function checkOidcDiscovery(): Promise<DiagnosticResult> {
  const issuer = process.env.REPLIT_OIDC_ISSUER;
  
  if (!issuer) {
    return { status: 'fail', message: '❌ REPLIT_OIDC_ISSUER not set, cannot check discovery' };
  }
  
  try {
    console.log(`   Attempting OIDC discovery at ${issuer}...`);
    const wellKnownUrl = new URL('/.well-known/openid-configuration', issuer);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(wellKnownUrl.toString(), {
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      return {
        status: 'fail',
        message: `❌ OIDC discovery failed: HTTP ${response.status} ${response.statusText}`
      };
    }
    
    const config = await response.json();
    
    return {
      status: 'pass',
      message: `✅ OIDC discovery successful\n   Issuer: ${config.issuer}\n   Authorization: ${config.authorization_endpoint}`
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return {
        status: 'fail',
        message: '❌ OIDC discovery timed out after 5 seconds'
      };
    }
    
    return {
      status: 'fail',
      message: `❌ OIDC discovery failed: ${error.message || String(error)}`
    };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔍 AUTH PROVIDER DIAGNOSTIC TOOL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  
  // Core environment
  console.log('📋 CORE ENVIRONMENT:');
  console.log(checkEnvVar('NODE_ENV', true).message);
  console.log(checkEnvVar('AUTH_PROVIDER', false).message);
  console.log(checkEnvVar('DATABASE_URL', true).message);
  console.log(checkEnvVar('SESSION_SECRET', true).message);
  console.log();
  
  // Auth provider selection
  const authProvider = (process.env.AUTH_PROVIDER || '').trim().toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || '').trim();
  
  console.log('🔐 AUTH PROVIDER SELECTION:');
  console.log(`Current AUTH_PROVIDER: ${authProvider || '(not set - defaults to "local")'}`);
  console.log(`Current NODE_ENV: ${nodeEnv || '(not set)'}`);
  console.log();
  
  if (authProvider === 'replit') {
    console.log('✅ Selected: replitAuth (Replit OIDC)');
    console.log('───────────────────────────────────────────────────────────────');
    console.log('📋 REPLIT AUTH REQUIREMENTS:');
    console.log(checkEnvVar('REPL_ID', true).message);
    console.log(checkUrl('REPLIT_OIDC_ISSUER').message);
    console.log();
    
    if (process.env.REPL_ID && process.env.REPLIT_OIDC_ISSUER) {
      console.log('🔍 OIDC DISCOVERY CHECK:');
      const oidcResult = await checkOidcDiscovery();
      console.log(oidcResult.message);
      console.log();
      
      if (oidcResult.status === 'fail') {
        console.log('⚠️  OIDC discovery failed. Auth will NOT work.');
        console.log('   Common causes:');
        console.log('   - REPLIT_OIDC_ISSUER is incorrect');
        console.log('   - Network connectivity issues');
        console.log('   - Replit OIDC service is down');
        console.log();
      }
    } else {
      console.log('⚠️  Cannot check OIDC discovery: missing REPL_ID or REPLIT_OIDC_ISSUER');
      console.log();
    }
    
    console.log('🔧 SESSION CONFIG (replitAuth):');
    console.log('   Store type:    PostgreSQL (connect-pg-simple)');
    console.log('   Cookie secure: true (HTTPS only)');
    console.log('   Cookie sameSite: lax');
    console.log('   Trust proxy:   1');
    console.log();
    
    if (nodeEnv !== 'production') {
      console.log('⚠️  WARNING: replitAuth selected but NODE_ENV is not "production"');
      console.log('   This is unusual. replitAuth is designed for production use.');
      console.log();
    }
  } else {
    if (authProvider && authProvider !== 'local') {
      console.log(`⚠️  Unknown AUTH_PROVIDER: "${authProvider}"`);
      console.log('   Falling back to: localAuth');
    } else {
      console.log('✅ Selected: localAuth (Development mode)');
    }
    
    console.log('───────────────────────────────────────────────────────────────');
    console.log('⚠️  WARNING: localAuth is for DEVELOPMENT ONLY');
    console.log('   - No real authentication (auto-login)');
    console.log('   - Insecure cookies (secure: false)');
    console.log('   - Creates test users on-the-fly');
    console.log();
    
    console.log('🔧 SESSION CONFIG (localAuth):');
    console.log('   Store type:    PostgreSQL (connect-pg-simple)');
    console.log('   Cookie secure: false (HTTP allowed)');
    console.log('   Trust proxy:   1');
    console.log();
    
    if (nodeEnv === 'production') {
      console.log('❌ CRITICAL: localAuth is active in NODE_ENV=production');
      console.log('   This is a SECURITY RISK!');
      console.log('   Set AUTH_PROVIDER=replit for production.');
      console.log();
    }
  }
  
  // Email configuration (optional)
  console.log('📧 EMAIL CONFIGURATION (Optional):');
  console.log(checkUrl('PUBLIC_APP_URL', 'https').message);
  console.log(checkUrl('GMAIL_OAUTH_REDIRECT_URI', 'https').message);
  console.log(checkEnvVar('GMAIL_CLIENT_ID').message);
  console.log(checkEnvVar('GMAIL_CLIENT_SECRET').message);
  console.log(checkEnvVar('GMAIL_REFRESH_TOKEN').message);
  console.log();
  
  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 SUMMARY:');
  
  const issues: string[] = [];
  
  if (nodeEnv === 'production' && authProvider !== 'replit') {
    issues.push('localAuth in production (SECURITY RISK)');
  }
  
  if (authProvider === 'replit' && !process.env.REPL_ID) {
    issues.push('Missing REPL_ID for replitAuth');
  }
  
  if (authProvider === 'replit' && !process.env.REPLIT_OIDC_ISSUER) {
    issues.push('Missing REPLIT_OIDC_ISSUER for replitAuth');
  }
  
  if (!process.env.DATABASE_URL) {
    issues.push('Missing DATABASE_URL');
  }
  
  if (!process.env.SESSION_SECRET) {
    issues.push('Missing SESSION_SECRET');
  }
  
  if (issues.length === 0) {
    console.log('✅ Auth configuration looks good!');
    console.log();
    console.log('Next steps:');
    console.log('1. Start the server: npm run dev');
    console.log('2. Check startup logs for auth provider confirmation');
    console.log('3. Test login at http://localhost:5000/api/login');
  } else {
    console.log(`❌ Found ${issues.length} issue(s):`);
    issues.forEach(issue => console.log(`   - ${issue}`));
    console.log();
    console.log('Fix these issues before deploying to production.');
    console.log('See: RAILWAY_AUTH_FIX.md for detailed instructions.');
  }
  
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
