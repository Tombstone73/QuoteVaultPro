import fs from "node:fs";
import path from "node:path";

describe("mounted Prepress combined run file UI contract", () => {
  const root = process.cwd();
  const source = fs.readFileSync(path.join(root, "client/src/pages/PrepressProductionPageV2.tsx"), "utf8");

  test("mounted Prepress page exposes the resizable workspace and Combined Runs tab", () => {
    expect(source).toContain("prepress-resizable-workspace");
    expect(source).toContain("prepress-pane-divider");
    expect(source).toContain("PREPRESS_PANE_WIDTH_STORAGE_KEY");
    expect(source).toContain("Prepress Queue");
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
    expect(source).toContain("prepress-bottom-action-bar");
    expect(source).toContain("prepress-queue-selection-footer");
    expect(source).toContain("prepress-queue-scroll-area");
    expect(source).toContain("prepress-queue-nest-selected");
    expect(source).toContain("prepress-queue-clear-selection");
    expect(source).toContain("Nest Selected");
    expect(source).toContain("Clear Selection");
    expect(source).toContain("Ready to nest");
    expect(source).toContain("{selectedQueueItems.length} selected");
    expect(source).toContain("disabled={!canOpenCombinedRunDialog}");
    expect(source).toContain("onClick={openCombinedRunWizard}");
    expect(source).toContain("onClick={() => setSelectedQueueLineItemIds(new Set())}");
    expect(source).toContain("getPrepressCombinedRunItemBlocker");
    expect(source).toContain("canSelectPrepressCombinedRunItem");
    expect(source).toContain("Already nested in an active production run.");
    expect(source).toContain("Create Combined Run");
  });

  test("queue selection actions are not duplicated in the global bottom bar", () => {
    const scrollIndex = source.indexOf("prepress-queue-scroll-area");
    const queueFooterIndex = source.indexOf("prepress-queue-selection-footer");
    expect(scrollIndex).toBeGreaterThan(-1);
    expect(queueFooterIndex).toBeGreaterThan(scrollIndex);
    expect(source).toContain("pb-4");

    const footerStart = source.indexOf("prepress-bottom-action-bar");
    expect(footerStart).toBeGreaterThan(-1);
    const globalFooterSource = source.slice(footerStart, footerStart + 5000);
    expect(globalFooterSource).toContain("Start Prepress");
    expect(globalFooterSource).toContain("Mark Prepress Complete");
    expect(globalFooterSource).toContain("Complete and Release");
    expect(globalFooterSource).not.toContain("Nest Selected");
    expect(globalFooterSource).not.toContain("Clear Selection");
  });

  test("mounted Nest Selected workflow is an in-pane four-step wizard", () => {
    expect(source).toContain("prepress-combined-run-wizard");
    expect(source).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(source).toContain("prepress-combined-run-wizard-footer");
    expect(source).toContain("Step 1: Selected Jobs");
    expect(source).toContain("Step 2: Resolve Production Artwork");
    expect(source).toContain("Step 3: Plan Run");
    expect(source).toContain("Step 4: Final Review");
    expect(source).toContain("Next: Resolve Artwork");
    expect(source).toContain("Next: Plan Run");
    expect(source).toContain("Next: Final Review");
    expect(source).toContain("Cancel");
    expect(source).toContain("Back");
    expect(source).toContain("currentCombinedRunStepBlocker");
    expect(source).toContain("Advanced / Authorized Override");
    expect(source).toContain("{!combinedRunOpen ? (");
  });

  test("mounted Nest Selected workflow resolves missing production artwork before creation", () => {
    expect(source).toContain("Resolve Production Artwork");
    expect(source).toContain("Selected jobs missing production artwork or valid print quantities appear here.");
    expect(source).toContain("Use sole artwork");
    expect(source).toContain("Assign selected artwork");
    expect(source).toContain("Assign Existing Artwork");
    expect(source).toContain("Resolve Artwork");
    expect(source).toContain("buildCombinedRunArtworkCandidates");
    expect(source).toContain("/api/prepress/line-item/${lineItemId}/files");
    expect(source).toContain("/api/prepress/line-item/${lineItemId}/assign-customer-artwork");
    expect(source).toContain("No customer artwork is available for this line item.");
    expect(source).toContain("Production artwork exists, but the assigned print quantities are not valid yet.");
    expect(source).toContain("Refresh Artwork");
    expect(source).toContain("onUpdateQuantity");
    expect(source).toContain("/api/prepress/files/${fileId}/artwork-allocation");
    expect(source).toContain("Needs production artwork");
    expect(source).not.toContain("Upload production artwork from the job detail");
  });

  test("Final Review shows member artwork evidence and production file strategy", () => {
    expect(source).toContain("Total member quantity:");
    expect(source).toContain("<ArtworkProductionBreakdownList item={item} showHeader />");
    expect(source).toContain("Production File Strategy");
    expect(source).toContain("RIP will nest member artwork");
    expect(source).toContain("Upload prepared nested file after run creation");
    expect(source).toContain("Source member artwork remains unchanged.");
    expect(source).toContain("Release remains blocked until an active run-owned file exists.");
  });

  test("mounted Nest Selected workflow includes an inline production artwork resolver", () => {
    expect(source).toContain("combinedRunArtworkResolverLineItemId");
    expect(source).toContain("prepress-combined-run-artwork-resolver");
    expect(source).toContain("openCombinedRunArtworkResolver");
    expect(source).toContain("closeCombinedRunArtworkResolver");
    expect(source).toContain("setCombinedRunWizardStep(2)");
    expect(source).toContain("setSelectedLineItemId(lineItemId)");
    expect(source).toContain("Upload Replacement Artwork");
    expect(source).toContain("Upload Production Artwork");
    expect(source).toContain("Customer Artwork");
    expect(source).toContain("Proof Files");
    expect(source).toContain("Production Art Candidate");
    expect(source).toContain("Use as Production Artwork");
    expect(source).toContain("Create Modified Copy");
    expect(source).toContain("Remove Candidate");
    expect(source).toContain("PrepressArtworkSideSelect");
  });

  test("inline artwork resolver preserves combined-run draft state and refreshes one line", () => {
    expect(source).toContain("refreshCombinedRunArtworkForLineItem");
    expect(source).toContain("setCombinedRunArtworkByLineItem((current) => ({ ...current, [lineItemId]: candidates }))");
    expect(source).toContain("setCombinedRunArtworkSelections((current) =>");
    expect(source).toContain("setCombinedRunAllocations((current) => ({ ...current, [item.lineItemId]: event.target.value }))");
    expect(source).toContain("combinedRunPlannedSheetCount");
    expect(source).toContain("combinedRunPiecesPerSheet");
    expect(source).toContain("combinedRunNotes");
    expect(source).toContain("combinedRunOverrideReason");
    expect(source).toContain("setCombinedRunArtworkResolverLineItemId(null)");
    expect(source).toContain("isPageVisible");
    expect(source).not.toContain("setCombinedRunOpen(false); }} className=\"h-9 px-2 text-[11px]\"");
  });

  test("final combined-run creation returns stale artwork failures to Step 2", () => {
    expect(source).toContain("if (/artwork|production file|final file/i.test(message))");
    expect(source).toContain("setCombinedRunWizardStep(2)");
    expect(source).toContain("Promise.all(selectedQueueItems.map((item) => refreshCombinedRunArtworkForLineItem(item.lineItemId)))");
    expect(source).toContain("const result = await createCombinedRunMutation.mutateAsync");
  });

  test("Combined Runs empty state explains how runs are created", () => {
    expect(source).toContain("No combined runs yet.");
    expect(source).toContain("Select two or more compatible jobs from the Prepress Queue and choose Nest Selected to create one.");
    expect(source).toContain("Go to Prepress Queue");
    expect(source).toContain("onClick={() => setWorkspaceTab(\"queue\")}");
    expect(source).toContain("onClick={openCombinedRunWizard}");
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
