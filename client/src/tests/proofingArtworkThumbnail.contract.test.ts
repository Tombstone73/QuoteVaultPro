import fs from "node:fs";
import path from "node:path";

describe("Proofing artwork thumbnail contract", () => {
  test("uses protected lazy thumbnails and a single authenticated preview action", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "client/src/pages/StaffProofingPage.tsx"), "utf8");
    expect(page).toContain("buildProofingArtworkThumbnailUrl");
    expect(page).toContain("getArtworkSourceThumbnailUrl(source)");
    expect(page).toContain('loading="lazy"');
    expect(page).toContain("ProofingArtworkThumbnailImage");
    expect(page).toContain("object-contain");
    expect(page).toContain("h-32 w-40");
    expect(page).toContain("void openArtworkPreview(source)");
    expect(page).not.toContain("openArtworkPdfPreview");
  });
});
