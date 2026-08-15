import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Fixture = Readonly<{
  organizationA: string; organizationB: string; customerA: string; contactA: string;
  customerB: string; contactB: string; dimensionalProductA: string; quantityProductA: string; productB: string;
}>;
const login = async (api: APIRequestContext, actor: "staff-a" | "limited-a" | "staff-b") => {
  const response = await api.post("/_v2-browser-test/session", { data: { actor } });
  expect(response.status()).toBe(204);
};
const fixture = async (api: APIRequestContext): Promise<Fixture> => {
  const response = await api.get("/_v2-browser-test/fixture");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as Fixture;
};
const openOrganization = async (page: Page, organizationId: string) => {
  await page.goto("/");
  await page.getByLabel("Organization ID").fill(organizationId);
  await expect(page.getByLabel("Customer").first()).toBeEnabled();
};
const createDimensionalQuote = async (page: Page, f: Fixture) => {
  await page.getByLabel("Customer").first().selectOption(f.customerA);
  await page.getByLabel("Contact").first().selectOption(f.contactA);
  await page.getByLabel("Product").first().selectOption(f.dimensionalProductA);
  await page.getByLabel("Width (in)").fill("24");
  await page.getByLabel("Height (in)").fill("18");
  await page.getByLabel("Quantity").first().fill("2");
  const created = page.waitForResponse((response) => response.url().includes(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`) && response.request().method() === "POST" && response.status() === 200);
  await page.getByRole("button", { name: "Create Quote" }).click();
  const response = await created;
  const body = await response.json();
  expect(body.ok).toBe(true);
  await expect(page.getByText("Calculated total:")).toBeVisible();
  return body.data.quote.quote.quoteId as string;
};

test.describe.serial("M1.7.5B authenticated Quote browser proof", () => {
  test("unauthenticated UI cannot bootstrap or mutate a Quote", async ({ page }) => {
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    await expect(page.getByText("You do not have permission for that Quote action.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Quote" })).toBeDisabled();
  });

  test("real Passport staff session creates and reads a dimensional Quote", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    const read = await page.context().request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes/${encodeURIComponent(quoteId)}`);
    expect(read.ok()).toBeTruthy();
    const body = await read.json();
    expect(body.data.quote.customerContact.customerId).toBe(f.customerA);
    expect(body.data.quote.customerContact.contactId).toBe(f.contactA);
    expect(body.data.quote.lines[0].productId).toBe(f.dimensionalProductA);
    expect(body.data.quote.lines[0].quantity).toBe(2);
    expect(body.data.revision).toBeTruthy();
  });

  test("CSRF is session-bound and forged identity fields are not authority", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    const bootstrap = await page.context().request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/ui-bootstrap`);
    const token = (await bootstrap.json()).data.csrfToken as string;
    const missing = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`, { data: { businessRequestId: "browser-csrf-missing" } });
    expect(missing.status()).toBe(403);
    const forged = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationB)}/quotes`, { headers: { "x-v2-csrf-token": token, "x-forged-staff-id": "staff-b" }, data: { businessRequestId: "browser-forged-authority", principal: { organizationId: f.organizationB, capabilities: ["quote.create"] } } });
    expect(forged.status()).toBe(404);
    await page.goto("/");
  });

  test("invalid, previous-session, and cross-session CSRF tokens fail before Quote work", async ({ page, browser }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    const bootstrap = await page.context().request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/ui-bootstrap`);
    const token = (await bootstrap.json()).data.csrfToken as string;
    const invalid = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`, { headers: { "x-v2-csrf-token": "not-a-token" }, data: { businessRequestId: "browser-csrf-invalid" } });
    expect(invalid.status()).toBe(403);
    await login(page.context().request, "staff-a");
    const previous = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`, { headers: { "x-v2-csrf-token": token }, data: { businessRequestId: "browser-csrf-previous" } });
    expect(previous.status()).toBe(403);
    const other = await browser.newContext({ baseURL: "http://127.0.0.1:4174" });
    try {
      await login(other.request, "limited-a");
      const crossSession = await other.request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`, { headers: { "x-v2-csrf-token": token }, data: { businessRequestId: "browser-csrf-cross-session" } });
      expect(crossSession.status()).toBe(403);
    } finally { await other.close(); }
  });

  test("organization and session replacement clear browser data before a new scope is shown", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    await expect(page.getByLabel("Customer").first()).toContainText("Browser A");
    await login(page.context().request, "staff-b");
    await page.getByLabel("Organization ID").fill(`${f.organizationA}-old-session`);
    await expect(page.getByLabel("Organization ID")).toHaveValue("");
    await openOrganization(page, f.organizationB);
    await expect(page.getByLabel("Customer").first()).toContainText("Browser B");
    await expect(page.getByLabel("Customer").first()).not.toContainText("Browser A");
  });

  test("quantity-only, themes, and readonly override projection use the same real UI", async ({ page }) => {
    await login(page.context().request, "limited-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    await page.getByLabel("Customer").first().selectOption(f.customerA);
    await page.getByLabel("Contact").first().selectOption(f.contactA);
    await page.getByLabel("Product").first().selectOption(f.quantityProductA);
    await expect(page.getByLabel("Width (in)")).toHaveCount(0);
    await page.getByLabel("Quantity").first().fill("3");
    await expect(page.getByLabel("Selling price decision")).toHaveCount(0);
    for (const theme of ["printershero", "corporate", "industrial"]) {
      await page.getByLabel("Theme").selectOption(theme);
      await expect(page.getByLabel("Customer").first()).toBeVisible();
      await expect(page.getByLabel("Product").first()).toBeVisible();
    }
  });

  test("a Product definition change never silently rewrites a persisted Quote line", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    await createDimensionalQuote(page, f);
    const changed = await page.context().request.post("/_v2-browser-test/product-definition-change");
    expect(changed.status()).toBe(204);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await expect(page.getByText(/persisted Quote configuration remains unchanged/i)).toBeVisible();
    await expect(page.getByText("legacy")).toBeVisible();
  });
});
