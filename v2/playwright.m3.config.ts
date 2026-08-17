import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"./browser",testMatch:"m3.authenticated-fulfillment.spec.ts",workers:1,timeout:150_000,
  use:{baseURL:"http://127.0.0.1:4174",trace:"retain-on-failure",screenshot:"only-on-failure",viewport:{width:1440,height:900}},
  webServer:{command:"cd .. && npm run v2:ui:build && .\\node_modules\\.bin\\cross-env.cmd V2_M175B_BROWSER_TEST=1 .\\node_modules\\.bin\\tsx.cmd v2/scripts/m175bBrowserHost.ts",url:"http://127.0.0.1:4174/health",reuseExistingServer:false,timeout:90_000},
});
