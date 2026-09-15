import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const DEV_QA_FRONTEND_ORIGIN = "https://dev.printershero.com";
const DEV_QA_BACKEND_ORIGIN = "https://api-dev.printershero.com";

export type DevQaTargetConfig = {
  baseUrl: URL;
  backendUrl: URL;
  expectedBackendVersion: string;
};

type DevQaConfig = DevQaTargetConfig & {
  email: string;
  password: string;
  expectedOrganizationId: string;
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

function assertSafeDevTarget(baseUrl: URL, allowedOrigin: URL, backendUrl: URL): void {
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

  if (baseUrl.origin !== DEV_QA_FRONTEND_ORIGIN || allowedOrigin.origin !== DEV_QA_FRONTEND_ORIGIN) {
    throw new Error(`[DEV QA auth] Refusing unreviewed frontend origin ${baseUrl.origin}.`);
  }

  if (PRODUCTION_HOSTS.has(backendUrl.hostname.toLowerCase()) || backendUrl.origin !== DEV_QA_BACKEND_ORIGIN) {
    throw new Error(`[DEV QA auth] Refusing unreviewed backend origin ${backendUrl.origin}.`);
  }
}

export function getDevQaTargetConfig(environment: Readonly<Record<string, string | undefined>> = process.env): DevQaTargetConfig {
  const required = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`[DEV QA auth] ${name} is required (value not logged).`);
    return value;
  };
  const baseUrl = parseOrigin("PLAYWRIGHT_BASE_URL", required("PLAYWRIGHT_BASE_URL"));
  const allowedOrigin = parseOrigin(
    "PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN",
    required("PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN"),
  );
  const backendUrl = parseOrigin(
    "PRINTERSHERO_DEV_QA_BACKEND_ORIGIN",
    required("PRINTERSHERO_DEV_QA_BACKEND_ORIGIN"),
  );
  const expectedBackendVersion = required("PRINTERSHERO_DEV_QA_EXPECTED_BACKEND_VERSION").toLowerCase();
  if (!/^[a-f0-9]{7,64}$/.test(expectedBackendVersion)) {
    throw new Error("[DEV QA auth] PRINTERSHERO_DEV_QA_EXPECTED_BACKEND_VERSION must be a Git commit SHA.");
  }
  assertSafeDevTarget(baseUrl, allowedOrigin, backendUrl);

  return { baseUrl, backendUrl, expectedBackendVersion };
}

export function getDevQaConfig(): DevQaConfig {
  return {
    ...getDevQaTargetConfig(),
    email: requireEnv("PRINTERSHERO_DEV_QA_EMAIL").toLowerCase(),
    password: requireEnv("PRINTERSHERO_DEV_QA_PASSWORD"),
    expectedOrganizationId: requireEnv("PRINTERSHERO_DEV_QA_EXPECTED_ORG_ID"),
  };
}

async function jsonRequest(page: Page, baseUrl: URL, path: string, init?: { method?: string; data?: unknown; headers?: Record<string, string> }): Promise<JsonResponse> {
  return page.evaluate(async ({ url, request }) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        method: request?.method ?? "GET",
        credentials: "include",
        headers: request?.data === undefined ? request?.headers : { "Content-Type": "application/json", ...(request.headers ?? {}) },
        body: request?.data === undefined ? undefined : JSON.stringify(request.data),
        signal: controller.signal,
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    } finally {
      window.clearTimeout(timeout);
    }
  }, { url: new URL(path, baseUrl).toString(), request: init });
}

async function responseJson(request: APIRequestContext, url: URL): Promise<JsonResponse> {
  const response = await request.get(url.toString()).catch(() => null);
  return { status: response?.status() ?? 0, body: await response?.json().catch(() => null) };
}

/**
 * Proves the reviewed V2 DEV frontend/backend pair before the harness reads or
 * submits QA credentials.  The V2 frontend intentionally proxies only /v2/*;
 * legacy /api/* URLs are not an application-health contract.
 */
