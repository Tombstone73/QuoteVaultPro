import { buildFileUploadDisplayFilename, buildLocalPrefixedFilename, buildLocalRenamePlan, validateLocalRenamePrefix } from "@shared/fileUploadNaming";
import { filePrefixToolsEnabledFromSettings, withFilePrefixToolsSetting } from "@shared/filePrefixTools";
import { issueLocalRenameToken, verifyLocalRenameToken } from "../services/localRenameAuthorization";
import { buildOrderLineItemArtworkDisplayFilename, buildOrderOriginalArtworkDisplayFilename } from "../services/originalArtworkFiles";

const namingPolicy = { fileUploadJobPrefixMode: "numeric_only" as const, prepressFileLabelMode: "required" as const };

describe("tenant File Prefix Tools authority", () => {
  test("defaults off and stays scoped to each organization's settings", () => {
    expect(filePrefixToolsEnabledFromSettings(null)).toBe(false);
    expect(filePrefixToolsEnabledFromSettings({ preferences: {} })).toBe(false);
    expect(filePrefixToolsEnabledFromSettings({ preferences: { enableFilePrefixTools: "true" } })).toBe(false);
    expect(filePrefixToolsEnabledFromSettings({ preferences: { enableFilePrefixTools: true } })).toBe(true);
    expect(filePrefixToolsEnabledFromSettings({ preferences: { enableFilePrefixTools: false } })).toBe(false);
    const tenantA = { currency: "USD", preferences: { fileUploadNaming: { prepressFileLabelMode: "required" } } };
    const tenantB = { preferences: { enableFilePrefixTools: false } };
    const savedA = withFilePrefixToolsSetting(tenantA, true);
    expect(filePrefixToolsEnabledFromSettings(savedA)).toBe(true);
    expect(savedA).toEqual({ currency: "USD", preferences: { fileUploadNaming: { prepressFileLabelMode: "required" }, enableFilePrefixTools: true } });
    expect(filePrefixToolsEnabledFromSettings(tenantB)).toBe(false);
    expect(filePrefixToolsEnabledFromSettings(withFilePrefixToolsSetting(savedA, false))).toBe(false);
  });

  test("approved names and tenant cannot be altered or used after expiration", () => {
    const prior = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "file-prefix-tools-test-secret";
    try {
      const plan = { prefix: "20685", entries: buildLocalRenamePlan("20685", ["Banner.pdf"]) };
      const token = issueLocalRenameToken("tenant-a", plan, 1000);
      expect(verifyLocalRenameToken(token, plan, 1001)).toBe("tenant-a");
      expect(verifyLocalRenameToken(token, { ...plan, entries: buildLocalRenamePlan("20686", ["Banner.pdf"]) }, 1001)).toBeNull();
      expect(verifyLocalRenameToken(token, plan, 1000 + 30 * 60_000)).toBeNull();
    } finally {
      if (prior === undefined) delete process.env.SESSION_SECRET;
      else process.env.SESSION_SECRET = prior;
    }
  });
});

describe("canonical filename proposals", () => {
  test("local prefix uses exactly two spaces and preserves the original filename and extension", () => {
    expect(buildLocalPrefixedFilename("Print File.ai", "20685")).toBe("20685  Print File.ai");
    expect(buildLocalPrefixedFilename("20685  Cut File.pdf", "20685")).toBe("20685  Cut File.pdf");
    expect(buildLocalRenamePlan("Job A", ["Banner.pdf", "Job A  Cut File.pdf"]).map((entry) => entry.status))
      .toEqual(["ready", "already_prefixed"]);
    expect(buildLocalRenamePlan("A. ", ["Banner.pdf"])[0]).toMatchObject({
      proposedName: "A.   Banner.pdf", status: "ready",
    });
  });

  test("detects invalid Windows names and destination collisions", () => {
    expect(validateLocalRenamePrefix("A/B")).toBeTruthy();
    expect(buildLocalRenamePlan("20685", ["CON.pdf"])[0].status).toBe("invalid");
    expect(buildLocalRenamePlan("20685", ["Banner.pdf", "20685  Banner.pdf"])[0].status).toBe("collision");
    expect(buildLocalRenamePlan("20685", ["a.pdf", "a.pdf"])[0].status).toBe("collision");
    expect(buildLocalRenamePlan("20685", ["bad?.pdf"])[0].status).toBe("invalid");
  });

  test("Order naming uses assigned number once while Prepress keeps its existing format", () => {
    expect(buildOrderLineItemArtworkDisplayFilename({ originalFilename: "art.pdf", orderNumber: "ORD-20685", namingPolicy: null })).toBe("art.pdf");
    expect(buildOrderLineItemArtworkDisplayFilename({ originalFilename: "art.pdf", orderNumber: "ORD-20685", namingPolicy })).toBe("20685_art.pdf");
    expect(buildOrderOriginalArtworkDisplayFilename({ originalFilename: "art.pdf", orderNumber: "ORD-20685", namingPolicy }))
      .toBe("20685_art.pdf");
    expect(buildOrderOriginalArtworkDisplayFilename({ originalFilename: "20685_art.pdf", orderNumber: "ORD-20685", namingPolicy }))
      .toBe("20685_art.pdf");
    expect(buildOrderOriginalArtworkDisplayFilename({ originalFilename: "art.pdf", orderNumber: null, namingPolicy })).toBe("art.pdf");
    expect(buildFileUploadDisplayFilename({ originalFilename: "art.pdf", fullJobNumber: "ORD-20685", numericJobNumber: "20685", fileUploadJobPrefixMode: "numeric_only", prepressLabel: "print" }))
      .toBe("20685_art_PRINT.pdf");
  });
});
