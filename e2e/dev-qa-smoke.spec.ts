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
