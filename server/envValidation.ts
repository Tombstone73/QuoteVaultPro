/**
 * Environment Variable Validation for Production
 * 
 * Purpose: Fail-fast startup validation to prevent misconfigured deployments
 * 
 * This module validates critical environment variables at server startup.
 * Tier 1 (FATAL): Core platform requirements - server exits if misconfigured
 * Tier 2 (NON-FATAL): Optional features - warns but allows startup
 */

interface EnvCheck {
  name: string;
  required: boolean;
  tier: 1 | 2; // 1 = FATAL (exit), 2 = NON-FATAL (warn)
  validator?: (value: string | undefined) => string | null; // Returns error message or null if valid
  productionOnly?: boolean; // Only validate in production
}

// Tier 1: FATAL - Server exits if these fail in production
const TIER1_CHECKS: EnvCheck[] = [
  {
    name: "DATABASE_URL",
    required: true,
    tier: 1,
    validator: (value) => {
      if (!value) return "DATABASE_URL must be set";
      try {
        new URL(value);
        return null;
      } catch {
        return "DATABASE_URL must be a valid PostgreSQL connection string";
      }
    },
  },
  {
    name: "SESSION_SECRET",
    required: true,
    tier: 1,
    validator: (value) => {
      if (!value) return "SESSION_SECRET must be set";
      if (value.length < 16) return "SESSION_SECRET must be at least 16 characters";
      return null;
    },
  },
  {
    name: "AUTH_PROVIDER",
    required: false,
    tier: 1,
    productionOnly: true,
    validator: (value) => {
      const nodeEnv = process.env.NODE_ENV?.trim();
      const deployTarget = process.env.DEPLOY_TARGET?.trim().toLowerCase();
      
      if (nodeEnv === "production") {
        // In production, AUTH_PROVIDER must be set
        if (!value) {
          return 'AUTH_PROVIDER must be set in production. Use "standard" for Railway or "replit" for Replit platform.';
        }
        
        const authProvider = value.toLowerCase();
        
        // Reject localAuth in production (security risk)
        if (authProvider === "local") {
          return 'AUTH_PROVIDER="local" is NOT allowed in production (insecure auto-login). Use AUTH_PROVIDER="standard" for Railway.';
        }
        
        // Validate standard auth (recommended for Railway)
        if (authProvider === "standard") {
          // standardAuth only requires DATABASE_URL and SESSION_SECRET (already validated above)
          return null; // Valid for production
        }
        
        // Validate replit auth (requires DEPLOY_TARGET=replit)
        if (authProvider === "replit") {
          if (deployTarget !== "replit") {
            return 'AUTH_PROVIDER="replit" requires DEPLOY_TARGET="replit". Replit OIDC only works on Replit platform. For Railway, use AUTH_PROVIDER="standard".';
          }
          return null; // Valid for Replit deployment
        }
        
        // Unknown AUTH_PROVIDER value
        return `AUTH_PROVIDER="${value}" is not recognized. Valid values: "standard" (Railway), "replit" (Replit platform only)`;
      }
      
      return null; // Development: any provider allowed
    },
  },
  {
    name: "REPLIT_OIDC_ISSUER",
    required: false,
    tier: 1,
    productionOnly: true,
    validator: (value) => {
      const nodeEnv = process.env.NODE_ENV?.trim();
      const authProvider = process.env.AUTH_PROVIDER?.trim().toLowerCase();
      const deployTarget = process.env.DEPLOY_TARGET?.trim().toLowerCase();
      
      // Only required when using replitAuth on Replit platform
      if (nodeEnv === "production" && authProvider === "replit" && deployTarget === "replit") {
        if (!value && !process.env.ISSUER_URL) {
          return "REPLIT_OIDC_ISSUER (or ISSUER_URL) must be set when AUTH_PROVIDER=replit on Replit platform";
        }
      }
      
      return null;
    },
  },
  {
    name: "REPL_ID",
    required: false,
    tier: 1,
    productionOnly: true,
    validator: (value) => {
      const nodeEnv = process.env.NODE_ENV?.trim();
      const authProvider = process.env.AUTH_PROVIDER?.trim().toLowerCase();
      const deployTarget = process.env.DEPLOY_TARGET?.trim().toLowerCase();
      
      // Only required when using replitAuth on Replit platform
      if (nodeEnv === "production" && authProvider === "replit" && deployTarget === "replit") {
        if (!value) {
          return "REPL_ID must be set when AUTH_PROVIDER=replit on Replit platform";
        }
      }
      
      return null;
    },
  },
];

