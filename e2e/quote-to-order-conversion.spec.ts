import { expect, Locator, Page, test } from "@playwright/test";

type MoneySnapshot = {
  text: string;
  value: number;
};

type QuoteSnapshot = {
  quoteNumber: string;
  lineItemCount: number;
  total: MoneySnapshot | null;
};

type CreatedOrder = {
  id: string;
  orderNumber: string | null;
};

const QUOTE_ID = process.env.PLAYWRIGHT_QUOTE_TO_ORDER_QUOTE_ID;
const DEBUG_HOLD_MS = Number.parseInt(process.env.PLAYWRIGHT_DEBUG_HOLD_MS ?? "0", 10);

test("quote → order conversion smoke", async ({ page }) => {
  if (!QUOTE_ID) {
    test.skip(
      true,
      "PLAYWRIGHT_QUOTE_TO_ORDER_QUOTE_ID not set — set this to a disposable DEV quote id that has not yet been converted"
    );
    return;
  }

  test.setTimeout(120_000);

  await ensureAuthenticated(page);

  const quote = await openQuoteAndCaptureSnapshot(page, QUOTE_ID);
  const createdOrder = await convertQuoteToOrder(page, QUOTE_ID);

  await assertOrderDetailLoaded(page, createdOrder.id);
  await holdForDebug(page);

  await expect
    .poll(() => countOrderLineItems(page), {
      message: `Expected created order ${createdOrder.id} to preserve ${quote.lineItemCount} visible line items`,
      timeout: 20_000,
    })
    .toBe(quote.lineItemCount);

  if (quote.total) {
    const orderTotal = await tryReadDisplayedTotal(page);
    if (orderTotal) {
      expect(
        Math.abs(orderTotal.value - quote.total.value),
        `Expected order total ${orderTotal.text} to materially match quote total ${quote.total.text}`
      ).toBeLessThanOrEqual(0.01);
    }
  }

  await page.reload({ waitUntil: "networkidle" });
  await assertOrderDetailLoaded(page, createdOrder.id);

  await expect
    .poll(() => countOrderLineItems(page), {
      message: "Expected order line-item count to remain stable after refresh",
      timeout: 20_000,
    })
    .toBe(quote.lineItemCount);

  if (quote.total) {
    const refreshedTotal = await tryReadDisplayedTotal(page);
    if (refreshedTotal) {
      expect(
        Math.abs(refreshedTotal.value - quote.total.value),
        `Expected refreshed order total ${refreshedTotal.text} to remain materially equal to quote total ${quote.total.text}`
      ).toBeLessThanOrEqual(0.01);
    }
  }

  await page.goto(`/quotes/${QUOTE_ID}`, { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText("Converted", { exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /Converted quotes are locked\. View the order for changes or use Revise Quote for a new draft\./i })
      .first()
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^View Order$/ })).toBeVisible();

  const quoteHeader = page.locator("h1, h2").filter({ hasText: new RegExp(`Quote #${quote.quoteNumber}`) }).first();
  await expect(quoteHeader).toBeVisible();
});

async function ensureAuthenticated(page: Page) {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
}

