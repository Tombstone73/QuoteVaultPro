import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

type HttpMethod = "get" | "post";
type Json = Record<string, unknown>;

const safePayload = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(safePayload);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /cookie|session|csrf|token|secret|password|authorization/i.test(key) ? "[redacted]" : safePayload(item),
  ]));
};

const request = async (api: APIRequestContext, step: string, method: HttpMethod, path: string, options: Parameters<APIRequestContext["post"]>[1] = {}) => {
  const response = method === "get" ? await api.get(path, options) : await api.post(path, options);
  const body = await response.json().catch(() => ({}));
  const summary = { step, method: method.toUpperCase(), path, payload: safePayload(options.data), status: response.status() };
  if (response.ok()) console.log("[m2.3.5 browser] OK", summary);
  else console.error("[m2.3.5 browser] FAILED", { ...summary, error: body?.error ?? body });
  return { response, body, summary };
};

const checked = async (api: APIRequestContext, step: string, method: HttpMethod, path: string, options: Parameters<APIRequestContext["post"]>[1] = {}) => {
  const result = await request(api, step, method, path, options);
  expect(result.response.ok(), `${step}: ${result.summary.method} ${path} -> ${result.summary.status} ${JSON.stringify(result.body?.error ?? result.body)}`).toBeTruthy();
  return result.body as { data: any };
};

const expectStatus = async (api: APIRequestContext, step: string, method: HttpMethod, path: string, expected: number, options: Parameters<APIRequestContext["post"]>[1] = {}) => {
  const result = await request(api, step, method, path, options);
  expect(result.response.status(), `${step}: ${JSON.stringify(result.body?.error ?? result.body)}`).toBe(expected);
  return result.body as { error?: { code?: string; message?: string } };
};

