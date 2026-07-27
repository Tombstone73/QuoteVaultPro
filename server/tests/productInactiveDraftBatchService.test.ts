import { describe, expect, test } from "@jest/globals";
import { applyProductDraftBatchCollisions, fingerprintProductInactiveDraftBatch, normalizeProductDraftBatchName, parseProductInactiveDraftBatch, productInactiveDraftBatchMaxSize } from "../services/assistant/productInactiveDraftBatchService";

describe("Product inactive draft batch intake", () => {
  test("parses markdown tables without silently truncating rows", () => {
    const parsed = parseProductInactiveDraftBatch("| Name | Description |\n| --- | --- |\n| Banner | 13oz banner, $5 per sqft |\n| Yard Sign | 4mm coroplast, $8 per piece |");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((row) => row.productName)).toEqual(["Banner", "Yard Sign"]);
    expect(parsed.rows.every((row) => row.status === "ready")).toBe(true);
  });

  test("marks input and tenant normalized-name collisions for review", () => {
    const parsed = parseProductInactiveDraftBatch("- Trade Show Banner - 13oz banner\n- trade-show banner - 18oz banner");
    const collided = applyProductDraftBatchCollisions(parsed.rows, ["Yard Sign"]);
    expect(collided[1].status).toBe("duplicate");
    expect(applyProductDraftBatchCollisions([{ ...parsed.rows[0], productName: "Yard--Sign" }], ["yard sign"])[0].status).toBe("duplicate");
    expect(normalizeProductDraftBatchName("Yard---Sign")).toBe("yard sign");
  });

  test("rejects oversize input instead of truncating it", () => {
    const source = Array.from({ length: productInactiveDraftBatchMaxSize + 1 }, (_, index) => `- Product ${index + 1} - printable item`).join("\n");
    const parsed = parseProductInactiveDraftBatch(source);
    expect(parsed.rows).toHaveLength(productInactiveDraftBatchMaxSize + 1);
    expect(parsed.errors[0]).toContain("at most");
    expect(parsed.rows.every((row) => row.status === "invalid")).toBe(true);
  });

  test("uses a stable fingerprint over the complete reviewed child set", () => {
    const children = [{ rowNumber: 1, productName: "Banner", intakeSessionId: "session_1", proposalFingerprint: "a".repeat(64) }, { rowNumber: 2, productName: "Sign", intakeSessionId: "session_2", proposalFingerprint: "b".repeat(64) }];
    expect(fingerprintProductInactiveDraftBatch(children)).toBe(fingerprintProductInactiveDraftBatch(children));
    expect(fingerprintProductInactiveDraftBatch(children)).not.toBe(fingerprintProductInactiveDraftBatch([...children].reverse()));
  });
});
