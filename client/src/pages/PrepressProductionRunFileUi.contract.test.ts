import fs from "node:fs";
import path from "node:path";

describe("mounted Prepress combined run file UI contract", () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  test("mounted Prepress page exposes a Combined Runs area and detail panel", () => {
    expect(source).toContain("Combined Runs");
    expect(source).toContain("Manage shared nested production files without leaving Prepress.");
    expect(source).toContain("useProductionRuns");
    expect(source).toContain("<ProductionRunPanel run={selectedCombinedRun}");
  });

  test("successful Prepress run creation opens the created run detail", () => {
    expect(source).toContain("const result = await createCombinedRunMutation.mutateAsync");
    expect(source).toContain("setSelectedCombinedRunId(createdRunId)");
    expect(source).toContain("setCombinedRunDetailOpen(true)");
    expect(source).toContain("is ready for shared file upload");
  });

  test("Prepress run discovery supports search, status, history, and attention filtering", () => {
    expect(source).toContain("productionRunNeedsPrepressAttention");
    expect(source).toContain("filterPrepressCombinedRuns");
    expect(source).toContain("combinedRunSearchQuery");
    expect(source).toContain("combinedRunStatusFilter");
    expect(source).toContain("combinedRunIncludeHistory");
    expect(source).toContain("Needs Prepress attention");
  });

  test("mounted Prepress queue exposes operator-facing Nest Selected workflow", () => {
    expect(source).toContain("Nest Selected");
    expect(source).toContain("Clear selection");
    expect(source).toContain("Ready to nest");
    expect(source).toContain("getPrepressCombinedRunItemBlocker");
    expect(source).toContain("canSelectPrepressCombinedRunItem");
    expect(source).toContain("Already nested in an active production run.");
    expect(source).toContain("Create Nested Run");
  });

  test("mounted Nest Selected workflow resolves missing production artwork before creation", () => {
    expect(source).toContain("Resolve production artwork");
    expect(source).toContain("Use sole artwork");
    expect(source).toContain("Assign selected artwork");
    expect(source).toContain("buildCombinedRunArtworkCandidates");
    expect(source).toContain("/api/prepress/line-item/${lineItemId}/files");
    expect(source).toContain("/api/prepress/line-item/${item.lineItemId}/assign-customer-artwork");
    expect(source).toContain("No customer artwork is available for this line item.");
    expect(source).toContain("Needs production artwork");
  });

  test("mounted Prepress page exposes controlled production artwork copy flow", () => {
    expect(source).toContain("Create Production Artwork Copy");
    expect(source).toContain("promote-customer-artwork");
    expect(source).toContain("Generated production filename");
    expect(source).toContain("labelPlacement: \"after_job_prefix\"");
    expect(source).toContain("setPromotionSourceFile(null)");
  });

  test("mounted Prepress job detail shows sheet-plan data separately from material inventory", () => {
    expect(source).toContain("Sheet Plan");
    expect(source).toContain("Production Layout");
    expect(source).toContain("Inventory usage below remains material consumption and stock availability.");
    expect(source).toContain("Sheet layout unavailable.");
    expect(source).toContain("selectedItem?.productionLayout");
    expect(source).toContain("selectedItem?.productionLayoutUnavailableReason");
  });
});
