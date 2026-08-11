import { expect, test, type Page } from "@playwright/test";

const bannerSearch = "Find our banner products.";

async function openFreshAssistantConversation(page: Page): Promise<void> {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Open PrintersHero assistant" }).click();
  await expect(page.getByRole("region", { name: "PrintersHero assistant workspace" })).toBeVisible({ timeout: 20_000 });
  const newChat = page.getByRole("button", { name: "New chat" });
  if (await newChat.isVisible().catch(() => false)) await newChat.click();
  await expect(page.getByLabel("Message the assistant")).toBeEnabled({ timeout: 20_000 });
}

async function sendAndReadLatestAssistantMessage(page: Page, message: string): Promise<string> {
  const history = page.getByTestId("assistant-message-history");
  const messages = history.getByTestId("assistant-message-content");
  const priorCount = await messages.count();
  await page.getByLabel("Message the assistant").fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => messages.count(), { timeout: 150_000 }).toBeGreaterThan(priorCount);
  const response = (await messages.last().textContent())?.trim() ?? "";
  expect(response).not.toBe("");
  expect(response).not.toMatch(/(generic investigation error|your message wasn.t sent|search backend error)/i);
  return response;
}

test("deployed DEV returns a usable result for banner search", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await openFreshAssistantConversation(page);
  const response = await sendAndReadLatestAssistantMessage(page, bannerSearch);
  if (!/banner|product|found|match/i.test(response)) {
    const diagnostics = page.getByRole("button", { name: "Technical diagnostics" });
    if (await diagnostics.isVisible().catch(() => false)) {
      await diagnostics.click();
      await expect(page.getByText("Loading technical diagnostics…")).toBeHidden({ timeout: 20_000 });
    }
    const safeDiagnosticText = ((await page.getByTestId("assistant-message-history").textContent()) ?? "")
      .replace(/\s+/g, " ")
      .slice(-1_500);
    throw new Error(`[DEV QA live search] Banner discovery returned no usable result. Safe on-screen diagnostics: ${safeDiagnosticText}`);
  }
});
