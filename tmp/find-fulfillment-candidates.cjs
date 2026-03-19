const { chromium } = require('@playwright/test');

(async () => {
  const base = process.env.PLAYWRIGHT_BASE_URL;
  const email = process.env.PLAYWRIGHT_EMAIL;
  const password = process.env.PLAYWRIGHT_PASSWORD;

  if (!base || !email || !password) {
    throw new Error('Missing PLAYWRIGHT_BASE_URL, PLAYWRIGHT_EMAIL, or PLAYWRIGHT_PASSWORD');
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: base });

  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  const results = await page.evaluate(async () => {
    const fetchJson = async (path) => {
      const res = await fetch(path, { credentials: 'include' });
      let body = null;
      try { body = await res.json(); } catch {}
      return { status: res.status, body };
    };

    const found = [];
    for (let pageNum = 1; pageNum <= 5; pageNum += 1) {
      const list = await fetchJson(`/api/orders?page=${pageNum}&pageSize=200&sortDir=desc`);
      if (list.status !== 200) throw new Error(`orders page ${pageNum} failed: ${list.status}`);
      const items = list.body?.items || [];
      if (items.length === 0) break;

      for (const item of items) {
        const orderRes = await fetchJson(`/api/orders/${item.id}`);
        if (orderRes.status !== 200 || !orderRes.body) continue;
        const order = orderRes.body;
        if (order.state !== 'open') continue;
        const lineItems = Array.isArray(order.lineItems) ? order.lineItems.filter((li) => li.status !== 'canceled') : [];
        if (lineItems.length === 0) continue;
        found.push({
          orderNumber: String(order.orderNumber),
          id: order.id,
          shippingMethod: order.shippingMethod || null,
          fulfillmentStatus: order.fulfillmentStatus || null,
          routingTarget: order.routingTarget || null,
          lineItemCount: lineItems.length,
        });
      }
    }

    return {
      pickup: found.filter((o) => o.shippingMethod === 'pickup').slice(0, 10),
      ship: found.filter((o) => o.shippingMethod !== 'pickup').slice(0, 10),
      total: found.length,
    };
  });

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(String((err && err.stack) || err));
  process.exit(1);
});
