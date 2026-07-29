import fs from "node:fs";
import path from "node:path";

describe("ProductionRunFilesPanel contract", () => {
  const root = process.cwd();
  const panel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunFilesPanel.tsx"), "utf8");
  const downstreamPanel = fs.readFileSync(path.join(root, "client/src/features/production/ProductionRunPanel.tsx"), "utf8");

  test("uses the canonical run-file hooks and endpoints indirectly", () => {
    expect(panel).toContain("useProductionRunFiles");
    expect(panel).toContain("useUploadProductionRunFile");
    expect(panel).toContain("useReplaceProductionRunFile");
    expect(panel).toContain("useRetireProductionRunFile");
    expect(panel).toContain("downloadAuthenticatedFile");
  });

  test("shows upload, open, download, replace, retire, history, and Local Bridge state", () => {
    expect(panel).toContain("Upload shared file");
    expect(panel).toContain("Open");
    expect(panel).toContain("Download");
    expect(panel).toContain("Replace");
    expect(panel).toContain("Retire");
    expect(panel).toContain("File history");
    expect(panel).toContain("Local Bridge transfer is active");
    expect(panel).toContain("Unable to load shared files");
  });

  test("uses a controlled retire dialog instead of window.prompt", () => {
    expect(panel).toContain("Retire Shared Production File");
    expect(panel).toContain("retireReason");
    expect(panel).not.toContain("window.prompt");
    expect(downstreamPanel).not.toContain("window.prompt");
  });

  test("downstream ProductionRunPanel reuses the same file component", () => {
    expect(downstreamPanel).toContain("import { ProductionRunFilesPanel }");
    expect(downstreamPanel).toContain("<ProductionRunFilesPanel run={run} />");
  });
});