const createOrder = async (page: Page, organizationId: string, fixture: any) => {
  await page.goto("/");
  await page.getByLabel("Organization ID").fill(organizationId);
  await expect(page.getByLabel("Customer").first()).toBeEnabled();
  await page.getByLabel("Customer").first().selectOption(fixture.customerA);
  await page.getByLabel("Contact").first().selectOption(fixture.contactA);
  await page.getByLabel("Product").first().selectOption(fixture.dimensionalProductA);
  await page.getByLabel("Width (in)").fill("24");
  await page.getByLabel("Height (in)").fill("18");
  await page.getByLabel("Quantity").first().fill("100");
  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/v2/organizations/${organizationId}/quotes`));
  await page.getByRole("button", { name: "Create Quote" }).click();
  const quoteId = (await (await created).json()).data.quote.quote.quoteId as string;
  await page.getByRole("button", { name: "Send Quote" }).click();
  await page.getByRole("button", { name: "Mark Quote Sent" }).click();
  await page.getByRole("button", { name: "Accept Quote & Create Order" }).click();
  const accepted = page.waitForResponse((response) => response.url().endsWith(`/quotes/${quoteId}/accept`));
  await page.getByRole("button", { name: "Accept & Create Order" }).click();
  return (await (await accepted).json()).data.orderId as string;
};

const capture = (page: Page, testInfo: TestInfo, name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });

test("M2.3.5 clone-backed Production API, station UI, and history proof", async ({ page }, testInfo) => {
  const api = page.context().request;

  // 1. Authenticated bootstrap and 2. legitimate commercial fixture.
  await checked(api, "authenticated bootstrap", "post", "/_v2-browser-test/session", { data: { actor: "staff-a" } });
  const fixture = (await checked(api, "fixture creation/read", "get", "/_v2-browser-test/fixture")).data;
  const orderId = await createOrder(page, fixture.organizationA, fixture);
  const order = (await checked(api, "order readback", "get", `/_v2-browser-test/order-readback/${orderId}`)).data;
  const orderLine = order.lines[0];
  const orderLineId = orderLine.id as string;
  expect(orderLine.quantity).toBe(100);

  // 3. Frozen requirements are commercial truth, never inferred from Artwork.
  const requirements = orderLine.resolved_configuration.productionRequirements;
  expect(requirements.state).toBe("configured");
  expect(requirements.units.map((unit: any) => unit.side).sort()).toEqual(["back", "front"]);
  console.log("[m2.3.5 browser] requirement fixture", { organizationId: fixture.organizationA, orderId, orderLineId, orderedQuantity: orderLine.quantity, requirements });

  // 4. Real production Artwork assignments for the independent Front and Back requirements.
  const frontArtwork = (await checked(api, "Front Production Artwork creation/assignment", "post", "/_v2-browser-test/seed-artwork", { data: { orderId, orderLineId, purpose: "production", side: "front" } })).data;
  const backArtwork = (await checked(api, "Back Production Artwork creation/assignment", "post", "/_v2-browser-test/seed-artwork", { data: { orderId, orderLineId, purpose: "production", side: "back" } })).data;
  expect(frontArtwork.artworkFile.id).not.toBe(backArtwork.artworkFile.id);

  // 5. Fresh Principal/capabilities and CSRF for all normal authenticated writes.
  const bootstrap = (await checked(api, "Production capability/bootstrap read", "get", `/v2/organizations/${fixture.organizationA}/ui-bootstrap`)).data;
  expect(bootstrap.capabilities.productionView).toBe(true);
  expect(bootstrap.capabilities.productionWork).toBe(true);
  expect(bootstrap.capabilities.productionComplete).toBe(true);
  const headers = { "x-v2-csrf-token": bootstrap.csrfToken };
  const prepress = `/v2/organizations/${fixture.organizationA}/prepress`;
  const production = `/v2/organizations/${fixture.organizationA}/production`;

  // 6-8. Each exact Artwork assignment is independently opened, started, and completed in Prepress.
  await checked(api, "clone-only Prepress routing position", "post", "/_v2-browser-test/enter-prepress", { data: { orderId, orderLineId } });
  const prepare = async (side: "Front" | "Back", artworkAssignmentId: string) => {
    const unit = (await checked(api, `${side} Prepress open`, "post", `${prepress}/units`, { headers, data: { businessRequestId: `m235-${side.toLowerCase()}-open-${orderId}`, artworkAssignmentId } })).data.unit;
    await checked(api, `${side} Prepress start`, "post", `${prepress}/units/${unit.prepressUnitId}/start`, { headers, data: { businessRequestId: `m235-${side.toLowerCase()}-start-${orderId}` } });
    return (await checked(api, `${side} Prepress complete`, "post", `${prepress}/units/${unit.prepressUnitId}/complete`, { headers, data: { businessRequestId: `m235-${side.toLowerCase()}-complete-${orderId}` } })).data.unit;
  };
  const frontPrepress = await prepare("Front", frontArtwork.assignment.id);
  const backPrepress = await prepare("Back", backArtwork.assignment.id);
  expect(frontPrepress.completedAt).toBeTruthy();
  expect(backPrepress.completedAt).toBeTruthy();

  // 9. The clone-only fixture positions the already-frozen Route at Production.
  await checked(api, "clone-only Production routing position", "post", "/_v2-browser-test/enter-production", { data: { orderId, orderLineId } });

  // 10. Open exact works; M0 replay converges rather than duplicating the Front work.
  const frontOpenRequest = { businessRequestId: `m235-front-work-${orderId}`, artworkAssignmentId: frontArtwork.assignment.id };
  const frontWork = (await checked(api, "Front ProductionWork open/create", "post", `${production}/works`, { headers, data: frontOpenRequest })).data.work;
  const frontReplay = (await checked(api, "Front ProductionWork M0 replay", "post", `${production}/works`, { headers, data: frontOpenRequest })).data.work;
  expect(frontReplay.productionWorkId).toBe(frontWork.productionWorkId);
  const backWork = (await checked(api, "Back ProductionWork open/create", "post", `${production}/works`, { headers, data: { businessRequestId: `m235-back-work-${orderId}`, artworkAssignmentId: backArtwork.assignment.id } })).data.work;
  expect(frontWork.productionWorkId).not.toBe(backWork.productionWorkId);
  expect(frontWork.requirement.side).toBe("front");
  expect(backWork.requirement.side).toBe("back");

  // Authoritative pre-mutation trace: exact work/evidence, completion, Route and capability state.
  const before = (await checked(api, "Front authoritative state before Production mutation", "get", `/_v2-browser-test/production-readback/${frontWork.productionWorkId}`)).data;
  console.log("[m2.3.5 browser] pre-production authoritative state", {
    orderLine: { organizationId: fixture.organizationA, orderId, orderLineId, orderedQuantity: orderLine.quantity },
    requirement: { key: before.work.requirement_key, side: before.work.side, page: before.work.source_page_index, layer: before.work.layer_key },
    artwork: { artworkFileId: before.work.artwork_file_id, artworkAssignmentId: before.work.artwork_assignment_id },
    prepress: { prepressUnitId: before.work.prepress_unit_id, completedAt: frontPrepress.completedAt },
    routing: before.route,
    authority: { principal: "staff-a", organizationId: bootstrap.organizationId, capabilities: bootstrap.capabilities },
  });
  expect(before.work.artwork_assignment_id).toBe(frontArtwork.assignment.id);
  expect(before.work.prepress_unit_id).toBe(frontPrepress.prepressUnitId);
  const routeBefore = before.route;
  const invoiceBefore = before.invoice;

  // 11. The approved Next up flow is the first station-selection event. The
  // untouched Front work appears in Flatbed, and the real action rail creates
  // its first Flatbed attempt rather than relying on a pre-assigned station.
  await page.getByRole("button", { name: "Production", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await page.getByRole("button", { name: "Stations", exact: true }).click();
  // The shell refreshes its Principal/capability projection on focus. Exercise
  // that normal freshness path before asserting the per-attempt authority.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("tab", { name: /Flatbed/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: new RegExp(`Front.*${orderLineId}`) }).first().click();
  await expect(page.getByText("Front", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Ready for attempt", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start production", exact: true }).click();
  await expect(page.getByText("Attempt active", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete attempt", exact: true })).toBeEnabled();
  const frontAttempt = (await checked(api, "Flatbed first attempt readback", "get", `${production}/works/${frontWork.productionWorkId}`)).data.attempts[0];
  expect(frontAttempt.stationKey).toBe("flatbed");
  await capture(page, testInfo, "v2-flatbed-active");
  await page.getByLabel("Good output").fill("40");
  await page.getByRole("button", { name: "Record good output", exact: true }).click();
  // Active attempt output is visible in that attempt's history. Aggregate good
  // output intentionally includes only completed attempts, so it remains zero
  // until this partial attempt is completed.
  await expect(page.getByText(/Initial.*flatbed.*40 good.*Active/)).toBeVisible();
  await capture(page, testInfo, "v2-flatbed-partial");
  await page.getByRole("button", { name: "Complete attempt", exact: true }).click();
  await expect(page.getByText(/Initial.*flatbed.*40 good.*Completed/)).toBeVisible();

  // 13. A completed partial attempt is historical truth, not early unit satisfaction.
  const partial = (await checked(api, "Front partial attempt readback", "get", `${production}/works/${frontWork.productionWorkId}`)).data;
  expect(partial.attempts).toHaveLength(1);
  expect(partial.attempts[0].goodQuantity).toBe(40);
  expect(partial.attempts[0].completedAt).toBeTruthy();
  expect(partial.completedGoodQuantity).toBe(40);
  expect(partial.unitQuantitySatisfied).toBe(false);

  // 14. Reprint through the real action rail preserves attempt one and makes the unit satisfied only after the additional 60 good output.
  await page.getByRole("button", { name: "Start reprint", exact: true }).click();
  await page.getByLabel("Good output").fill("60");
  await page.getByRole("button", { name: "Record good output", exact: true }).click();
  await page.getByRole("button", { name: "Complete attempt", exact: true }).click();
  await expect(page.getByText("Unit satisfied", { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, "v2-flatbed-satisfied");
  const frontFinal = (await checked(api, "Front immutable reprint history readback", "get", `/_v2-browser-test/production-readback/${frontWork.productionWorkId}`)).data;
  expect(frontFinal.attempts.map((attempt: any) => [attempt.sequence, attempt.attempt_kind, attempt.good_quantity])).toEqual([[1, "initial", 40], [2, "reprint", 60]]);
  expect(frontFinal.attempts.every((attempt: any) => attempt.completed_at && attempt.startedStaffActorVerified && attempt.completedStaffActorVerified)).toBe(true);

  // Roll uses the same Production domain. The independently prepared, untouched
  // Back appears as Roll Next up; its first real UI Start chooses Roll.
  await page.getByRole("tab", { name: /Roll/ }).click();
  await page.getByRole("button", { name: new RegExp(`Back.*${orderLineId}`) }).first().click();
  await expect(page.getByText("Ready for attempt", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start production", exact: true }).click();
  await expect(page.getByText("Back", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Attempt active", { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, "v2-roll-active");
  const rollQueue = (await checked(api, "Roll station queue", "get", `${production}/stations/roll/queue?limit=50`)).data;
  expect(rollQueue.map((item: any) => item.work.productionWorkId)).toContain(backWork.productionWorkId);
  expect(rollQueue.map((item: any) => item.work.productionWorkId)).not.toContain(frontWork.productionWorkId);

  // 15. M0 output replay on the active Roll attempt never double-counts output.
  const backAttempt = (await checked(api, "Roll first attempt readback", "get", `${production}/works/${backWork.productionWorkId}`)).data.attempts[0];
  expect(backAttempt.stationKey).toBe("roll");
  const rollOutput = { businessRequestId: `m235-back-output-${orderId}`, goodQuantityDelta: 10 };
  await checked(api, "Roll partial output", "post", `${production}/attempts/${backAttempt.productionAttemptId}/output`, { headers, data: rollOutput });
  await checked(api, "Roll partial output M0 replay", "post", `${production}/attempts/${backAttempt.productionAttemptId}/output`, { headers, data: rollOutput });
  const backState = (await checked(api, "Back independent work readback", "get", `${production}/works/${backWork.productionWorkId}`)).data;
  expect(backState.attempts).toHaveLength(1);
  expect(backState.attempts[0].goodQuantity).toBe(10);
  expect(backState.unitQuantitySatisfied).toBe(false);
  expect(backState.work.orderedQuantity).toBe(100);

  // 16. Production does not mutate its upstream evidence, frozen Routing, Sales/Invoice facts, or Fulfillment authority.
  const after = (await checked(api, "Front final authoritative readback", "get", `/_v2-browser-test/production-readback/${frontWork.productionWorkId}`)).data;
  expect(after.work.artwork_assignment_id).toBe(frontArtwork.assignment.id);
  expect(after.work.artwork_file_id).toBe(frontArtwork.artworkFile.id);
  expect(after.work.prepress_unit_id).toBe(frontPrepress.prepressUnitId);
  expect(after.route).toEqual(routeBefore);
  expect(after.invoice).toEqual(invoiceBefore);
  expect(after.work.ordered_quantity).toBe(100);
  expect(after.audit.every((event: any) => event.staffActorVerified)).toBe(true);
  expect(after.operations.filter((operation: any) => operation.operation === "production.work.open.v1")).toHaveLength(1);

  // 17. CSRF, permission, and tenant boundaries reject before any Production state changes.
  await expectStatus(api, "Production mutation without CSRF", "post", `${production}/attempts/${backAttempt.productionAttemptId}/complete`, 403, { data: { businessRequestId: `m235-no-csrf-${orderId}` } });
  await checked(api, "authenticate limited staff", "post", "/_v2-browser-test/session", { data: { actor: "limited-a" } });
  await expectStatus(api, "Limited staff Production read denied", "get", `${production}/works/${frontWork.productionWorkId}`, 403);
  const limitedBootstrap = (await checked(api, "Limited staff bootstrap", "get", `/v2/organizations/${fixture.organizationA}/ui-bootstrap`)).data;
  await expectStatus(api, "Limited staff Production mutation denied", "post", `${production}/attempts/${backAttempt.productionAttemptId}/complete`, 403, { headers: { "x-v2-csrf-token": limitedBootstrap.csrfToken }, data: { businessRequestId: `m235-limited-${orderId}` } });
  await checked(api, "authenticate tenant-B staff", "post", "/_v2-browser-test/session", { data: { actor: "staff-b" } });
  await expectStatus(api, "Cross-tenant Production work opaque", "get", `/v2/organizations/${fixture.organizationB}/production/works/${frontWork.productionWorkId}`, 404);
  await checked(api, "restore tenant-A staff", "post", "/_v2-browser-test/session", { data: { actor: "staff-a" } });

  // Refresh proves the authoritative completed Front history and independent active Back survive browser/session reads.
  const restoredBootstrap = (await checked(api, "restored staff bootstrap", "get", `/v2/organizations/${fixture.organizationA}/ui-bootstrap`)).data;
  expect(restoredBootstrap.capabilities.productionView).toBe(true);
  const persistedFront = (await checked(api, "Front refresh persistence", "get", `${production}/works/${frontWork.productionWorkId}`)).data;
  expect(persistedFront.completedGoodQuantity).toBe(100);
  expect(persistedFront.unitQuantitySatisfied).toBe(true);
});
