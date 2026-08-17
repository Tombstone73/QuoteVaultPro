import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

type Fixture = Readonly<{
  organizationA: string;
  organizationB: string;
  customerA: string;
  contactA: string;
  dimensionalProductA: string;
}>;
const login = async (
  api: APIRequestContext,
  actor: "staff-a" | "limited-a" | "staff-b",
) =>
  expect(
    (await api.post("/_v2-browser-test/session", { data: { actor } })).status(),
  ).toBe(204);
const fixture = async (api: APIRequestContext) => {
  const response = await api.get("/_v2-browser-test/fixture");
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as Fixture;
};
const bootstrap = async (api: APIRequestContext, organizationId: string) => {
  const response = await api.get(
    `/v2/organizations/${encodeURIComponent(organizationId)}/ui-bootstrap`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as {
    csrfToken: string;
    capabilities: Record<string, boolean>;
  };
};
const invoices = (organizationId: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(organizationId)}/invoices${suffix}`;
const finance = (organizationId: string, suffix = "") =>
  `/v2/organizations/${encodeURIComponent(organizationId)}/finance${suffix}`;
const createOrder = async (page: Page, f: Fixture) => {
  await page.goto("/");
  await page.getByLabel("Organization ID").fill(f.organizationA);
  await expect(page.getByLabel("Customer").first()).toBeEnabled();
  await page.getByLabel("Customer").first().selectOption(f.customerA);
  await page.getByLabel("Contact").first().selectOption(f.contactA);
  await page.getByLabel("Product").first().selectOption(f.dimensionalProductA);
  await page.getByLabel("Width (in)").fill("24");
  await page.getByLabel("Height (in)").fill("18");
  await page.getByLabel("Quantity").first().fill("100");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/v2/organizations/${encodeURIComponent(f.organizationA)}/quotes`,
        ) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Create Quote" }).click();
  const quoteId = (await (await created).json()).data.quote.quote
    .quoteId as string;
  await page.getByRole("button", { name: "Send Quote" }).click();
  await page.getByRole("button", { name: "Accept Quote" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  const converted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/quotes/${quoteId}/convert`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Convert to Order" }).click();
  return (await (await converted).json()).data.orderId as string;
};

test("M3.4 clone-backed Invoice UI and API issue immutable Billing checkpoints", async ({
  page,
  browser,
}) => {
  const api = page.context().request;
  await login(api, "staff-a");
  const f = await fixture(api);
  const orderId = await createOrder(page, f);
  const order = await api.get(
    `/_v2-browser-test/order-readback/${encodeURIComponent(orderId)}`,
  );
  expect(order.ok()).toBeTruthy();
  const before = (await order.json()).data as {
    document: { display_number: string; revision: string };
    lines: Array<{ id: string }>;
    invoice: { id: string; invoice_state: string };
    routes: unknown;
  };
  const invoiceId = before.invoice.id;
  expect(before.invoice.invoice_state).toBe("draft");
  const access = await bootstrap(api, f.organizationA);
  expect(access.capabilities.invoiceView).toBe(true);
  expect(access.capabilities.invoiceIssue).toBe(true);
  expect(access.capabilities.paymentView).toBe(true);
  expect(access.capabilities.paymentRecord).toBe(true);
  expect(access.capabilities.refundIssue).toBe(true);
  const draft = await api.get(
    invoices(f.organizationA, `/${encodeURIComponent(invoiceId)}`),
  );
  expect(draft.ok()).toBeTruthy();
  expect((await draft.json()).data).toMatchObject({
    invoiceId,
    lifecycle: "draft",
    sourceOrderId: orderId,
    sourceOrderNumber: before.document.display_number,
  });
  expect(
    (
      await api.post(
        invoices(f.organizationA, `/${encodeURIComponent(invoiceId)}/issue`),
        { data: { businessRequestId: `m34-no-csrf-${invoiceId}` } },
      )
    ).status(),
  ).toBe(403);
  await page.getByRole("button", { name: "Invoices", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: `Order ${before.document.display_number}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Financial History", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "C:\\tmp\\m34-visual\\v2-invoice-draft-1440x900.png",
    fullPage: true,
  });
  const issuedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/invoices/${invoiceId}/issue`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Issue Invoice" }).click();
  const issued = await issuedResponse;
  const issuedPayload = await issued.json();
  const requestPayload = JSON.parse(issued.request().postData() ?? "{}");
  expect(requestPayload.businessRequestId).toBeTruthy();
  expect(issuedPayload.data.invoice).toMatchObject({
    invoiceId,
    lifecycle: "issued",
  });
  await expect(
    page.getByText("Invoice issued as an immutable Billing checkpoint."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Take Payment" }),
  ).toBeVisible();
  await page.screenshot({
    path: "C:\\tmp\\m34-visual\\v2-invoice-issued-1440x900.png",
    fullPage: true,
  });
  const noCsrfPayment = await api.post(
    finance(
      f.organizationA,
      `/invoices/${encodeURIComponent(invoiceId)}/payments`,
    ),
    {
      data: {
        businessRequestId: `m34-payment-no-csrf-${invoiceId}`,
        amountCents: 100,
        currency: "USD",
        method: "check",
        occurredAt: new Date().toISOString(),
      },
    },
  );
  expect(noCsrfPayment.status()).toBe(403);
  const paymentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/finance/invoices/${invoiceId}/payments`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Take Payment" }).click();
  await page.getByLabel("Amount").fill("1.00");
  await page.getByRole("button", { name: "Record Payment" }).click();
  const paymentFinished = await paymentResponse;
  const paymentRequest = JSON.parse(
    paymentFinished.request().postData() ?? "{}",
  );
  expect(paymentRequest.businessRequestId).toBeTruthy();
  await expect(
    page.getByText("Payment recorded as an immutable financial fact."),
  ).toBeVisible();
  await expect(page.getByText("$1.00").first()).toBeVisible();
  const financeAfterPayment = await api.get(
    finance(f.organizationA, `/invoices/${encodeURIComponent(invoiceId)}`),
  );
  expect(financeAfterPayment.ok()).toBeTruthy();
  const financePaymentPayload = (await financeAfterPayment.json()).data;
  expect(financePaymentPayload.settlement.paid.cents).toBe(100);
  expect(financePaymentPayload.history).toHaveLength(1);
  const paymentReplay = await api.post(
    finance(
      f.organizationA,
      `/invoices/${encodeURIComponent(invoiceId)}/payments`,
    ),
    { headers: { "x-v2-csrf-token": access.csrfToken }, data: paymentRequest },
  );
  expect(paymentReplay.ok()).toBeTruthy();
  const refundResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/finance/invoices/${invoiceId}/refunds`) &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Record Refund" }).click();
  await page.getByLabel("Original Payment").selectOption({ index: 1 });
  await page.getByLabel("Amount").fill("0.50");
  await page.getByRole("button", { name: "Record Refund" }).last().click();
  const refundFinished = await refundResponse;
  const refundRequest = JSON.parse(refundFinished.request().postData() ?? "{}");
  expect(refundRequest.businessRequestId).toBeTruthy();
  await expect(
    page.getByText(
      "Refund recorded as a separate immutable financial fact; the original Payment remains unchanged.",
    ),
  ).toBeVisible();
  const financeAfterRefund = await api.get(
    finance(f.organizationA, `/invoices/${encodeURIComponent(invoiceId)}`),
  );
  const financeRefundPayload = (await financeAfterRefund.json()).data;
  expect(financeRefundPayload.settlement).toMatchObject({
    paid: { cents: 100 },
    refunded: { cents: 50 },
  });
  expect(financeRefundPayload.history).toHaveLength(2);
  const refundReplay = await api.post(
    finance(
      f.organizationA,
      `/invoices/${encodeURIComponent(invoiceId)}/refunds`,
    ),
    { headers: { "x-v2-csrf-token": access.csrfToken }, data: refundRequest },
  );
  expect(refundReplay.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(
    page.getByText(
      "Global transaction ledger derived from immutable Payment and Refund facts.",
    ),
  ).toBeVisible();
  const replay = await api.post(
    invoices(f.organizationA, `/${encodeURIComponent(invoiceId)}/issue`),
    { headers: { "x-v2-csrf-token": access.csrfToken }, data: requestPayload },
  );
  expect(replay.ok()).toBeTruthy();
  expect((await replay.json()).data.invoice.lifecycle).toBe("issued");
  const persistedResponse = await api.get(
    `/_v2-browser-test/invoice-readback/${encodeURIComponent(invoiceId)}`,
  );
  expect(persistedResponse.ok()).toBeTruthy();
  const persisted = (await persistedResponse.json()).data;
  expect(persisted.invoice).toMatchObject({
    id: invoiceId,
    invoice_state: "issued",
  });
  expect(persisted.lines).toHaveLength(1);
  expect(persisted.checkpoints).toHaveLength(1);
  expect(persisted.audit).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event_type: "invoice_issued",
        staffActorVerified: true,
      }),
    ]),
  );
  expect(persisted.operations).toHaveLength(1);
  expect(persisted.fulfillmentHandoffCount).toBe(0);
  const blockedSalesEdit = await api.patch(
    `/v2/organizations/${encodeURIComponent(f.organizationA)}/orders/${encodeURIComponent(orderId)}`,
    {
      headers: { "x-v2-csrf-token": access.csrfToken },
      data: {
        businessRequestId: `m34-sales-after-issue-${orderId}`,
        expectedRevision: before.document.revision,
        patch: { purchaseOrderNumber: "blocked-after-issued" },
      },
    },
  );
  expect(blockedSalesEdit.status()).toBe(409);
  const afterOrder = await api.get(
    `/_v2-browser-test/order-readback/${encodeURIComponent(orderId)}`,
  );
  expect((await afterOrder.json()).data.routes).toEqual(before.routes);
  const limited = await browser.newContext({
    baseURL: "http://127.0.0.1:4174",
  });
  const foreign = await browser.newContext({
    baseURL: "http://127.0.0.1:4174",
  });
  try {
    await login(limited.request, "limited-a");
    const limitedAccess = await bootstrap(limited.request, f.organizationA);
    expect(limitedAccess.capabilities.invoiceIssue).toBe(false);
    expect(limitedAccess.capabilities.paymentView).toBe(false);
    expect(limitedAccess.capabilities.paymentRecord).toBe(false);
    expect(limitedAccess.capabilities.refundIssue).toBe(false);
    expect(
      (
        await limited.request.get(finance(f.organizationA, "/overview"))
      ).status(),
    ).toBe(403);
    expect(
      (
        await limited.request.post(
          invoices(f.organizationA, `/${encodeURIComponent(invoiceId)}/issue`),
          {
            headers: { "x-v2-csrf-token": limitedAccess.csrfToken },
            data: { businessRequestId: `m34-limited-${invoiceId}` },
          },
        )
      ).status(),
    ).toBe(403);
    await login(foreign.request, "staff-b");
    expect(
      (
        await foreign.request.get(
          invoices(f.organizationB, `/${encodeURIComponent(invoiceId)}`),
        )
      ).status(),
    ).toBe(404);
  } finally {
    await limited.close();
    await foreign.close();
  }
});
