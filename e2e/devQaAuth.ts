import { expect, type Page } from "@playwright/test";

type DevQaConfig = {
  baseUrl: URL;
  email: string;
  password: string;
  expectedOrganizationId: string;
  expectedOrganizationSlug: string;
};

type JsonResponse = {
  status: number;
  body: unknown;
};

const PRODUCTION_HOSTS = new Set([
  "printershero.com",
  "www.printershero.com",
  "api.printershero.com",
]);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[DEV QA auth] ${name} is required (value not logged).`);
  }
  return value;
}

function parseOrigin(name: string, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`[DEV QA auth] ${name} must be an absolute http(s) origin.`);
  }

  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`[DEV QA auth] ${name} must be an origin without a path, query, or fragment.`);
  }

  return parsed;
}

function assertSafeDevTarget(baseUrl: URL, allowedOrigin: URL): void {
  const hostname = baseUrl.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(hostname)) {
    throw new Error(`[DEV QA auth] Refusing production target ${baseUrl.origin}.`);
  }

  if (baseUrl.origin !== allowedOrigin.origin) {
    throw new Error("[DEV QA auth] PLAYWRIGHT_BASE_URL must exactly match PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN.");
  }

  if (PRODUCTION_HOSTS.has(allowedOrigin.hostname.toLowerCase())) {
    throw new Error(`[DEV QA auth] Refusing production allowed origin ${allowedOrigin.origin}.`);
  }
}

export function getDevQaConfig(): DevQaConfig {
  const baseUrl = parseOrigin("PLAYWRIGHT_BASE_URL", requireEnv("PLAYWRIGHT_BASE_URL"));
  const allowedOrigin = parseOrigin(
    "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN",
    requireEnv("PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN"),
  );
  assertSafeDevTarget(baseUrl, allowedOrigin);

  return {
    baseUrl,
    email: requireEnv("PRINTERSHERO_DEV_QA_EMAIL").toLowerCase(),
    password: requireEnv("PRINTERSHERO_DEV_QA_PASSWORD"),
    expectedOrganizationId: requireEnv("PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID"),
    expectedOrganizationSlug: requireEnv("PRINTERSHERO_DEV_QA_EXPECTED_ORG_SLUG").toLowerCase(),
  };
}

async function jsonRequest(page: Page, baseUrl: URL, path: string, init?: { method?: string; data?: unknown }): Promise<JsonResponse> {
  const response = await page.request.fetch(new URL(path, baseUrl).toString(), init);
  return {
    status: response.status(),
    body: await response.json().catch(() => null),
  };
}

function describeLoginFailure(args: {
  target: string;
  healthStatus: number | null;
  loginPageReached: boolean;
  submitAttempted: boolean;
  loginStatus: number | null;
  authenticatedAppReached: boolean;
}): Error {
  const category = args.loginStatus === 401 || args.loginStatus === 403
    ? "credentials_rejected"
    : args.loginStatus !== null && args.loginStatus >= 500
      ? "server_error"
      : args.loginStatus === null
        ? "no_login_response"
        : "login_not_completed";
  return new Error(
    `[DEV QA auth] authentication failed: target=${args.target}; health_status=${args.healthStatus ?? "not_reached"}; ` +
      `login_page_reached=${args.loginPageReached}; credential_env_present=yes; submit_attempted=${args.submitAttempted}; ` +
      `login_status=${args.loginStatus ?? "unavailable"}; authenticated_app_reached=${args.authenticatedAppReached}; category=${category}.`,
  );
}

/**
 * Performs one normal DEV password login and verifies that it established the
 * dedicated QA identity in its intended DEV organization. This deliberately
 * does not load a prior storage-state file, so a later run can always recover
 * from an expired session or a browser that was closed after the prior run.
 */
export async function authenticateDevQaUser(page: Page): Promise<void> {
  const config = getDevQaConfig();
  const diagnostics = {
    target: config.baseUrl.origin,
    healthStatus: null as number | null,
    loginPageReached: false,
    submitAttempted: false,
    loginStatus: null as number | null,
    authenticatedAppReached: false,
  };

  const health = await page.request.get(new URL("/api/health", config.baseUrl).toString()).catch(() => null);
  diagnostics.healthStatus = health?.status() ?? null;
  if (!health?.ok()) {
    throw describeLoginFailure(diagnostics);
  }

  const healthBody = await health.json().catch(() => null) as { publicWebOrigin?: unknown } | null;
  // Railway DEV runs the production server build, so /api/health may report
  // NODE_ENV=production. Bind the unauthenticated check to the reviewed DEV
  // public origin; the authenticated runtime summary below then proves this is
  // deployed DEV rather than production.
  if (healthBody?.publicWebOrigin !== config.baseUrl.origin) {
    throw new Error(`[DEV QA auth] Refusing target ${config.baseUrl.origin}: /api/health public origin did not match the approved DEV target.`);
  }

  await page.goto(new URL("/login", config.baseUrl).toString(), { waitUntil: "domcontentloaded" });
  diagnostics.loginPageReached = await page.locator("#email").isVisible().catch(() => false)
    && await page.locator("#password").isVisible().catch(() => false);
  if (!diagnostics.loginPageReached) {
    throw describeLoginFailure(diagnostics);
  }

  await page.locator("#email").fill(config.email);
  await page.locator("#password").fill(config.password);
  const loginResponse = page.waitForResponse(
    (response) => response.url() === new URL("/api/auth/login", config.baseUrl).toString(),
    { timeout: 30_000 },
  ).catch(() => null);
  diagnostics.submitAttempted = true;
  await page.locator('button[type="submit"]').click();
  const response = await loginResponse;
  diagnostics.loginStatus = response?.status() ?? null;

  try {
    await page.waitForURL((url) => url.origin === config.baseUrl.origin && url.pathname !== "/login", { timeout: 30_000 });
    diagnostics.authenticatedAppReached = true;
  } catch {
    throw describeLoginFailure(diagnostics);
  }

  const session = await jsonRequest(page, config.baseUrl, "/api/auth/session");
  const sessionBody = session.body as { authenticated?: unknown; mustChangePassword?: unknown; user?: { email?: unknown } } | null;
  if (session.status !== 200 || sessionBody?.authenticated !== true) {
    throw new Error(`[DEV QA auth] Session verification failed after login (status=${session.status}).`);
  }
  if (typeof sessionBody.user?.email !== "string" || sessionBody.user.email.toLowerCase() !== config.email) {
    throw new Error("[DEV QA auth] Session identity does not match the configured DEV QA user.");
  }
  if (sessionBody.mustChangePassword === true) {
    throw new Error("[DEV QA auth] Dedicated QA user is still in invite/password-change state.");
  }

  const orgs = await jsonRequest(page, config.baseUrl, "/api/me/orgs");
  const orgBody = orgs.body as {
    success?: unknown;
    data?: { lastActiveOrgId?: unknown; orgs?: Array<{ id?: unknown; slug?: unknown }> };
  } | null;
  const memberships = orgBody?.data?.orgs ?? [];
  const expectedMembership = memberships.find(
    (org) => org.id === config.expectedOrganizationId && typeof org.slug === "string" && org.slug.toLowerCase() === config.expectedOrganizationSlug,
  );
  if (orgs.status !== 200 || orgBody?.success !== true || memberships.length !== 1 || !expectedMembership) {
    throw new Error("[DEV QA auth] QA identity must have exactly one membership: the configured DEV organization.");
  }

  if (orgBody.data?.lastActiveOrgId !== config.expectedOrganizationId) {
    const setActive = await jsonRequest(page, config.baseUrl, "/api/me/active-org", {
      method: "POST",
      data: { orgId: config.expectedOrganizationId },
    });
    if (setActive.status !== 200) {
      throw new Error(`[DEV QA auth] Could not select the configured DEV organization (status=${setActive.status}).`);
    }
  }

  const environment = await jsonRequest(page, config.baseUrl, "/api/system/environment");
  const environmentBody = environment.body as { success?: unknown; data?: { appRuntime?: unknown; apiRuntime?: unknown } } | null;
  if (
    environment.status !== 200 ||
    environmentBody?.success !== true ||
    environmentBody.data?.appRuntime !== "deployed-dev" ||
    environmentBody.data?.apiRuntime !== "deployed-dev"
  ) {
    throw new Error("[DEV QA auth] Authenticated runtime verification did not confirm deployed DEV.");
  }

  await page.goto(new URL("/dashboard", config.baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
}