// Tier 2: NON-FATAL - Server logs warnings but continues
const TIER2_CHECKS: EnvCheck[] = [
  {
    name: "PUBLIC_APP_URL",
    required: false,
    tier: 2,
    productionOnly: true,
    validator: (value) => {
      const nodeEnv = process.env.NODE_ENV?.trim();
      if (nodeEnv === "production") {
        if (!value) {
          return "PUBLIC_APP_URL should be set in production for OAuth callbacks (e.g., https://www.printershero.com)";
        }
        if (value.includes("localhost") || value.includes("127.0.0.1")) {
          return `PUBLIC_APP_URL contains localhost in production: ${value}`;
        }
        try {
          const url = new URL(value);
          if (url.protocol !== "https:") {
            return "PUBLIC_APP_URL should use HTTPS in production";
          }
        } catch {
          return "PUBLIC_APP_URL must be a valid URL";
        }
      }
      return null;
    },
  },
  {
    name: "GMAIL_OAUTH_REDIRECT_URI",
    required: false,
    tier: 2,
    validator: (value) => {
      if (value && (value.includes("localhost") || value.includes("127.0.0.1"))) {
        return "GMAIL_OAUTH_REDIRECT_URI contains localhost - email may not work in production";
      }
      return null;
    },
  },
  {
    name: "SUPABASE_URL",
    required: false,
    tier: 2,
    validator: (value) => {
      const hasKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
      const hasBucket = !!process.env.SUPABASE_BUCKET;
      if (value && (!hasKey || !hasBucket)) {
        return "SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY or SUPABASE_BUCKET is missing";
      }
      return null;
    },
  },
];

export interface ValidationResult {
  valid: boolean;
  tier1Errors: Array<{ var: string; message: string }>;
  tier2Warnings: Array<{ var: string; message: string }>;
}