export async function assertV2DevQaEnvironment(request: APIRequestContext, target = getDevQaTargetConfig()): Promise<void> {
  const health = await responseJson(request, new URL("/health", target.backendUrl));
  if (health.status !== 200 || (health.body as { status?: unknown; service?: unknown } | null)?.status !== "ok" || (health.body as { service?: unknown } | null)?.service !== "printershero-v2") {
    throw new Error(`[DEV QA auth] Reviewed DEV backend health check failed (status=${health.status}).`);
  }

  const ready = await responseJson(request, new URL("/ready", target.backendUrl));
  if (ready.status !== 200 || (ready.body as { status?: unknown; checks?: { application?: unknown } } | null)?.status !== "ready" || (ready.body as { checks?: { application?: unknown } } | null)?.checks?.application !== "ok") {
    throw new Error(`[DEV QA auth] Reviewed DEV backend readiness check failed (status=${ready.status}).`);
  }

  const version = await responseJson(request, new URL("/version", target.backendUrl));
  const versionBody = version.body as { service?: unknown; version?: unknown } | null;
  if (version.status !== 200 || versionBody?.service !== "printershero-v2" || versionBody.version !== target.expectedBackendVersion) {
    throw new Error(`[DEV QA auth] Reviewed DEV backend version did not match the configured release (status=${version.status}).`);
  }

  const frontendSession = await responseJson(request, new URL("/v2/auth/session", target.baseUrl));
  const sessionBody = frontendSession.body as { ok?: unknown; error?: { code?: unknown } } | null;
  if (frontendSession.status !== 401 || sessionBody?.ok !== false || sessionBody.error?.code !== "UNAUTHENTICATED") {
    throw new Error(`[DEV QA auth] V2 frontend proxy check failed (status=${frontendSession.status}).`);
  }
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

async function loginControl(page: Page, id: string, accessibleName: string): Promise<Locator> {
  const idControl = page.locator(`#${id}`);
  const accessibleControl = page.getByRole("textbox", { name: accessibleName });
  const candidate = idControl.or(accessibleControl).first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  return candidate;
}

async function loginSubmitControl(page: Page): Promise<Locator> {
  const submitControl = page.locator('button[type="submit"]');
  const accessibleControl = page.getByRole("button", { name: "Sign In", exact: true });
  const candidate = submitControl.or(accessibleControl).first();
  await candidate.waitFor({ state: "visible", timeout: 10_000 });
  return candidate;
}

/**
 * Performs one normal DEV password login and verifies that it established the
 * dedicated QA identity in its intended DEV organization. This deliberately
 * does not load a prior storage-state file, so a later run can always recover
 * from an expired session or a browser that was closed after the prior run.
 */
export async function authenticateDevQaUser(page: Page): Promise<void> {
  const target = getDevQaTargetConfig();
  await assertV2DevQaEnvironment(page.request, target);
  const config = getDevQaConfig();
  const diagnostics = {
    target: config.baseUrl.origin,
    healthStatus: null as number | null,
    loginPageReached: false,
    submitAttempted: false,
    loginStatus: null as number | null,
    authenticatedAppReached: false,
  };

  diagnostics.healthStatus = 200;

  await page.goto(config.baseUrl.toString(), { waitUntil: "domcontentloaded" });
  const emailControl = await loginControl(page, "email", "Email");
  const passwordControl = await loginControl(page, "password", "Password");
  const submitControl = await loginSubmitControl(page);
  diagnostics.loginPageReached = await emailControl.isVisible().catch(() => false)
    && await passwordControl.isVisible().catch(() => false)
    && await submitControl.isVisible().catch(() => false);
  if (!diagnostics.loginPageReached) {
    throw describeLoginFailure(diagnostics);
  }

  await emailControl.fill(config.email);
  await passwordControl.fill(config.password);
  const loginResponse = page.waitForResponse(
    (response) => response.url() === new URL("/v2/auth/login", config.baseUrl).toString(),
    { timeout: 30_000 },
  ).catch(() => null);
  diagnostics.submitAttempted = true;
  await submitControl.click();
  const response = await loginResponse;
  diagnostics.loginStatus = response?.status() ?? null;

  // Verify through the normal browser V2 session surface after login. V2 keeps
  // the current route while AuthGate replaces its login content.
  const session = await jsonRequest(page, config.baseUrl, "/v2/auth/session");
  const sessionBody = session.body as { ok?: unknown; data?: { staff?: { email?: unknown }; organizations?: Array<{ id?: unknown }>; activeOrganizationId?: unknown; csrfToken?: unknown } } | null;
  if (session.status !== 200 || sessionBody?.ok !== true) {
    throw new Error(`[DEV QA auth] Session verification failed after login (status=${session.status}).`);
  }
  if (typeof sessionBody.data?.staff?.email !== "string" || sessionBody.data.staff.email.toLowerCase() !== config.email) {
    throw new Error("[DEV QA auth] Session identity does not match the configured DEV QA user.");
  }

  const memberships = sessionBody.data?.organizations ?? [];
  if (memberships.length !== 1 || memberships[0]?.id !== config.expectedOrganizationId) {
    throw new Error("[DEV QA auth] QA identity must have exactly one membership: the configured DEV organization.");
  }

  if (sessionBody.data?.activeOrganizationId !== config.expectedOrganizationId) {
    if (typeof sessionBody.data?.csrfToken !== "string" || !sessionBody.data.csrfToken) {
      throw new Error("[DEV QA auth] V2 session did not issue a CSRF token for organization selection.");
    }
    const setActive = await jsonRequest(page, config.baseUrl, "/v2/auth/active-organization", {
      method: "POST",
      headers: { "x-v2-csrf-token": sessionBody.data.csrfToken },
      data: { organizationId: config.expectedOrganizationId },
    });
    const activeBody = setActive.body as { ok?: unknown; data?: { activeOrganizationId?: unknown } } | null;
    if (setActive.status !== 200 || activeBody?.ok !== true || activeBody.data?.activeOrganizationId !== config.expectedOrganizationId) {
      throw new Error(`[DEV QA auth] Could not select the configured DEV organization (status=${setActive.status}).`);
    }
  }

  try {
    await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeHidden({ timeout: 10_000 });
    diagnostics.authenticatedAppReached = true;
  } catch {
    throw describeLoginFailure(diagnostics);
  }

  await page.goto(config.baseUrl.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeHidden({ timeout: 10_000 });
}
