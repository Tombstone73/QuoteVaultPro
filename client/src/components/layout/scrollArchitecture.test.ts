import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(path, "utf8");

describe("application scroll architecture", () => {
  test("keeps the application main region as the primary page scroll owner", () => {
    const appLayout = source("client/src/components/layout/AppLayout.tsx");
    const styles = source("client/src/index.css");

    expect(appLayout).toContain('h-dvh min-h-0 w-full overflow-hidden');
    expect(appLayout).toContain('root.classList.add("app-shell-scroll-lock")');
    expect(appLayout).toContain('data-testid="app-main-content"');
    expect(appLayout).toContain('overflow-y-auto overscroll-contain bg-background');
    expect(styles).toContain('html.app-shell-scroll-lock #root');
    expect(styles).toContain('overflow: clip;');
  });

  test("keeps Product Editor content in normal page flow", () => {
    const productEditor = source("client/src/pages/ProductEditorPage.tsx");
    const splitWorkspace = source("client/src/components/SplitWorkspace.tsx");
    const builderLayout = source("client/src/components/pbv2/builder-v2/PBV2ProductBuilderLayout.tsx");
    const optionGroups = source("client/src/components/pbv2/builder-v2/OptionGroupsSidebar.tsx");
    const pricingPreview = source("client/src/components/pbv2/builder-v2/PricingValidationPanel.tsx");

    expect(productEditor).not.toContain('min-h-screen h-screen');
    expect(splitWorkspace).toContain('flex min-w-0 flex-col lg:flex-row');
    expect(splitWorkspace).not.toContain('overflow-y-auto p-4');
    expect(splitWorkspace).toContain('data-testid="split-workspace-preview"');
    expect(splitWorkspace).toContain('h-auto min-w-0 max-h-none overflow-visible');
    expect(builderLayout).toContain('flex min-w-0 flex-col bg-[#1e293b] lg:min-h-[600px] lg:flex-row');
    expect(builderLayout).not.toContain('overflow-y-auto bg-[#1e293b]');
    expect(optionGroups).not.toContain('ScrollArea');
    expect(pricingPreview).not.toContain('ScrollArea');
    expect(pricingPreview).toContain('data-testid="pricing-validation-panel"');
    expect(pricingPreview).toContain('h-auto w-full min-w-0 max-w-full overflow-visible bg-card');
  });
});
