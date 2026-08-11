/**
 * Normal dedicated-DEV-QA authentication setup. Every run starts from a fresh
 * browser context; the state written here is only for the rest of this run.
 */
import { test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import { authenticateDevQaUser } from "./devQaAuth";

const AUTH_FILE = path.join(process.cwd(), "e2e", ".auth", "user.json");

setup("authenticate dedicated DEV QA user", async ({ page }) => {
  // Cloud DEV makes several authenticated requests after a normal login.
  // Keep the setup budget distinct from individual UI-action timeouts.
  setup.setTimeout(90_000);
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  // A previously logged-out or expired session must never block a new run.
  fs.rmSync(AUTH_FILE, { force: true });

  await authenticateDevQaUser(page);
  await page.context().storageState({ path: AUTH_FILE });
});