export function validateEnvironment(): ValidationResult {
  const tier1Errors: Array<{ var: string; message: string }> = [];
  const tier2Warnings: Array<{ var: string; message: string }> = [];
  const nodeEnv = (process.env.NODE_ENV || "development").trim();
  const isProduction = nodeEnv === "production";

  // Validate Tier 1 (FATAL)
  for (const check of TIER1_CHECKS) {
    if (check.productionOnly && !isProduction) continue;

    const value = process.env[check.name];

    if (check.required && !value) {
      tier1Errors.push({
        var: check.name,
        message: `${check.name} is required but not set`,
      });
      continue;
    }

    if (check.validator) {
      const validationError = check.validator(value);
      if (validationError) {
        tier1Errors.push({
          var: check.name,
          message: validationError,
        });
      }
    }
  }

  // Validate Tier 2 (NON-FATAL)
  for (const check of TIER2_CHECKS) {
    if (check.productionOnly && !isProduction) continue;

    const value = process.env[check.name];

    if (check.validator) {
      const validationError = check.validator(value);
      if (validationError) {
        tier2Warnings.push({
          var: check.name,
          message: validationError,
        });
      }
    }
  }

  return {
    valid: tier1Errors.length === 0,
    tier1Errors,
    tier2Warnings,
  };
}

  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("   Environment Configuration Status");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`NODE_ENV: ${nodeEnv}`);
  console.log("");
  
  // Tier 1: Core Platform (FATAL if misconfigured)
  console.log("🔴 TIER 1 - Core Platform (fatal if misconfigured):");
  console.log(`   DATABASE_URL: ${process.env.DATABASE_URL ? "✓ set" : "✗ not set"}`);
  console.log(`   SESSION_SECRET: ${process.env.SESSION_SECRET ? `✓ set (${process.env.SESSION_SECRET.length} chars)` : "✗ not set"}`);
  console.log(`   AUTH_PROVIDER: ${process.env.AUTH_PROVIDER || "(not set, defaulting to local)"}`);
  
  if (process.env.AUTH_PROVIDER?.toLowerCase() === "replit") {
    console.log(`   REPLIT_OIDC_ISSUER: ${process.env.REPLIT_OIDC_ISSUER || process.env.ISSUER_URL ? "✓ set" : "✗ not set"}`);
    console.log(`   REPL_ID: ${process.env.REPL_ID ? "✓ set" : "✗ not set"}`);
  }
  
  console.log("");
  console.log("🟡 TIER 2 - Optional Features (warns only, won't block startup):");
  console.log(`   PUBLIC_APP_URL: ${process.env.PUBLIC_APP_URL || "(not set)"}`);
  console.log(`   GMAIL_OAUTH_REDIRECT_URI: ${process.env.GMAIL_OAUTH_REDIRECT_URI || "(not set, using default)"}`);
  console.log(`   SUPABASE_URL: ${process.env.SUPABASE_URL ? "✓ set" : "(not set)"}`);onsole.log(`DATABASE_URL: ${process.env.DATABASE_URL ? "✓ set" : "✗ not set"}`);
  console.log(`SESSION_SECRET: ${process.env.SESSION_SECRET ? `✓ set (${process.env.SESSION_SECRET.length} chars)` : "✗ not set"}`);
  
  if (process.env.AUTH_PROVIDER?.toLowerCase() === "replit") {
    console.log(`REPLIT_OIDC_ISSUER: ${process.env.REPLIT_OIDC_ISSUER || process.env.ISSUER_URL ? "✓ set" : "✗ not set"}`);
    console.log(`REPL_ID: ${process.env.REPL_ID ? "✓ set" : "✗ not set"}`);
  }
  // Log Tier 2 warnings (non-fatal)
  if (result.tier2Warnings.length > 0) {
    console.warn("⚠️  TIER 2 - Optional Feature Warnings (server will start):");
    for (const warning of result.tier2Warnings) {
      console.warn(`   - ${warning.var}: ${warning.message}`);
    }
    console.warn("");
  }

  // Handle Tier 1 errors (fatal)
  if (!result.valid) {
    console.error("✗ TIER 1 - Core Platform Validation FAILED");
    console.error("═══════════════════════════════════════════════════════════");
    for (const error of result.tier1Errors) {
      console.error(`✗ ${error.var}`);
      console.error(`  ${error.message}`);
      console.error("");
    }
    console.error("═══════════════════════════════════════════════════════════");
    console.error("Server cannot start with invalid core platform configuration.");
    console.error("Fix the TIER 1 errors above and restart the server.");
    console.error("(TIER 2 warnings are non-fatal and won't block startup)");
    console.error("═══════════════════════════════════════════════════════════\n");
    process.exit(1);
  }

  console.log("✓ TIER 1 validation passed - Core platform OK");
  if (result.tier2Warnings.length > 0) {
    console.log("⚠️  TIER 2 warnings present - Some optional features may be unavailable\n");
  } else {
    console.log("✓ TIER 2 validation passed - All optional features configured\n");
  }
    }
    console.error("═══════════════════════════════════════════════════════════");
    console.error("Server cannot start with invalid environment configuration.");
    console.error("Fix the errors above and restart the server.");
    console.error("═══════════════════════════════════════════════════════════\n");
    process.exit(1);
  }

  console.log("✓ Environment validation passed\n");
}
