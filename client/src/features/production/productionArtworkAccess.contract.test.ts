import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migratedScreens = [
  "client/src/features/production/views/FlatbedProductionView.tsx",
  "client/src/features/production/views/RollProductionView.tsx",
  "client/src/features/production/views/ProductionOverviewPage.tsx",
  "client/src/pages/production-job-detail.tsx",
];

describe("production artwork access migration", () => {
  test.each(migratedScreens)("%s uses canonical authenticated artwork access", (file) => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    expect(source).toContain("AuthenticatedArtworkThumbnail");
    expect(source).not.toMatch(/currentArtwork\.fileUrl|window\.open\(firstArtworkFile\.fileUrl|buildDownloadUrl\(currentArtwork\.fileUrl/);
    expect(source).not.toContain("resolveObjectsPublicUrl");
  });
});
