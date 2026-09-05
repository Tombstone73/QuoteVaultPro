import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  assertVercelUiRoutingEnvironment,
  resolveV2UiRoutingConfiguration,
} from "./deploymentRouting";

const development = resolveV2UiRoutingConfiguration({
  V2_UI_DEPLOYMENT_TARGET: "development",
  V2_UI_API_ORIGIN: "https://api-dev.printershero.com",
});
assert.deepEqual(development, {
  target: "development",
  apiOrigin: "https://api-dev.printershero.com",
});

const production = resolveV2UiRoutingConfiguration({
  V2_UI_DEPLOYMENT_TARGET: "production",
  V2_UI_API_ORIGIN: "https://api.printershero.com",
});
assert.deepEqual(production, {
  target: "production",
  apiOrigin: "https://api.printershero.com",
});

assert.throws(
  () => resolveV2UiRoutingConfiguration({
    V2_UI_DEPLOYMENT_TARGET: "production",
    V2_UI_API_ORIGIN: "https://api-dev.printershero.com",
  }),
  /does not match/,
);
assert.throws(
  () => resolveV2UiRoutingConfiguration({
    V2_UI_DEPLOYMENT_TARGET: "development",
    V2_UI_API_ORIGIN: "https://api.printershero.com",
  }),
  /does not match/,
);
assert.throws(
  () => resolveV2UiRoutingConfiguration({}), /V2_UI_DEPLOYMENT_TARGET/);
assert.throws(
  () => assertVercelUiRoutingEnvironment({ VERCEL: "1" }), /V2_UI_DEPLOYMENT_TARGET/);
assert.doesNotThrow(() => assertVercelUiRoutingEnvironment({}));

const vercel = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "..", "vercel.json"), "utf8")) as {
  routes: ReadonlyArray<Readonly<{ src?: string; dest?: string; env?: readonly string[]; handle?: string }>>;
};
const expectedRoutes = [
  ["^/api/integrations/quickbooks/callback$", "${V2_UI_API_ORIGIN}/api/integrations/quickbooks/callback"],
  ["^/api/email/google/callback$", "${V2_UI_API_ORIGIN}/api/email/google/callback"],
  ["^/v2/(.*)$", "${V2_UI_API_ORIGIN}/v2/$1"],
] as const;
for (const [index, [src, dest]] of expectedRoutes.entries()) {
  assert.deepEqual(vercel.routes[index], { src, dest, env: ["V2_UI_API_ORIGIN"] });
}
assert.deepEqual(vercel.routes[3], { handle: "filesystem" });
assert.deepEqual(vercel.routes[4], { src: "/(.*)", dest: "/index.html" });
assert.doesNotMatch(JSON.stringify(vercel), /api-dev\.printershero\.com/);

console.log("V2 UI deployment routing contract passed");
