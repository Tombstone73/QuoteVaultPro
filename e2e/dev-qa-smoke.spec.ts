import { expect, test } from "@playwright/test";

test("dedicated DEV QA session can reach Products, Orders, and the AI Operator", async ({ page }) => {
  for (const path of ["/products", "/orders"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`${path}(?:[?#].*)?$`));
  }

  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const launcher = page.getByRole("button", { name: "Open PrintersHero assistant" });
  await expect(launcher).toBeEnabled({ timeout: 15_000 });
  await launcher.click();
  await expect(page.getByText("Assistant", { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("dedicated DEV QA can open the Product Editor without saving", async ({ page }) => {
  await page.goto("/products", { waitUntil: "domcontentloaded" });
  const firstProduct = page.locator("table tbody tr").first();
  await expect(firstProduct).toBeVisible({ timeout: 15_000 });
  // Product actions are Manage Images, Edit, Duplicate, and Delete.
  await firstProduct.locator("td:last-child button").nth(1).click();
  await expect(page.getByRole("heading", { name: "Pricing Preview", exact: true })).toBeVisible({ timeout: 20_000 });
});

test("dedicated DEV QA can inspect Fulfillment item-tag controls without printing", async ({ page }) => {
  await page.goto("/fulfillment", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Fulfillment", exact: true })).toBeVisible({ timeout: 15_000 });
  const firstOrder = page.locator("table tbody tr").first();
  await expect(firstOrder).toBeVisible({ timeout: 15_000 });
  await firstOrder.locator("td:nth-child(2) button").first().click();
  await expect(page.getByRole("heading", { name: "Fulfillment line items" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Print Item Tag" }).first().click();
  await expect(page.getByRole("dialog", { name: "Print Item Tag" })).toBeVisible();
});
