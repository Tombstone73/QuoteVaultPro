import {
  buildClaimedTravelerWebUrl,
  getCanonicalTravelerWebOrigin,
} from "../lib/directTravelerPrintUrl";

describe("direct Traveler print URL architecture", () => {
  test("uses the production web origin instead of the production API origin", () => {
    expect(buildClaimedTravelerWebUrl("https://www.printershero.com", "order-1", "job-1"))
      .toBe("https://www.printershero.com/orders/order-1/traveler?directPrintJobId=job-1");
  });

  test("uses the DEV web origin instead of the DEV API origin", () => {
    expect(buildClaimedTravelerWebUrl("https://dev.printershero.com", "order-1", "job-1"))
      .toBe("https://dev.printershero.com/orders/order-1/traveler?directPrintJobId=job-1");
  });

  test("rejects an API or arbitrary origin as a Traveler navigation origin", () => {
    expect(() => getCanonicalTravelerWebOrigin("https://api.printershero.com")).toThrow("canonical HTTPS PrintersHero web application origin");
    expect(() => getCanonicalTravelerWebOrigin("https://evil.example.com")).toThrow("canonical HTTPS PrintersHero web application origin");
    expect(() => getCanonicalTravelerWebOrigin(null)).toThrow("APP_PUBLIC_WEB_ORIGIN");
  });
});
