import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const envPath = path.join(root, ".env.playwright");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  const [key, ...rest] = trimmed.split("=");
  process.env[key] ??= rest.join("=");
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
const EMAIL = process.env.PLAYWRIGHT_EMAIL;
const PASSWORD = process.env.PLAYWRIGHT_PASSWORD;
if (!BASE_URL || !EMAIL || !PASSWORD) throw new Error("Missing PLAYWRIGHT_* env values");

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(root, "tmp-smoke-screenshots", `pricing-override-live-${runStamp}`);
fs.mkdirSync(outDir, { recursive: true });

const report = {
  runStamp,
  baseUrl: BASE_URL,
  quoteId: null,
  quoteNumber: null,
  sections: {},
  screenshots: {},
  consoleErrors: [],
  networkErrors: [],
  responses: [],
  lineItemPatchRequests: [],
  apiSnapshots: {},
};

function screenshotPath(name) {
  return path.join(outDir, `${name}.png`);
}

function moneyToNumber(value) {
  const match = String(value ?? "").match(/\$?(-?\d+(?:,\d{3})*(?:\.\d{2})?)/);
  return match ? Number(match[1].replace(/,/g, "")) : NaN;
}

function approxEqual(a, b, tolerance = 0.02) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

async function saveShot(page, name) {
  const file = screenshotPath(name);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots[name] = file;
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  if (await page.locator("#email").isVisible().catch(() => false)) {
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await Promise.all([
      page.waitForURL((url) => url.origin === new URL(BASE_URL).origin && url.pathname !== "/login", { timeout: 30000 }),
      page.locator('button[type="submit"]').click(),
    ]);
  }
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/session", { credentials: "include" });
    return response.ok ? response.json() : null;
  });
  if (session?.authenticated !== true) throw new Error("DEV login/session failed");
}

async function getPriceOverrideSelect(page) {
  await page.evaluate(() => {
    for (const select of document.querySelectorAll("select")) {
      const labels = [...select.options].map((option) => option.textContent?.trim());
      if (labels.includes("No override") && labels.includes("Total override") && labels.includes("Unit override")) {
        select.setAttribute("data-smoke-price-override", "true");
      }
    }
  });
  const locator = page.locator('select[data-smoke-price-override="true"]').first();
  if (!(await locator.count())) throw new Error("Price Override select not found");
  return locator;
}

async function getPriceOverrideLabel(page) {
  return page.evaluate(() => {
    const select = [...document.querySelectorAll("select")].find((candidate) => {
      const labels = [...candidate.options].map((option) => option.textContent?.trim());
      return labels.includes("No override") && labels.includes("Total override") && labels.includes("Unit override");
    });
    return select?.selectedOptions?.[0]?.textContent?.trim() ?? null;
  });
}

async function expandLineItemIfNeeded(page) {
  const expand = page.getByRole("button", { name: /Expand line item/i }).first();
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
    await page.waitForTimeout(1000);
  }
}

async function setQtyToThree(page) {
  await page.evaluate(() => {
    let visibleIndex = 0;
    for (const input of document.querySelectorAll("main input")) {
      const rect = input.getBoundingClientRect();
      const style = window.getComputedStyle(input);
      if (rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none") {
        input.setAttribute("data-smoke-visible-input-index", String(visibleIndex++));
      }
    }
  });
  const visibleInputs = page.locator("main input[data-smoke-visible-input-index]");
  const info = await visibleInputs.evaluateAll((inputs) =>
    inputs.map((input) => ({
      smokeIndex: input.getAttribute("data-smoke-visible-input-index"),
      value: input.value,
      placeholder: input.getAttribute("placeholder"),
      type: input.getAttribute("type"),
    })),
  );
  const oneInputs = info.filter((entry) => entry.value === "1");
  if (oneInputs.length < 3) throw new Error(`Could not identify qty input. Visible inputs: ${JSON.stringify(info)}`);
  const qtySmokeIndex = oneInputs[2].smokeIndex;
  const qty = page.locator(`main input[data-smoke-visible-input-index="${qtySmokeIndex}"]`);
  await qty.fill("3");
  await qty.press("Tab");
  await page.waitForTimeout(3500);
}

