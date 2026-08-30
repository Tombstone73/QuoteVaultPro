import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const importPatterns = [
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const violations = [];

const listTypeScriptFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(candidate);
    return entry.isFile() && /\.(?:[cm]?ts|[cm]?js|tsx)$/u.test(entry.name) ? [candidate] : [];
  }));
  return nested.flat();
};

const isPath = (source, target) => source.replaceAll("\\", "/").includes(target);
const isRelativeTo = (specifier, filename, fragment) =>
  specifier.startsWith(".") && isPath(path.normalize(path.resolve(path.dirname(filename), specifier)), fragment);
const imported = (specifier, filename, fragment) =>
  isPath(specifier, fragment) || isRelativeTo(specifier, filename, fragment);
const isRawDatabasePackage = (specifier) =>
  ["pg", "drizzle-orm", "@neondatabase/serverless"].includes(specifier);
// Product publication is still canonically owned by the existing server-side
// publisher.  This one composition-root bridge is intentionally structural:
// V2 supplies authority/idempotency around it and never imports V1 routes or
// repositories. Keep every other server service outside the V2 boundary.
const isCanonicalProductPublicationBridge = (relativeFilename, specifier) =>
  relativeFilename === "infrastructure/sales/authenticatedQuoteRuntime.ts" &&
  specifier.endsWith("server/services/products/canonicalProductPublishOperations.js");
const isCanonicalOrganizationLogoStorageBridge = (relativeFilename, specifier) =>
  relativeFilename === "infrastructure/organization/organizationLogoAdoption.ts" &&
  specifier.endsWith("server/services/storage/StorageApplicationService.js");
// QuickBooks OAuth/client code is retained provider infrastructure. The V2
// accounting queue passes immutable V2 projections and never imports legacy
// financial repositories; keep this bridge singular and explicit.
const isQuickBooksBillingProviderBridge = (relativeFilename, specifier) =>
  relativeFilename === "infrastructure/accounting/quickBooksBillingQueue.ts" &&
  specifier.endsWith("server/quickbooksService.js");

// Test and future infrastructure source must obey the same no-POC/no-V1
// runtime boundary. Generated output is intentionally not scanned.
for (const filename of await listTypeScriptFiles(root)) {
  const source = await readFile(filename, "utf8");
  const relativeFilename = path.relative(root, filename).replaceAll("\\", "/");
  for (const importPattern of importPatterns) {
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
    const fail = (rule) => violations.push(`${relativeFilename}: ${rule} (${specifier})`);

    if (imported(specifier, filename, "v2-poc") || imported(specifier, filename, "server/index") || imported(specifier, filename, "server/routes") || ((imported(specifier, filename, "server/services") || imported(specifier, filename, "server/quickbooksService")) && !isCanonicalProductPublicationBridge(relativeFilename, specifier) && !isCanonicalOrganizationLogoStorageBridge(relativeFilename, specifier) && !isQuickBooksBillingProviderBridge(relativeFilename, specifier))) {
      fail("production V2 must not import POC or V1 route/service code");
    }
    if (relativeFilename.startsWith("src/interfaces/") && (imported(specifier, filename, "/repositories") || imported(specifier, filename, "/infrastructure/persistence") || imported(specifier, filename, "server/db") || isRawDatabasePackage(specifier))) {
      fail("interfaces must not import repositories or raw database clients");
    }
    if (relativeFilename.startsWith("src/authorization/") && (imported(specifier, filename, "/repositories") || imported(specifier, filename, "/interfaces") || imported(specifier, filename, "/infrastructure/persistence") || imported(specifier, filename, "server/db") || isRawDatabasePackage(specifier))) {
      fail("authorization must remain persistence and interface free");
    }
    if (
      !relativeFilename.startsWith("tests/") &&
      imported(specifier, filename, "staffAuthorityCompatibility") &&
      relativeFilename !== "src/authorization/temporaryStaffPrincipalIssuer.ts"
    ) {
      fail("temporary Staff compatibility resolver may only be consumed through its PrincipalIssuer");
    }
    if (!relativeFilename.startsWith("tests/") &&
      (imported(specifier, filename, "temporaryStaffPrincipalIssuer") || imported(specifier, filename, "postgresStaffMembershipRead")) &&
      relativeFilename !== "scripts/runM14StaffAuthorityCompatibilityRehearsal.ts" &&
      relativeFilename !== "src/authorization/temporaryStaffPrincipalIssuer.ts" &&
      relativeFilename !== "infrastructure/compatibility/postgresStaffMembershipRead.ts") {
      fail("M1.4 temporary Staff authority may not be imported by normal V2 runtime code");
    }
    if (relativeFilename.startsWith("src/repositories/") && imported(specifier, filename, "/interfaces")) {
      fail("repositories must not import interfaces");
    }
      if ((relativeFilename.startsWith("src/application/") || relativeFilename.startsWith("src/domain/")) && (imported(specifier, filename, "/interfaces") || imported(specifier, filename, "client/") || imported(specifier, filename, "/infrastructure/persistence") || imported(specifier, filename, "server/db"))) {
        fail("application and domain modules must not import interface, frontend, or persistence implementation code");
      }
    }
  }
}

if (violations.length) {
  console.error("V2 import-boundary violations:\n" + violations.map((violation) => `- ${violation}`).join("\n"));
  process.exit(1);
}

console.log("V2 import boundaries passed.");
