import { expect, test, type Page } from "@playwright/test";

async function openProductEditor(page: Page) {
  await page.goto("/products", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10_000 });

  const firstProduct = page.locator("table tbody tr").first();
  await expect(firstProduct).toBeVisible({ timeout: 15_000 });
  await firstProduct.locator("button").first().click();
  await expect(page.getByRole("heading", { name: "Pricing Preview" })).toBeVisible({ timeout: 20_000 });
}

async function inspectWorkspaceScroll(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    const workspace = document.querySelector('[data-testid="split-workspace"]');
    const editor = document.querySelector('[data-testid="split-workspace-main"]');
    const preview = document.querySelector('[data-testid="split-workspace-preview"]');
    const pricingPanel = document.querySelector('[data-testid="pricing-validation-panel"]');
    if (!main || !workspace || !editor || !preview || !pricingPanel) throw new Error("Product Builder workspace anchors are missing.");

    const isScrollableY = (element: Element) => {
      const style = window.getComputedStyle(element);
      return element.scrollHeight > element.clientHeight && (style.overflowY === "auto" || style.overflowY === "scroll");
    };
    const ancestors: Array<{ tag: string; testId: string | null; overflowY: string; scrollHeight: number; clientHeight: number }> = [];
    for (let current: Element | null = pricingPanel; current && current !== main; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      ancestors.push({
        tag: current.tagName.toLowerCase(),
        testId: current.getAttribute("data-testid"),
        overflowY: style.overflowY,
        scrollHeight: current.scrollHeight,
        clientHeight: current.clientHeight,
      });
    }

    const mainRect = main.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    main.scrollTop = main.scrollHeight;
    const previewAfterScroll = preview.getBoundingClientRect();

    return {
      mainIsScrollable: isScrollableY(main),
      competingPreviewAncestor: ancestors.find((entry) => entry.scrollHeight > entry.clientHeight && (entry.overflowY === "auto" || entry.overflowY === "scroll")) ?? null,
      previewIsScrollable: isScrollableY(preview),
      panelIsScrollable: isScrollableY(pricingPanel),
      layout: {
        editorTop: editorRect.top,
        editorBottom: editorRect.bottom,
        previewTop: previewRect.top,
        previewBottomAtPageEnd: previewAfterScroll.bottom,
        mainBottom: mainRect.bottom,
      },
    };
  });
}

test.describe("Product Builder scroll ownership", () => {
  test("desktop keeps Pricing Preview in the page scroll path", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProductEditor(page);

    const audit = await inspectWorkspaceScroll(page);
    expect(audit.mainIsScrollable).toBe(true);
    expect(audit.competingPreviewAncestor).toBeNull();
    expect(audit.previewIsScrollable).toBe(false);
    expect(audit.panelIsScrollable).toBe(false);
    expect(audit.layout.previewBottomAtPageEnd).toBeLessThanOrEqual(audit.layout.mainBottom + 1);
  });

  test("tablet and mobile stack the workspace without trapping the preview", async ({ page }) => {
    for (const viewport of [{ width: 900, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openProductEditor(page);

      const audit = await inspectWorkspaceScroll(page);
      expect(audit.mainIsScrollable).toBe(true);
      expect(audit.competingPreviewAncestor).toBeNull();
      expect(audit.previewIsScrollable).toBe(false);
      expect(audit.panelIsScrollable).toBe(false);
      expect(audit.layout.previewTop).toBeGreaterThanOrEqual(audit.layout.editorBottom - 1);
      expect(audit.layout.previewBottomAtPageEnd).toBeLessThanOrEqual(audit.layout.mainBottom + 1);
    }
  });
});
