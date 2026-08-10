import { describe, expect, test } from "@jest/globals";
import { applyProductDraftBatchCollisions, classifyProductIntakeRouting, fingerprintProductInactiveDraftBatch, normalizeProductDraftBatchName, parseProductInactiveDraftBatch, productInactiveDraftBatchMaxSize } from "../services/assistant/productInactiveDraftBatchService";

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
    expect(fingerprintProductInactiveDraftBatch(children, { route: "Flatbed" })).not.toBe(fingerprintProductInactiveDraftBatch(children));
  });

  test("applies only explicit Shared settings and records them in the batch contract", () => {
    const parsed = parseProductInactiveDraftBatch("Shared settings:\n- Category: Rigid Substrates\n- Sold by square foot\n- Route to flatbed\n- Minimum charge: $25\n- Allow rotation\nProducts:\n- 3mm PVC at $4.50\n- 6mm PVC at $6.25");
    expect(parsed.sharedDefaults).toMatchObject({ category: { value: "Rigid Substrates", source: "shared_default" }, pricingModel: { value: "per_sqft" }, route: { value: "Flatbed" }, minimumChargeCents: { value: 2500 }, allowRotation: { value: true } });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.every((row) => row.provenance.description === "shared")).toBe(true);
  });

  test("keeps one named multiline product with option-value bullets on the single-product route", () => {
    const source = "Create a new inactive product called DEV Test Vinyl Options 080326B.\n\nUse the Print Products category.\nCustomers must enter width and height.\nPrice it at $3.00 per square foot.\n\nAdd one required single-select option named Lamination with these choices:\n- None\n- Gloss\n- Matte\n\nSet None as the default.\nDo not set production routing, sheet settings, rotation, or a minimum charge.\nShow me the complete product before GO.";
    expect(classifyProductIntakeRouting(source)).toBe("single");
  });

  test("recognizes only clear multi-product structures as batch and fails ambiguous wording closed", () => {
    expect(classifyProductIntakeRouting("Name,Description\nBanner,13oz banner\nYard Sign,4mm coroplast")).toBe("batch");
    expect(classifyProductIntakeRouting("Products:\n- Banner - 13oz banner\n- Yard Sign - 4mm coroplast")).toBe("batch");
    expect(classifyProductIntakeRouting("Create a product called Banner. Create a product called Yard Sign.")).toBe("batch");
    expect(classifyProductIntakeRouting("1. Product name: Banner\n2. Product name: Yard Sign")).toBe("batch");
    expect(classifyProductIntakeRouting("Create several products with these settings.")).toBe("ambiguous");
  });

  test("does not accept configuration prose or option values as batch identities", () => {
    const parsed = parseProductInactiveDraftBatch("- Use the Print Products category\n- Gloss\n- Matte");
    expect(parsed.rows.every((row) => row.status === "clarification")).toBe(true);
    expect(parsed.rows.every((row) => row.reasons.join(" ").includes("product identity"))).toBe(true);
  });
});
