import { expect, test } from "@playwright/test";
import { getDevQaConfig } from "./devQaAuth";

test("dedicated DEV QA identity has the Quote assistant grants needed for acceptance", async ({ page }) => {
  const config = getDevQaConfig();
  const response = await page.request.fetch(new URL("/api/assistant/capabilities", config.apiBaseUrl).toString());
  expect(response.status()).toBe(200);
  const body = await response.json() as { success?: boolean; data?: {
    toolsEnabled?: boolean;
    diagnosticsEnabled?: boolean;
    productionCommandsPermittedForUser?: string[];
  } };
  expect(body.success).toBe(true);
  expect(body.data?.toolsEnabled).toBe(true);
  expect(body.data?.diagnosticsEnabled).toBe(true);
  expect(body.data?.productionCommandsPermittedForUser).toContain("quotes.create_draft");
});
