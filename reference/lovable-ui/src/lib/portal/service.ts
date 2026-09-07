import * as fixtures from "./data";
import type { PortalInvoice, PortalOrder, PortalProduct, PortalProof, PortalQuote } from "./types";

/**
 * Mock service boundary.
 * Every function here stands in for a PrintersHero V2 API call and can be
 * swapped for a React Query fetcher without touching presentation code.
 * NOTHING in this file is authoritative — pricing, entitlement and payment
 * all belong to the server.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const portalApi = {
  async getAccount() {
    await delay(120);
    return fixtures.account;
  },
  async listProducts(): Promise<PortalProduct[]> {
    await delay(200);
    return fixtures.products;
  },
  async getProduct(id: string): Promise<PortalProduct | undefined> {
    await delay(150);
    return fixtures.products.find((p) => p.id === id);
  },
  async listOrders(): Promise<PortalOrder[]> {
    await delay(200);
    return fixtures.orders;
  },
  async listProofs(): Promise<PortalProof[]> {
    await delay(180);
    return fixtures.proofs;
  },
  async listQuotes(): Promise<PortalQuote[]> {
    await delay(180);
    return fixtures.quotes;
  },
  async listInvoices(): Promise<PortalInvoice[]> {
    await delay(180);
    return fixtures.invoices;
  },

  /**
   * Server-authoritative price quote. The mock returns a plausible number so
   * the loading / priced / unavailable states can be evaluated; the real call
   * returns the customer's contracted price from the pricing engine.
   */
  async quotePrice(input: {
    productId: string;
    width: number;
    height: number;
    qty: number;
    options: Record<string, string>;
  }): Promise<{ unitPrice: number; lineTotal: number; basis: string }> {
    await delay(650);
    if (!input.qty || input.qty < 1) throw new Error("QUANTITY_REQUIRED");
    const product = fixtures.products.find((p) => p.id === input.productId);
    if (!product) throw new Error("PRODUCT_UNAVAILABLE");
    const areaProducts = ["banner-13oz", "adhesive-vinyl"];
    const sqft = (input.width * input.height) / 144;
    const seed = Object.values(input.options).join("").length;
    let unit: number;
    let basis: string;
    if (areaProducts.includes(product.id)) {
      if (!sqft) throw new Error("DIMENSIONS_REQUIRED");
      unit = Math.round((sqft * (3.75 + seed * 0.04) + 12) * 100) / 100;
      basis = `${sqft.toFixed(1)} sq ft each · your contracted rate`;
    } else {
      if (product.id === "contour-stickers") {
        unit = Math.round((0.95 - Math.min(0.4, input.qty / 8000)) * 100) / 100;
        basis = "Per sticker · your contracted rate";
      } else {
        unit = Math.round((14 + sqft * 1.9 + seed * 0.35) * 100) / 100;
        basis = "Per piece · your contracted rate";
      }
    }
    return { unitPrice: unit, lineTotal: Math.round(unit * input.qty * 100) / 100, basis };
  },

  async submitOrder(): Promise<{ orderNumber: string }> {
    await delay(900);
    return { orderNumber: "SO-10684" };
  },

  async payInvoices(allocations: { invoiceId: string; amount: number }[]): Promise<{ confirmation: string; total: number }> {
    await delay(1200);
    const total = allocations.reduce((s, a) => s + a.amount, 0);
    return { confirmation: "PAY-88213", total: Math.round(total * 100) / 100 };
  },
};

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const shortDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
