import { test } from "@playwright/test";
import { assertV2DevQaEnvironment } from "./devQaAuth";

test("reviewed V2 DEV frontend/backend pair is healthy before authentication", async ({ request }) => {
  await assertV2DevQaEnvironment(request);
});
