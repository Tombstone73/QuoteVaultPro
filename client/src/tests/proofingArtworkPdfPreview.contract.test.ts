import fs from "node:fs";
import path from "node:path";

describe("Proofing artwork PDF preview contract", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "client/src/pages/StaffProofingPage.tsx"), "utf8");

  test("uses the authenticated Blob preview helper instead of directly navigating to protected artwork", () => {
    expect(page).toContain('import { openAuthenticatedPdfPreview } from "@/lib/authenticatedPdfPreview"');
    expect(page).toContain("await openAuthenticatedPdfPreview(url)");
    expect(page).toContain('title: "Unable to open artwork preview"');
    expect(page).toContain("openingArtworkPreviewId");
    expect(page).toContain("onClick={() => void openArtworkPdfPreview(source)}");
    expect(page).toContain("disabled={openingPdfPreview}");
  });
});
