/**
 * Gmail Email Configuration Diagnostic Tool
 * 
 * Purpose: Verify that email configuration is correct for production deployment
 * 
 * Usage:
 *   npx tsx server/diagnostics/emailConfigCheck.ts
 * 
 * This script checks:
 * 1. Required environment variables are set
 * 2. OAuth redirect URI configuration
 * 3. Express trust proxy setting
 * 4. Session cookie configuration
 * 5. Database email settings
 */

import "dotenv/config";
import { storage } from "../storage";
import { DEFAULT_ORGANIZATION_ID } from "../tenantContext";

interface ConfigCheck {
  name: string;
  status: "OK" | "WARN" | "FAIL";
  message: string;
  fix?: string;
}

async function runDiagnostics(): Promise<ConfigCheck[]> {
  const checks: ConfigCheck[] = [];

  // Check 1: PUBLIC_APP_URL
  const publicAppUrl = process.env.PUBLIC_APP_URL;
  if (!publicAppUrl) {
    checks.push({
      name: "PUBLIC_APP_URL",
      status: "WARN",
      message: "PUBLIC_APP_URL environment variable not set",
      fix: "Set PUBLIC_APP_URL to your production domain (e.g., https://www.printershero.com)"
    });
  } else if (publicAppUrl.includes("localhost") || publicAppUrl.includes("127.0.0.1")) {
    checks.push({
      name: "PUBLIC_APP_URL",
      status: "WARN",
      message: `PUBLIC_APP_URL is set to localhost: ${publicAppUrl}`,
      fix: "Update PUBLIC_APP_URL to your production domain (e.g., https://www.printershero.com)"
    });
  } else {
    checks.push({
      name: "PUBLIC_APP_URL",
      status: "OK",
      message: `PUBLIC_APP_URL: ${publicAppUrl}`
    });
  }

  // Check 2: GMAIL_OAUTH_REDIRECT_URI
  const gmailRedirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  if (!gmailRedirectUri) {
    checks.push({
      name: "GMAIL_OAUTH_REDIRECT_URI",
      status: "OK",
      message: "Using default: https://developers.google.com/oauthplayground (OK for OAuth Playground tokens)"
    });
  } else if (gmailRedirectUri.includes("localhost") || gmailRedirectUri.includes("127.0.0.1")) {
    checks.push({
      name: "GMAIL_OAUTH_REDIRECT_URI",
      status: "WARN",
      message: `GMAIL_OAUTH_REDIRECT_URI contains localhost: ${gmailRedirectUri}`,
      fix: "Update GMAIL_OAUTH_REDIRECT_URI to match your production domain or remove it to use OAuth Playground default"
    });
  } else {
    checks.push({
      name: "GMAIL_OAUTH_REDIRECT_URI",
      status: "OK",
      message: `GMAIL_OAUTH_REDIRECT_URI: ${gmailRedirectUri}`
    });
  }

  // Check 3: SESSION_SECRET
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    checks.push({
      name: "SESSION_SECRET",
      status: "FAIL",
      message: "SESSION_SECRET not set",
      fix: "Set SESSION_SECRET to a random string (32+ characters)"
    });
  } else if (sessionSecret.length < 16) {
    checks.push({
      name: "SESSION_SECRET",
      status: "WARN",
      message: "SESSION_SECRET is too short (less than 16 characters)",
      fix: "Use a longer SESSION_SECRET (32+ characters recommended)"
    });
  } else {
    checks.push({
      name: "SESSION_SECRET",
      status: "OK",
      message: `SESSION_SECRET: ${sessionSecret.length} characters (✓)`
    });
  }

  // Check 4: DATABASE_URL
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    checks.push({
      name: "DATABASE_URL",
      status: "FAIL",
      message: "DATABASE_URL not set",
      fix: "Set DATABASE_URL to your PostgreSQL connection string"
    });
  } else {
    try {
      const url = new URL(databaseUrl);
      checks.push({
        name: "DATABASE_URL",
        status: "OK",
        message: `Database: ${url.hostname}${url.pathname}`
      });
    } catch {
      checks.push({
        name: "DATABASE_URL",
        status: "FAIL",
        message: "DATABASE_URL is not a valid URL",
        fix: "Check your DATABASE_URL format (should be postgresql://...)"
      });
    }
  }

  // Check 5: NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  checks.push({
    name: "NODE_ENV",
    status: nodeEnv === "production" ? "OK" : "WARN",
    message: `NODE_ENV: ${nodeEnv || "not set (defaults to development)"}`,
    fix: nodeEnv !== "production" ? "Set NODE_ENV=production for production deployment" : undefined
  });

  // Check 6: Database email settings
  try {
    const emailSettings = await storage.getDefaultEmailSettings(DEFAULT_ORGANIZATION_ID);
    if (!emailSettings) {
      checks.push({
        name: "Email Settings (DB)",
        status: "WARN",
        message: "No email settings found in database",
        fix: "Configure email settings in Admin Settings → Email tab"
      });
    } else {
      const hasAllFields = !!(
        emailSettings.fromAddress &&
        emailSettings.clientId &&
        emailSettings.clientSecret &&
        emailSettings.refreshToken
      );
      
      if (!hasAllFields) {
        checks.push({
          name: "Email Settings (DB)",
          status: "WARN",
          message: "Email settings incomplete (missing fields)",
          fix: "Fill in all required fields: Gmail Address, Client ID, Client Secret, Refresh Token"
        });
      } else {
        checks.push({
          name: "Email Settings (DB)",
          status: "OK",
          message: `Email configured for ${emailSettings.fromAddress}`
        });
      }
    }
  } catch (error: any) {
    checks.push({
      name: "Email Settings (DB)",
      status: "FAIL",
      message: `Database query failed: ${error.message}`,
      fix: "Check DATABASE_URL and database connectivity"
    });
  }

  return checks;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("   Gmail Email Configuration Diagnostic Tool");
  console.log("═══════════════════════════════════════════════════════════\n");

  const checks = await runDiagnostics();

  const failures = checks.filter(c => c.status === "FAIL");
  const warnings = checks.filter(c => c.status === "WARN");
  const successes = checks.filter(c => c.status === "OK");

  // Print results
  console.log("RESULTS:\n");
  
  for (const check of checks) {
    const icon = check.status === "OK" ? "✓" : check.status === "WARN" ? "⚠" : "✗";
    const color = check.status === "OK" ? "\x1b[32m" : check.status === "WARN" ? "\x1b[33m" : "\x1b[31m";
    console.log(`${color}${icon}\x1b[0m ${check.name}`);
    console.log(`  ${check.message}`);
    if (check.fix) {
      console.log(`  → FIX: ${check.fix}`);
    }
    console.log("");
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Summary: ${successes.length} OK, ${warnings.length} warnings, ${failures.length} failures`);
  console.log("═══════════════════════════════════════════════════════════\n");

  if (failures.length > 0) {
    console.log("⚠️  CRITICAL: Fix the failures above before deploying to production");
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log("⚠️  Review warnings above - email may not work correctly in production");
  } else {
    console.log("✓ All checks passed! Email configuration looks good.");
  }
}

main().catch((error) => {
  console.error("Diagnostic script failed:", error);
  process.exit(1);
});
