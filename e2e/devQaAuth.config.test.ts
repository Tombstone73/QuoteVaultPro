import assert from "node:assert/strict";
import { getDevQaTargetConfig } from "./devQaAuth";

const valid = {
  PLAYWRIGHT_BASE_URL: "https://dev.printershero.com",
  PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://dev.printershero.com",
  PRINTERSHERO_DEV_QA_BACKEND_ORIGIN: "https://api-dev.printershero.com",
  PRINTERSHERO_DEV_QA_EXPECTED_BACKEND_VERSION: "d8e86af439ea7c3ac2bfce1b24bf5400128d2289",
} as const;

assert.deepEqual(getDevQaTargetConfig(valid), {
  baseUrl: new URL("https://dev.printershero.com"),
  backendUrl: new URL("https://api-dev.printershero.com"),
  expectedBackendVersion: valid.PRINTERSHERO_DEV_QA_EXPECTED_BACKEND_VERSION,
});
assert.throws(() => getDevQaTargetConfig({ ...valid, PLAYWRIGHT_BASE_URL: "https://www.printershero.com" }), /production target/);
assert.throws(() => getDevQaTargetConfig({ ...valid, PRINTERSHERO_DEV_QA_ALLOWED_ORIGIN: "https://staging.example.test" }), /exactly match/);
assert.throws(() => getDevQaTargetConfig({ ...valid, PRINTERSHERO_DEV_QA_BACKEND_ORIGIN: "https://api.printershero.com" }), /unreviewed backend/);
assert.throws(() => getDevQaTargetConfig({ ...valid, PRINTERSHERO_DEV_QA_BACKEND_ORIGIN: "https://other-dev.example.test" }), /unreviewed backend/);
assert.throws(() => getDevQaTargetConfig({ ...valid, PRINTERSHERO_DEV_QA_EXPECTED_BACKEND_VERSION: "not-a-sha" }), /Git commit SHA/);

console.log("[dev-qa-auth] V2 DEV target guard passed.");