async function readUiState(page) {
  await expandLineItemIfNeeded(page);
  const mainText = await page.locator("main").innerText();
  const lineButtonText = await page
    .getByRole("button", { name: /(Collapse|Expand) line item/i })
    .first()
    .innerText()
    .catch(() => "");
  const priceButtonText = await page
    .locator("main button")
    .filter({ hasText: /^\$\d[\d,]*\.\d{2}$/ })
    .first()
    .innerText()
    .catch(() => "");
  const grandMatch = mainText.match(/Grand Total\s*\n\s*(\$[\d,]+\.\d{2})/i);
  const subtotalMatch = mainText.match(/Subtotal\s*\n\s*(\$[\d,]+\.\d{2})/i);
  const unitMatch = lineButtonText.match(/\$[\d,]+\.\d{2}\/ea/);
  const overrideLabel = await getPriceOverrideLabel(page).catch(() => null);
  const fakeOverrideBadge = /Total override/i.test(mainText) && overrideLabel === "No override";
  return {
    url: page.url(),
    mainText,
    lineButtonText,
    rowTotalText: priceButtonText || lineButtonText.match(/\$[\d,]+\.\d{2}(?!\/ea)/)?.[0] || null,
    rowTotal: moneyToNumber(priceButtonText || lineButtonText.match(/\$[\d,]+\.\d{2}(?!\/ea)/)?.[0]),
    unitText: unitMatch?.[0] ?? null,
    unit: moneyToNumber(unitMatch?.[0]),
    subtotalText: subtotalMatch?.[1] ?? null,
    subtotal: moneyToNumber(subtotalMatch?.[1]),
    grandText: grandMatch?.[1] ?? null,
    grand: moneyToNumber(grandMatch?.[1]),
    overrideLabel,
    hasTotalOverrideText: /Total override/i.test(mainText),
    fakeOverrideBadge,
  };
}

async function fetchQuote(page, quoteId) {
  const response = await page.request.get(`${BASE_URL}/api/quotes/${quoteId}`);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status(), ok: response.ok(), json, text };
}

async function resolveQuoteId(page) {
  const urlId = page.url().match(/\/quotes\/([0-9a-f-]{36})/i)?.[1];
  if (urlId) return urlId;

  const mainText = await page.locator("main").innerText().catch(() => "");
  const quoteNumber = mainText.match(/Quote\s+#?(\d+)/i)?.[1] ?? null;
  if (quoteNumber) report.quoteNumber = quoteNumber;

  const candidates = [
    quoteNumber ? `${BASE_URL}/api/quotes?search=${encodeURIComponent(quoteNumber)}` : null,
    `${BASE_URL}/api/quotes`,
  ].filter(Boolean);

  for (const url of candidates) {
    const response = await page.request.get(url);
    if (!response.ok()) continue;
    const json = await response.json().catch(() => null);
    const rows = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.quotes)
          ? json.quotes
          : Array.isArray(json?.data?.quotes)
            ? json.data.quotes
            : [];
    const match = rows.find((quote) => {
      if (quoteNumber && String(quote?.quoteNumber ?? "") === String(quoteNumber)) return true;
      const label = String(quote?.jobLabel ?? quote?.label ?? quote?.description ?? "");
      return label.includes(runStamp);
    });
    if (match?.id) {
      report.quoteNumber ??= String(match.quoteNumber ?? "");
      return match.id;
    }
  }

  return null;
}

function summarizeQuotePayload(payload) {
  const quote = payload?.json?.data ?? payload?.json;
  const item = quote?.lineItems?.[0];
  return {
    quoteId: quote?.id,
    quoteNumber: quote?.quoteNumber,
    totalPrice: quote?.totalPrice ?? quote?.total ?? null,
    lineItemId: item?.id,
    productName: item?.productName,
    quantity: item?.quantity,
    linePrice: item?.linePrice,
    totalPrice: item?.totalPrice,
    effectiveTotalCents: item?.effectiveTotalCents,
    hasPriceOverride: item?.hasPriceOverride,
    priceOverrideMode: item?.priceOverrideMode ?? item?.priceOverride?.mode ?? null,
    priceOverrideValueCents: item?.priceOverrideValueCents ?? item?.priceOverride?.valueCents ?? null,
    overridePriceCents: item?.overridePriceCents ?? null,
    priceOverride: item?.priceOverride ?? null,
    attachmentsCount: Array.isArray(item?.attachments) ? item.attachments.length : undefined,
  };
}

