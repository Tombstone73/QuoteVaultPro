import { getPersistedBaseCalculatedTotalCents, resolvePersistedLineItemPricing } from "../../server/lib/lineItemPricingPersistence";

Object.assign(window, { __workspaceTabsFixture: true });
await import("../local-inbound-workflow/fixture");

// The synthetic Order store echoes the submitted line fields. Canonical Order
// creation resolves the separate price override before exposing a saved total.
const syntheticFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const response = await syntheticFetch(input, init);
  const url = new URL(input instanceof Request ? input.url : input, window.location.origin);
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  if (method !== "GET" || url.origin !== window.location.origin ||
      url.pathname !== "/api/orders/qa-direct-order" || !response.ok) return response;
  const data = await response.json();
  const lineItems = (data.lineItems as Record<string, unknown>[]).map(line => {
    const pricing = resolvePersistedLineItemPricing({
      baseCalculatedTotalCents: getPersistedBaseCalculatedTotalCents(line),
      quantity: line.quantity,
      body: line,
      specsJson: line.specsJson,
      legacyOverridePriceCents: line.overridePriceCents,
    });
    return { ...line, totalPrice: pricing.effectiveTotalCents / 100 };
  });
  return Response.json({ ...data, lineItems });
};
