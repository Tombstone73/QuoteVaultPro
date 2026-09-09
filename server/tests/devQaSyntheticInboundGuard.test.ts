import { assertDevQaSyntheticInboundAccess, DEV_QA_SYNTHETIC_INBOUND_ORGANIZATION_ID } from "../lib/devQaSyntheticInboundGuard";

describe("DEV QA synthetic inbound guard", () => {
  const dev = { NODE_ENV:"production", APP_ENV:"development", RAILWAY_PROJECT_NAME:"PrintersHero-DEV", RAILWAY_ENVIRONMENT_NAME:"Development", DATABASE_URL:"postgresql://dev" };
  it("permits only the expected QA organization in test", () => expect(() => assertDevQaSyntheticInboundAccess(DEV_QA_SYNTHETIC_INBOUND_ORGANIZATION_ID,{NODE_ENV:"test"})).not.toThrow());
  it("rejects ordinary tenants and non-DEV runtime", () => {
    expect(() => assertDevQaSyntheticInboundAccess("ordinary",dev)).toThrow();
    expect(() => assertDevQaSyntheticInboundAccess(DEV_QA_SYNTHETIC_INBOUND_ORGANIZATION_ID,{NODE_ENV:"production",APP_ENV:"production"})).toThrow();
  });
});