async function saveQuote(page) {
  const saveButton = page.getByRole("button", { name: /^Save Changes$/ }).first();
  if (await saveButton.isEnabled().catch(() => false)) {
    await saveButton.click();
    await page.waitForTimeout(4000);
  }
  report.quoteId ??= await resolveQuoteId(page);
  if (report.quoteId && !/\/quotes\/[0-9a-f-]{36}/i.test(page.url())) {
    await page.goto(`${BASE_URL}/quotes/${report.quoteId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  }
}

async function setOverride(page, label, value) {
  await expandLineItemIfNeeded(page);
  const select = await getPriceOverrideSelect(page);
  await select.selectOption({ label });
  await page.waitForTimeout(500);
  const priceButton = page.locator("main button").filter({ hasText: /^\$\d[\d,]*\.\d{2}$/ }).first();
  await priceButton.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(4500);
  await saveQuote(page);
}

async function selectNoOverride(page) {
  await expandLineItemIfNeeded(page);
  const select = await getPriceOverrideSelect(page);
  await select.selectOption({ label: "No override" });
  await page.waitForTimeout(1000);
  await saveQuote(page);
}

async function reloadAndCapture(page, name) {
  if (report.quoteId) {
    await page.goto(`${BASE_URL}/quotes/${report.quoteId}`, { waitUntil: "networkidle" });
  } else {
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.waitForTimeout(2000);
  await expandLineItemIfNeeded(page);
  const state = await readUiState(page);
  await saveShot(page, name);
  if (report.quoteId) {
    const payload = await fetchQuote(page, report.quoteId);
    report.apiSnapshots[name] = summarizeQuotePayload(payload);
  }
  return state;
}

async function run() {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      report.consoleErrors.push({ type: message.type(), text: message.text(), url: page.url() });
    }
  });
  page.on("requestfailed", (request) => {
    report.networkErrors.push({ method: request.method(), url: request.url(), failure: request.failure()?.errorText });
  });
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/api\/quotes\/[^/]+\/line-items\//.test(request.url())) {
      report.lineItemPatchRequests.push({
        method: request.method(),
        url: request.url(),
        postData: request.postData(),
      });
    }
  });
  page.on("response", async (response) => {
    const status = response.status();
    if (status >= 400 && /\/api\//.test(response.url())) {
      let text = "";
      try {
        text = (await response.text()).slice(0, 1000);
      } catch {}
      report.responses.push({ method: response.request().method(), url: response.url(), status, text });
    }
  });

  try {
    await login(page);
    await page.goto(`${BASE_URL}/quotes/new`, { waitUntil: "networkidle" });
    await page.getByText("55 Twin Lane", { exact: false }).first().click();
    await page.getByPlaceholder("Job name or reference").fill(`Pricing smoke ${runStamp}`);
    await page.getByText("Add Product", { exact: true }).click();
    await page.getByText("AVERY Test 1", { exact: false }).click();
    await page.waitForTimeout(3500);
    await setQtyToThree(page);
    await expandLineItemIfNeeded(page);

    const beforeAttachment = await readUiState(page);
    report.sections.beforeAttachment = {
      state: beforeAttachment,
      pass:
        beforeAttachment.rowTotal > 0 &&
        beforeAttachment.unit > 0 &&
        approxEqual(beforeAttachment.rowTotal, beforeAttachment.grand) &&
        beforeAttachment.overrideLabel === "No override",
    };
    await saveShot(page, "before-attachment");

    const uploadInput = page.locator('input[type="file"]').first();
    await uploadInput.setInputFiles(path.join(root, "attached_assets", "image_1763343234372.png"));
    await page.waitForTimeout(9000);
    const afterAttachment = await readUiState(page);
    report.sections.afterAttachment = {
      state: afterAttachment,
      pass:
        approxEqual(afterAttachment.rowTotal, beforeAttachment.rowTotal) &&
        approxEqual(afterAttachment.unit, beforeAttachment.unit) &&
        approxEqual(afterAttachment.grand, beforeAttachment.grand) &&
        afterAttachment.overrideLabel === "No override",
    };
    await saveShot(page, "after-attachment");

    await saveQuote(page);
    if (!report.quoteId) report.quoteId = await resolveQuoteId(page);
    if (!report.quoteId) throw new Error(`Could not determine quote id from ${page.url()}`);
    const savedNoOverride = await reloadAndCapture(page, "after-save-reload-no-override");
    report.sections.saveReloadNoOverride = {
      state: savedNoOverride,
      api: report.apiSnapshots["after-save-reload-no-override"],
      pass:
        savedNoOverride.rowTotal > 0 &&
        approxEqual(savedNoOverride.rowTotal, savedNoOverride.grand) &&
        savedNoOverride.overrideLabel === "No override" &&
        !report.apiSnapshots["after-save-reload-no-override"]?.priceOverrideMode,
    };

    const editSwitch = page.getByRole("switch", { name: /Toggle Edit Mode/i }).first();
    if ((await editSwitch.count()) && (await editSwitch.getAttribute("aria-checked")) !== "true") {
      await editSwitch.click();
      await page.waitForTimeout(2000);
    }
    const afterUnlock = await readUiState(page);
    report.sections.unlockEdit = {
      state: afterUnlock,
      pass: !report.responses.some((entry) => entry.status >= 500 && /line-items/.test(entry.url)),
    };

    await setOverride(page, "Total override", "40.00");
    const totalOverride = await reloadAndCapture(page, "after-total-override-reload");
    report.sections.totalOverride = {
      state: totalOverride,
      api: report.apiSnapshots["after-total-override-reload"],
      pass:
        approxEqual(totalOverride.rowTotal, 40) &&
        approxEqual(totalOverride.grand, 40) &&
        totalOverride.overrideLabel === "Total override" &&
        report.apiSnapshots["after-total-override-reload"]?.priceOverrideMode === "override_total_after_margin" &&
        report.apiSnapshots["after-total-override-reload"]?.priceOverrideValueCents === 4000,
    };

    if ((await editSwitch.count()) && (await editSwitch.getAttribute("aria-checked")) !== "true") await editSwitch.click();
    await setOverride(page, "Unit override", "10.00");
    const unitOverride = await reloadAndCapture(page, "after-unit-override-reload");
    report.sections.unitOverride = {
      state: unitOverride,
      api: report.apiSnapshots["after-unit-override-reload"],
      pass:
        approxEqual(unitOverride.unit, 10) &&
        approxEqual(unitOverride.rowTotal, 30) &&
        approxEqual(unitOverride.grand, 30) &&
        unitOverride.overrideLabel === "Unit override" &&
        report.apiSnapshots["after-unit-override-reload"]?.priceOverrideMode === "override_unit_after_margin" &&
        report.apiSnapshots["after-unit-override-reload"]?.priceOverrideValueCents === 1000,
    };

    if ((await editSwitch.count()) && (await editSwitch.getAttribute("aria-checked")) !== "true") await editSwitch.click();
    await setOverride(page, "Total override", "0.00");
    const zeroOverride = await reloadAndCapture(page, "after-zero-override-reload");
    report.sections.zeroOverride = {
      state: zeroOverride,
      api: report.apiSnapshots["after-zero-override-reload"],
      pass:
        approxEqual(zeroOverride.rowTotal, 0) &&
        approxEqual(zeroOverride.grand, 0) &&
        zeroOverride.overrideLabel === "Total override" &&
        report.apiSnapshots["after-zero-override-reload"]?.priceOverrideMode === "override_total_after_margin" &&
        report.apiSnapshots["after-zero-override-reload"]?.priceOverrideValueCents === 0,
    };

    if ((await editSwitch.count()) && (await editSwitch.getAttribute("aria-checked")) !== "true") await editSwitch.click();
    await selectNoOverride(page);
    const revert = await reloadAndCapture(page, "after-revert-reload");
    report.sections.revertNoOverride = {
      state: revert,
      api: report.apiSnapshots["after-revert-reload"],
      pass:
        revert.rowTotal > 0 &&
        approxEqual(revert.rowTotal, revert.grand) &&
        revert.overrideLabel === "No override" &&
        !report.apiSnapshots["after-revert-reload"]?.priceOverrideMode,
    };
  } finally {
    report.quoteId ??= page.url().match(/\/quotes\/([0-9a-f-]{36})/i)?.[1] ?? null;
    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

await run();
console.log(JSON.stringify({ report: path.join(outDir, "report.json"), quoteId: report.quoteId, sections: report.sections }, null, 2));