async function openQuoteAndCaptureSnapshot(page: Page, quoteId: string): Promise<QuoteSnapshot> {
  await page.goto(`/quotes/${quoteId}`, { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);

  const quoteNotFound = page.getByText(/quote not found/i).first();
  if (await quoteNotFound.isVisible().catch(() => false)) {
    throw new Error(`Quote fixture ${quoteId} did not load in the UI. Confirm the DEV quote URL is valid and accessible.`);
  }

  const header = page.locator("h1, h2").filter({ hasText: /^Quote #/ }).first();
  await expect(header).toBeVisible();

  const headerText = (await header.textContent())?.trim() ?? "";
  const quoteNumberMatch = headerText.match(/Quote #(\d+)/i);
  if (!quoteNumberMatch) {
    throw new Error(`Could not read quote number from header: "${headerText}"`);
  }

  const viewOrderButton = page.getByRole("button", { name: /^View Order$/ });
  if (await viewOrderButton.isVisible().catch(() => false)) {
    throw new Error(
      `Quote fixture ${quoteId} already appears converted in the UI. Point PLAYWRIGHT_QUOTE_TO_ORDER_QUOTE_ID to a fresh DEV quote that still shows Convert to Order.`
    );
  }

  const convertButton = page.getByRole("button", { name: /^Convert to Order$/ });
  if (!(await convertButton.isVisible().catch(() => false))) {
    throw new Error(
      `Quote fixture ${quoteId} does not show an available Convert to Order action. Use a convertible DEV quote with no existing order.`
    );
  }
  await expect(convertButton).toBeEnabled();

  const lineItemRows = page
    .getByRole("button", { name: /^(Expand|Collapse) line item$/ })
    .filter({ has: page.getByText(/^Qty\s+\d+/) });
  await expect
    .poll(() => lineItemRows.count(), {
      message: "Expected quote detail to show at least one visible line item",
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  return {
    quoteNumber: quoteNumberMatch[1],
    lineItemCount: await lineItemRows.count(),
    // TODO: Restore required before/after total comparison once the quote/order totals area has a stable selector or test id in DEV.
    total: await tryReadDisplayedTotal(page),
  };
}

async function convertQuoteToOrder(page: Page, quoteId: string): Promise<CreatedOrder> {
  await page.getByRole("button", { name: /^Convert to Order$/ }).click();

  const dialog = page.getByRole("dialog").filter({ has: page.getByText("Convert Quote to Order", { exact: true }) });
  await expect(dialog).toBeVisible();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/quotes/${quoteId}/convert-to-order`) &&
      response.request().method() === "POST",
    { timeout: 20_000 }
  );
  const urlPromise = page.waitForURL(/\/orders\/[^/?#]+$/, { timeout: 20_000 });

  await dialog.getByRole("button", { name: /^Create Order$/ }).click();

  const response = await responsePromise;
  expect(response.ok(), `Convert to order returned HTTP ${response.status()}`).toBe(true);
  await urlPromise;

  const json = await response.json();
  const order = json?.data?.order;
  if (!order?.id) {
    throw new Error("Convert quote response did not include a created order id");
  }

  return {
    id: String(order.id),
    orderNumber: order.orderNumber ? String(order.orderNumber) : null,
  };
}

async function assertOrderDetailLoaded(page: Page, expectedOrderId: string) {
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page).toHaveURL(new RegExp(`/orders/${escapeRegExp(expectedOrderId)}(?:$|[?#])`));
  await expect(page.getByRole("button", { name: /^Open Orders$/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Totals", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function countOrderLineItems(page: Page): Promise<number> {
  const lineItemButtons = page.locator('button[aria-controls^="line-item-"]');
  return lineItemButtons.count();
}

async function readDisplayedTotal(page: Page): Promise<MoneySnapshot> {
  const totalRow = await findTotalRow(page);
  const amountText = await extractMoneyText(totalRow);

  return {
    text: amountText,
    value: parseCurrency(amountText),
  };
}

async function tryReadDisplayedTotal(page: Page): Promise<MoneySnapshot | null> {
  try {
    return await readDisplayedTotal(page);
  } catch {
    return null;
  }
}

async function findTotalRow(page: Page): Promise<Locator> {
  for (const label of ["Grand Total", "Total"]) {
    const labels = page.getByText(label, { exact: true });
    const count = await labels.count();

    for (let index = 0; index < count; index += 1) {
      const candidateLabel = labels.nth(index);
      const row = candidateLabel.locator("xpath=..");

      if (!(await row.isVisible().catch(() => false))) {
        continue;
      }

      const rowText = (await row.textContent()) ?? "";
      if (/\$\s*\d[\d,]*\.\d{2}/.test(rowText)) {
        return row;
      }
    }
  }

  throw new Error("Could not find a visible displayed total row on the page.");
}

async function extractMoneyText(row: Locator): Promise<string> {
  const rowText = (await row.textContent()) ?? "";
  const matches = rowText.match(/\$\s*\d[\d,]*\.\d{2}/g);
  if (!matches || matches.length === 0) {
    throw new Error(`Could not read a currency value from total row text: \"${rowText.trim()}\"`);
  }

  return matches[matches.length - 1].replace(/\s+/g, "");
}

async function holdForDebug(page: Page) {
  if (DEBUG_HOLD_MS > 0) {
    await page.waitForTimeout(DEBUG_HOLD_MS);
  }
}

function parseCurrency(value: string): number {
  const cleaned = value.replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse currency value from "${value}"`);
  }
  return parsed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
