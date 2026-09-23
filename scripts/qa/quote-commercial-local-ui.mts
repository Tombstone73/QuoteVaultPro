/** Local production-frontend smoke, HTTP persistence mocked in memory.
 * Run: npm run build && npx tsx scripts/qa/quote-commercial-local-ui.mts
 * External traffic is blocked. No app server, shared database or credentials.
 */
import assert from "node:assert/strict";
import { preview } from "vite";
import { chromium } from "playwright";
import { generateQuotePdfBytes } from "../../server/lib/quotePdf";
import { validateQuoteLineOrder } from "../../shared/quoteLineOrder";

const server = await preview({ preview: { host: "127.0.0.1", port: 4188, strictPort: true } });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on("pageerror", (error) => console.error("Browser error:", error.stack));
const origin = "http://127.0.0.1:4188";
const customer = { id: "customer", companyName: "Local document fixture", status: "active", contacts: [] };
const product = { id: "product", name: "Sign", isActive: true, measurementMode: "dimensions_required", optionsJson: [], variants: [] };
let lines = [
  { id: "a", productName: "Parent ACM", linePrice: "220.44", width: 54.21, height: 47.5 },
  { id: "a1", parentLineItemId: "a", productName: "Child Vinyl", linePrice: "108.00", width: 54.21, height: 47.5 },
  { id: "b", productName: "Parent Vinyl", linePrice: "30.00", width: 27.8, height: 24 },
  { id: "b1", parentLineItemId: "b", productName: "Child ACM", linePrice: "66.13", width: 27.39, height: 24 },
].map((line, displayOrder) => ({ ...line, displayOrder, quantity: 2, quoteId: "q", productId: "product", status: "active", lineItemRole: line.parentLineItemId ? "child" : "standalone", specsJson: {}, selectedOptions: [] }));
let quote = { id: "q", quoteNumber: 20507, displayNumber: "QT-20507", status: "draft", customerId: customer.id, customer, label: "Local reorder fixture", subtotal: "424.57", taxAmount: "0.00", totalPrice: "424.57", taxRate: "0", discountAmount: "0", createdAt: "2026-09-01T12:00:00Z", shippingMethod: "pickup", lineItems: lines };
let reorders = 0, reads = 0, previewRequests = 0;
const paths = new Set<string>();
await page.route("**/*", async (route) => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== origin) { await route.abort(); return; }
  if (!url.pathname.startsWith("/api/")) { await route.continue(); return; }
  paths.add(`${request.method()} ${url.pathname}`);
  let body: unknown = { success: true, data: [] };
  if (url.pathname === "/api/auth/session") body = { authenticated: true, user: { id: "staff", role: "admin", isAdmin: true, accountType: "STAFF", email: "staff@example.test" } };
  else if (url.pathname === "/api/me/orgs") body = { success: true, data: { orgs: [{ id: "org", name: "Local test", slug: "test", role: "admin" }], lastActiveOrgId: "org" } };
  else if (url.pathname === "/api/organization/current") body = { id: "org", name: "Local test", settings: { currency: "USD" } };
  else if (url.pathname === "/api/organization/preferences") body = { success: true, data: { quotes: {}, orders: {}, inventory: { reservations: { mode: "off" } } } };
  else if (url.pathname === "/api/system/environment") body = { success: true, data: { appRuntime: "local", apiRuntime: "local", databaseRuntime: "unknown", databaseLabel: "Mock HTTP only", canMutateSharedDevData: false, migrationRunsOnStartup: false, warningMessage: null, buildFingerprint: { gitSha: null, buildId: "local-ui", environment: "local", operatorArchitectureVersion: "v1" } } };
  else if (url.pathname === "/api/operational-summary") body = { success: true, data: { invoices: { readyToFinalizeNeverSent: 0 } } };
  else if (url.pathname === "/api/products") body = [product];
  else if (url.pathname === "/api/customers/customer") body = customer;
  else if (url.pathname === "/api/customers") body = { customers: [customer], data: { customers: [customer], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } } };
  else if (url.pathname === "/api/contacts") body = { contacts: [], total: 0 };
  else if (url.pathname === "/api/quotes/q/pdf") {
    previewRequests++;
    await route.fulfill({ contentType: "application/pdf", body: Buffer.from(await generateQuotePdfBytes({ quote: { ...quote, lineItems: lines } as any })) });
    return;
  } else if (url.pathname === "/api/quotes/q/line-items/order") {
    const input = request.postDataJSON();
    validateQuoteLineOrder(lines, input.orderedIds, input.expectedIds);
    lines = input.orderedIds.map((id: string, displayOrder: number) => ({ ...lines.find((line) => line.id === id)!, displayOrder }));
    reorders++;
    body = { success: true, data: lines.map(({ id, displayOrder }) => ({ id, displayOrder })) };
  } else if (url.pathname === "/api/quotes/q") {
    if (request.method() === "PATCH") quote = { ...quote, ...request.postDataJSON() };
    else reads++;
    body = { ...quote, lineItems: lines };
  } else if (/^\/api\/quotes\/q\/line-items\/(a|a1|b|b1)$/.test(url.pathname) && request.method() === "PATCH") {
    const { displayOrder: _ignored, ...patch } = request.postDataJSON();
    lines = lines.map((line) => line.id === url.pathname.split("/").at(-1) ? { ...line, ...patch } : line);
    body = { success: true, data: lines.find((line) => line.id === url.pathname.split("/").at(-1)) };
  }
  await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
});
const uiIds = () => page.locator('[id^="line-item-"]').evaluateAll((elements) => elements.map((el) => el.id).filter((id) => /^line-item-(a|a1|b|b1)$/.test(id)));
try {
  await page.goto(`${origin}/quotes/q/edit`);
  await page.locator("#line-item-b").waitFor();
  assert.deepEqual(await uiIds(), ["line-item-a", "line-item-a1", "line-item-b", "line-item-b1"]);
  const source = await page.locator("#line-item-b").getByRole("button", { name: "Drag to reorder" }).boundingBox();
  const target = await page.locator("#line-item-a").getByRole("button", { name: "Drag to reorder" }).boundingBox();
  assert.ok(source && target);
  const response = page.waitForResponse((res) => res.url().endsWith("/line-items/order"));
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() => document.querySelector('[id^="line-item-"]')?.id === "line-item-b");
  const expected = ["line-item-b", "line-item-b1", "line-item-a", "line-item-a1"];
  assert.deepEqual(await uiIds(), expected);
  assert.equal(reorders, 1);
  // Real Save invokes unrelated normal line PATCHes then query invalidation.
  await page.keyboard.press("Escape");
  const save = page.getByRole("button", { name: "Save Changes", exact: true });
  if (await save.count()) {
    await save.click();
    await page.getByText("Quote saved", { exact: true }).waitFor();
  } else throw new Error("Expected real Quote Save control");
  assert.deepEqual(await uiIds(), expected);
  await page.reload();
  await page.locator("#line-item-b").waitFor();
  assert.deepEqual(await uiIds(), expected);
  assert.equal(lines.find((line) => line.id === "a1")!.parentLineItemId, "a");
  assert.equal(lines.find((line) => line.id === "b1")!.parentLineItemId, "b");
  assert.equal(lines.reduce((sum, line) => sum + Math.round(Number(line.linePrice) * 100), 0), 42457);
  const previewResponse = page.waitForResponse((res) => res.url().endsWith("/quotes/q/pdf"));
  await page.getByRole("button", { name: /Preview/ }).first().click();
  assert.equal((await previewResponse).status(), 200);
  assert.equal(previewRequests, 1);
  assert.ok(reads >= 3, "Reorder and ordinary save must refetch");
  console.log("PASS: actual V1 UI drag moves parent and children, one reorder request, normal Save/refetch and reload preserve order, internal children and subtotal retained, customer PDF preview requested. HTTP persistence is mocked; no real PostgreSQL or live validation.");
} catch (error) {
  console.error("UI:", (await page.locator("body").innerText()).slice(0, 7000));
  console.error("API paths:", [...paths]);
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.httpServer!.close(() => resolve()));
}
