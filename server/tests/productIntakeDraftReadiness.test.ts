import { describe, expect, test } from "@jest/globals";
import { evaluateInactiveDraftReadiness } from "../services/productIntakeWizard/productIntakeDraftReadinessService";

function review(overrides: Record<string, any> = {}): any {
  const value = {
    intake: { sessionId: "session-1", status: "draft_created" },
    product: { id: "product-1", name: "3mm PVC", category: "Rigid", isActive: false, pbv2ActiveTreeVersionId: null, measurementMode: "dimensions_required", workflowIntent: "standard_production", primaryMaterialId: "material-1", useNestingCalculator: true, sheetWidth: "48", sheetHeight: "96", materialType: "sheet", allowZeroPrice: false, requiresProductionJob: true },
    pbv2Tree: { status: "DRAFT", updatedAt: "2026-07-27T00:00:00.000Z", basePricing: { perSqftCents: 250, perPieceCents: null, minimumChargeCents: 1000 }, requiresDimensions: true, fixedDimensions: null, relationships: { routing: { stationId: "station-1", stationKey: "flatbed", stationName: "Flatbed" }, optionTemplates: [], setupNote: null, reviewWarnings: [], missingFieldWarnings: [] } },
    publishReadiness: { findings: [] },
  };
  return { ...value, ...overrides, product: { ...value.product, ...(overrides.product ?? {}) }, pbv2Tree: { ...value.pbv2Tree, ...(overrides.pbv2Tree ?? {}) } };
}

const healthy = { material: { exists: true, active: true, type: "sheet" }, station: { exists: true, active: true }, optionTemplates: {} };

describe("inactive draft readiness", () => {
  test("returns ready for a complete inactive PBV2 DRAFT without activating it", () => {
    const result = evaluateInactiveDraftReadiness(review(), healthy);
    expect(result.status).toBe("ready_for_human_activation");
    expect(result.inactive).toBe(true);
    expect(result.pbv2Draft).toBe(true);
  });

  test("blocks a missing base price and missing production route", () => {
    const result = evaluateInactiveDraftReadiness(review({ pbv2Tree: { basePricing: { perSqftCents: null, perPieceCents: null, minimumChargeCents: null }, relationships: { routing: null, optionTemplates: [], setupNote: null, reviewWarnings: [], missingFieldWarnings: [] } } }), healthy);
    expect(result.status).toBe("blocked");
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(["PRICING_MISSING", "ROUTING_MISSING"]));
  });

  test("does not require a material or route for a valid service fee", () => {
    const result = evaluateInactiveDraftReadiness(review({ product: { workflowIntent: "service_fee", measurementMode: "quantity_only", primaryMaterialId: null, requiresProductionJob: false }, pbv2Tree: { requiresDimensions: false, relationships: { routing: null, optionTemplates: [], setupNote: null, reviewWarnings: [], missingFieldWarnings: [] } } }), { material: null, station: null, optionTemplates: {} });
    expect(result.blockers.map((item) => item.code)).not.toEqual(expect.arrayContaining(["MATERIAL_MISSING", "ROUTING_MISSING"]));
  });

  test("blocks a service fee until its quantity-only and non-production contract agree", () => {
    const measurement = evaluateInactiveDraftReadiness(review({ product: { workflowIntent: "service_fee", measurementMode: "dimensions_required", requiresProductionJob: false } }), healthy);
    const production = evaluateInactiveDraftReadiness(review({ product: { workflowIntent: "service_fee", measurementMode: "quantity_only", requiresProductionJob: true } }), healthy);
    expect(measurement.blockers.map((item) => item.code)).toContain("SERVICE_FEE_MEASUREMENT_INCOMPATIBLE");
    expect(production.blockers.map((item) => item.code)).toContain("SERVICE_FEE_PRODUCTION_JOB_INCOMPATIBLE");
  });

  test("reports disabled station, inactive option templates, and stored review warnings", () => {
    const result = evaluateInactiveDraftReadiness(review({ pbv2Tree: { relationships: { routing: { stationId: "station-1", stationKey: "flatbed", stationName: "Flatbed" }, optionTemplates: [{ templateId: "option-1", name: "White ink", importInstanceId: "import-1" }], setupNote: "Test ink", reviewWarnings: ["Pricing review required"], missingFieldWarnings: [] } } }), { material: healthy.material, station: { exists: true, active: false }, optionTemplates: { "option-1": { exists: true, active: false, priceBearing: false } } });
    expect(result.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(["ROUTING_STATION_INACTIVE", "OPTION_TEMPLATE_INACTIVE"]));
    expect(result.warnings.map((item) => item.message)).toContain("Pricing review required");
  });

  test("never reports an active or non-draft product as ready", () => {
    const result = evaluateInactiveDraftReadiness(review({ product: { isActive: true }, pbv2Tree: { status: "ACTIVE" } }), healthy);
    expect(result.status).toBe("unknown");
    expect(result.unknowns.map((item) => item.code)).toEqual(expect.arrayContaining(["PRODUCT_ACTIVE_OUT_OF_SCOPE", "PBV2_DRAFT_REQUIRED"]));
  });
});
