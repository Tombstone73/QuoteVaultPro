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
  await page.getByLabel("PO").fill("Browser PO");
  await page.getByLabel("Requested due date").fill("2026-12-31");
  await page.getByLabel("Commercial notes").fill("Browser-created note");
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
const readback = async (page: Page, quoteId: string) => {
  const response = await page.context().request.get(`/_v2-browser-test/readback/${encodeURIComponent(quoteId)}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as {
    document: Record<string, unknown>; lines: Array<Record<string, unknown>>;
    checkpoints: Array<Record<string, unknown>>; audit: Array<Record<string, unknown>>;
    operations: Array<Record<string, unknown>>;
  };
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
    const db = await readback(page, quoteId);
    expect(db.document.organization_id).toBe(f.organizationA);
    expect(db.document.id).toBe(quoteId);
    expect(db.document.business_number).toBeTruthy();
    expect(db.document.display_number).toMatch(/^QT-/u);
    expect(db.document.customer_id).toBe(f.customerA);
    expect(db.document.contact_id).toBe(f.contactA);
    expect(db.document.purchase_order_number).toBe("Browser PO");
    expect(String(db.document.requested_due_date)).toContain("2026-12-31");
    expect(db.document.commercial_notes).toBe("Browser-created note");
    expect(db.document.revision).toBeTruthy();
    expect(db.lines[0].product_id).toBe(f.dimensionalProductA);
    expect(db.lines[0].resolved_configuration).toBeTruthy();
    expect(db.lines[0].pricing_result).toBeTruthy();
    expect(db.lines[0].selling_price_decision).toBeTruthy();
    expect(db.lines[0].calculated_line_cents).toBeTruthy();
    expect(db.lines[0].selling_line_cents).toBeTruthy();
    expect(JSON.stringify(db.lines[0].resolved_configuration)).toContain("24");
    expect(JSON.stringify(db.lines[0].resolved_configuration)).toContain("18");
    expect(body.data.totals.calculatedLineAmount.cents).toBe(600);
    expect(body.data.totals.sellingLineAmount.cents).toBe(600);
    expect(db.audit).toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "quote_created", staffActorVerified: true })]));
    expect(db.operations).toEqual(expect.arrayContaining([expect.objectContaining({ status: "succeeded", result_resource_id: quoteId })]));
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

  test("existing-line editor persists server-resolved configuration, dimensions, quantity, and pricing", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    const before = await readback(page, quoteId);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    await expect(page.getByText(/draft starts from this Quote line/i)).toBeVisible();
    const editor = page.locator("tr.editor-row");
    await expect(editor.getByRole("button", { name: "Save and reprice line" })).toBeEnabled();
    const resolved = page.waitForResponse((response) => response.url().includes("/configuration/resolve") && response.status() === 200);
    await editor.getByLabel("Finish").selectOption("legacy-alternate");
    await resolved;
    await expect(editor.getByLabel("Finish")).toHaveValue("legacy-alternate");
    await editor.getByLabel("Width (in)").fill("36");
    await editor.getByLabel("Quantity").fill("3");
    const saved = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 200);
    await page.getByRole("button", { name: "Save and reprice line" }).click();
    await saved;
    await expect(page.getByText("Quote line repriced by the authoritative server.")).toBeVisible();
    const after = await readback(page, quoteId);
    expect(after.lines[0].quantity).toBe(3);
    expect(after.lines[0].resolved_configuration).not.toEqual(before.lines[0].resolved_configuration);
    expect(JSON.stringify(after.lines[0].resolved_configuration)).toContain("36");
    expect(JSON.stringify(after.lines[0].resolved_configuration)).toContain("legacy-alternate");
    expect(after.lines[0].calculated_line_cents).not.toEqual(before.lines[0].calculated_line_cents);
    await page.reload();
    await page.getByLabel("Organization ID").fill(f.organizationA);
    await page.getByLabel("Open Quote ID").fill(quoteId);
    await page.getByRole("button", { name: "Open Quote" }).click();
    await page.getByRole("button", { name: "Edit configuration" }).click();
    const reloadedEditor = page.locator("tr.editor-row");
    await expect(reloadedEditor.getByLabel("Finish")).toHaveValue("legacy-alternate");
    await expect(reloadedEditor.getByLabel("Width (in)")).toHaveValue("36");
    await expect(reloadedEditor.getByLabel("Quantity")).toHaveValue("3");
  });

  test("stale browser revision cannot overwrite a later legitimate save", async ({ page, browser }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    const other = await browser.newContext({ baseURL: "http://127.0.0.1:4174" });
    try {
      await login(other.request, "limited-a");
      const pageB = await other.newPage();
      await pageB.goto("/"); await pageB.getByLabel("Organization ID").fill(f.organizationA);
      await pageB.getByLabel("Open Quote ID").fill(quoteId); await pageB.getByRole("button", { name: "Open Quote" }).click();
      await expect(pageB.getByRole("button", { name: "Send Quote" })).toBeVisible();
      await pageB.getByLabel("PO").fill("B-wins");
      const bSaved = pageB.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 200);
      await pageB.getByRole("button", { name: "Save" }).click(); await bSaved;
      const bRead = await other.request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes/${encodeURIComponent(quoteId)}`);
      expect((await bRead.json()).data.quote.purchaseOrderNumber).toBe("B-wins");
      await page.getByLabel("PO").fill("A-stale");
      const stale = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 409);
      await page.getByRole("button", { name: "Save" }).click(); await stale;
      await expect(page.getByText(/changed elsewhere/i).first()).toBeVisible();
      await expect(page.getByText("Revision 2", { exact: false })).toBeVisible();
      await expect(page.getByLabel("PO")).toHaveValue("A-stale");
      const db = await readback(page, quoteId);
      expect(db.document.purchase_order_number).toBe("B-wins");
      const reapplied = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 200);
      await page.getByRole("button", { name: "Save" }).click(); await reapplied;
      const resolved = await readback(page, quoteId);
      expect(resolved.document.purchase_order_number).toBe("A-stale");
    } finally { await other.close(); }
  });

  test("a lost create response retries the same browser business request without a duplicate Quote", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    await page.getByLabel("Customer").first().selectOption(f.customerA);
    await page.getByLabel("Contact").first().selectOption(f.contactA);
    await page.getByLabel("Product").first().selectOption(f.dimensionalProductA);
    await page.getByLabel("Width (in)").fill("24"); await page.getByLabel("Height (in)").fill("18"); await page.getByLabel("Quantity").first().fill("2");
    let loseFirstResponse = true;
    await page.route(`**/v2/organizations/${f.organizationA}/quotes`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const upstream = await route.fetch();
      if (loseFirstResponse) { loseFirstResponse = false; return route.abort("failed"); }
      return route.fulfill({ response: upstream });
    });
    await page.getByRole("button", { name: "Create Quote" }).click();
    await expect(page.getByRole("button", { name: "Create Quote" })).toBeEnabled();
    const replay = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/quotes") && response.status() === 200);
    await page.getByRole("button", { name: "Create Quote" }).click();
    const body = await (await replay).json();
    const quoteId = body.data.quote.quote.quoteId as string;
    const db = await readback(page, quoteId);
    expect(db.audit.filter((event) => event.event_type === "quote_created")).toHaveLength(1);
    expect(db.operations.filter((operation) => operation.result_resource_id === quoteId)).toHaveLength(1);
    expect(db.operations[0]?.business_request_id).toBeTruthy();
    await page.unroute(`**/v2/organizations/${f.organizationA}/quotes`);
  });

  test("authorized overrides persist, while limited users see them read-only and cannot forge an override", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    const editor = page.locator("tr.editor-row");
    await expect(editor.getByLabel("Selling price decision")).toBeVisible();
    await editor.getByLabel("Selling price decision").selectOption("total_override");
    await editor.getByLabel("Selling line total (cents)").fill("1234");
    await editor.getByLabel("Override reason").fill("browser approval");
    const changed = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 200);
    await page.getByRole("button", { name: "Save and reprice line" }).click();
    await changed;
    let db = await readback(page, quoteId);
    expect(db.lines[0].selling_line_cents).toBe("1234");
    expect((db.lines[0].selling_price_decision as { kind: string }).kind).toBe("total_override");
    await page.reload();
    await page.getByLabel("Organization ID").fill(f.organizationA);
    await page.getByLabel("Open Quote ID").fill(quoteId);
    await page.getByRole("button", { name: "Open Quote" }).click();
    await expect(page.getByText(/Selling-price decision: total_override/i)).toBeVisible();
    await page.getByRole("button", { name: "Edit configuration" }).click();
    const unitEditor = page.locator("tr.editor-row");
    await unitEditor.getByLabel("Selling price decision").selectOption("unit_override");
    await unitEditor.getByLabel("Selling unit price (cents)").fill("777");
    await unitEditor.getByLabel("Override reason").fill("unit browser approval");
    const unitChanged = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 200);
    await page.getByRole("button", { name: "Save and reprice line" }).click();
    await unitChanged;
    db = await readback(page, quoteId);
    expect(db.lines[0].selling_unit_cents).toBe("777");
    expect((db.lines[0].selling_price_decision as { kind: string }).kind).toBe("unit_override");
    await login(page.context().request, "limited-a");
    await page.goto("/"); await page.getByLabel("Organization ID").fill(f.organizationA);
    await page.getByLabel("Open Quote ID").fill(quoteId); await page.getByRole("button", { name: "Open Quote" }).click();
    await expect(page.getByText(/Selling-price decision: unit_override/i)).toBeVisible();
    await expect(page.getByText(/Override editing is unavailable/i)).toBeVisible();
    const boot = await page.context().request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/ui-bootstrap`);
    const csrf = (await boot.json()).data.csrfToken as string;
    const forged = await page.context().request.patch(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes/${encodeURIComponent(quoteId)}`, {
      headers: { "x-v2-csrf-token": csrf },
      data: { businessRequestId: "limited-forged-override", expectedRevision: String(db.document.revision), lineChanges: [{ kind: "update", lineId: db.lines[0].id, line: { productId: f.dimensionalProductA, quantity: 2, selections: { finish: "legacy" }, dimensions: { width: 24, height: 18, unit: "in" }, selling: { kind: "total_override", totalCents: 1, reason: "forged" } } }] },
    });
    expect(forged.status()).toBe(403);
    await login(page.context().request, "staff-a");
    db = await readback(page, quoteId);
    expect(db.lines[0].selling_unit_cents).toBe("777");
    expect(db.audit.filter((event) => event.event_type === "quote_updated")).toHaveLength(2);
  });

  test("live override capability removal rejects the next browser mutation without false success", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    await page.getByRole("button", { name: "Edit configuration" }).click();
    const editor = page.locator("tr.editor-row");
    await editor.getByLabel("Selling price decision").selectOption("unit_override");
    await editor.getByLabel("Selling unit price (cents)").fill("777");
    await editor.getByLabel("Override reason").fill("will be rejected");
    expect((await page.context().request.post("/_v2-browser-test/remove-override")).status()).toBe(204);
    const rejected = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/quotes/${quoteId}`) && response.status() === 403);
    await page.getByRole("button", { name: "Save and reprice line" }).click();
    await rejected;
    await expect(page.getByText("You do not have permission for that Quote action.")).toBeVisible();
    await expect(page.getByLabel("Selling price decision")).toHaveCount(0);
    const db = await readback(page, quoteId);
    expect((db.lines[0].selling_price_decision as { kind: string }).kind).toBe("calculated");
    expect(db.audit.map((event) => event.event_type)).not.toContain("quote_updated");
  });

  test("browser Send and Accept create exactly one immutable checkpoint each", async ({ page }) => {
    await login(page.context().request, "staff-a");
    const f = await fixture(page.context().request);
    await openOrganization(page, f.organizationA);
    const quoteId = await createDimensionalQuote(page, f);
    const sendRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(`/quotes/${quoteId}/send`));
    const sent = page.waitForResponse((response) => response.url().endsWith(`/quotes/${quoteId}/send`));
    await page.getByRole("button", { name: "Send Quote" }).click();
    const sentResponse = await sent;
    expect({ status: sentResponse.status(), body: await sentResponse.text() }).toEqual(expect.objectContaining({ status: 200 }));
    const sentPayload = JSON.parse((await sendRequest).postData() ?? "{}") as { businessRequestId: string; expectedRevision: string };
    const bootstrap = await page.context().request.get(`/v2/organizations/${encodeURIComponent(f.organizationA)}/ui-bootstrap`);
    const csrf = (await bootstrap.json()).data.csrfToken as string;
    const replay = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes/${encodeURIComponent(quoteId)}/send`, { headers: { "x-v2-csrf-token": csrf }, data: sentPayload });
    expect(replay.status()).toBe(200);
    await expect(page.getByRole("button", { name: "Accept Quote" })).toBeVisible();
    const acceptRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(`/quotes/${quoteId}/accept`));
    const accepted = page.waitForResponse((response) => response.url().endsWith(`/quotes/${quoteId}/accept`) && response.status() === 200);
    await page.getByRole("button", { name: "Accept Quote" }).click(); await accepted;
    const acceptedPayload = JSON.parse((await acceptRequest).postData() ?? "{}") as { businessRequestId: string; expectedRevision: string };
    const acceptedReplay = await page.context().request.post(`/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes/${encodeURIComponent(quoteId)}/accept`, { headers: { "x-v2-csrf-token": csrf }, data: acceptedPayload });
    expect(acceptedReplay.status()).toBe(200);
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();
    const db = await readback(page, quoteId);
    expect(db.checkpoints.map((checkpoint) => checkpoint.checkpoint_kind)).toEqual(["quote_sent", "quote_accepted"]);
    await page.reload(); await page.getByLabel("Organization ID").fill(f.organizationA); await page.getByLabel("Open Quote ID").fill(quoteId); await page.getByRole("button", { name: "Open Quote" }).click();
    await expect(page.getByText("accepted", { exact: true })).toBeVisible();
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
