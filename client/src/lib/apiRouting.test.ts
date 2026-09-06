import { readFileSync } from "node:fs";
import {
  DEVELOPMENT_API_ORIGIN,
  PRODUCTION_API_ORIGIN,
  expectedApiOriginForWebHost,
  resolveApiOriginForWebHost,
  validateApiOriginForWebHost,
} from "./apiRouting";

describe("deployment-bound API routing", () => {
  it("binds each PrintersHero web environment to its own API origin", () => {
    expect(expectedApiOriginForWebHost("www.printershero.com")).toBe(PRODUCTION_API_ORIGIN);
    expect(expectedApiOriginForWebHost("printershero.com")).toBe(PRODUCTION_API_ORIGIN);
    expect(expectedApiOriginForWebHost("dev.printershero.com")).toBe(DEVELOPMENT_API_ORIGIN);
  });

  it("rejects a cross-environment configured API origin", () => {
    expect(validateApiOriginForWebHost("www.printershero.com", DEVELOPMENT_API_ORIGIN).isValid).toBe(false);
    expect(validateApiOriginForWebHost("dev.printershero.com", PRODUCTION_API_ORIGIN).isValid).toBe(false);
    expect(validateApiOriginForWebHost("www.printershero.com", PRODUCTION_API_ORIGIN).isValid).toBe(true);
    expect(validateApiOriginForWebHost("dev.printershero.com", DEVELOPMENT_API_ORIGIN).isValid).toBe(true);
  });

  it("provides the correct deployment-bound fallback when a legacy build lacks an explicit variable", () => {
    expect(resolveApiOriginForWebHost("www.printershero.com", "")).toBe(PRODUCTION_API_ORIGIN);
    expect(resolveApiOriginForWebHost("dev.printershero.com", undefined)).toBe(DEVELOPMENT_API_ORIGIN);
    expect(resolveApiOriginForWebHost("localhost", "")).toBe("");
  });

  it("does not retain a Vercel rewrite capable of sending application traffic to DEV", () => {
    const vercelConfig = readFileSync("vercel.json", "utf8");
    expect(vercelConfig).not.toContain("api-dev.printershero.com");
    expect(vercelConfig).not.toContain('"source": "/api/:path*"');
    expect(vercelConfig).not.toContain('"source": "/objects/:path*"');
  });

  it("keeps raw invoice API calls out of the billing hook", () => {
    const invoiceHooks = readFileSync("client/src/hooks/useInvoices.ts", "utf8");
    expect(invoiceHooks).not.toMatch(/\bfetch\(\s*[`'"]\/api\//);
    expect(invoiceHooks).toContain("apiFetch(`/api/invoices/${id}/send`");
    expect(invoiceHooks).toContain("apiFetch('/api/payments'");
  });

  it("keeps high-risk order and customer mutations on the canonical API client", () => {
    const orderHooks = readFileSync("client/src/hooks/useOrders.ts", "utf8");
    const customerList = readFileSync("client/src/components/CustomerList.tsx", "utf8");
    expect(orderHooks).not.toMatch(/\bfetch\(\s*[`'"]\/api\//);
    expect(customerList).not.toMatch(/\bfetch\(\s*[`'"]\/api\//);
    expect(orderHooks).toContain("apiFetch(\"/api/orders\"");
    expect(customerList).toContain("apiFetch(\"/api/customers/bulk-commercial-configuration\"");
  });

  it("keeps the legacy raw-fetch compatibility layer behind the canonical resolver", () => {
    const appBootstrap = readFileSync("client/src/main.tsx", "utf8");
    expect(appBootstrap).toContain("installUrlAwareFetch()");
    expect(appBootstrap).toContain("resolveAppRequestUrl(url, window.location.origin)");
    expect(appBootstrap).toContain("window.fetch =");
  });
});
