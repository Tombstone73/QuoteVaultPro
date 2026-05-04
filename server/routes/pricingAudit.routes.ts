/**
 * pricingAudit.routes.ts
 *
 * Read-only admin diagnostic tool that analyzes how PBV2 pricing is currently
 * configured across all active products in an organization.
 *
 * Classifies each product's pricing into:
 *   - material_driven  — formula references base_price / p / cost
 *   - market_pricing   — hardcoded numeric multipliers or flat constants
 *   - hybrid           — mix of the two
 *   - no_pricing       — no formula or tree found
 *   - unknown          — formula exists but cannot be classified
 *
 * Route:
 *   GET /api/admin/pricing-audit
 *
 * Auth: isAuthenticated + tenantContext + isAdmin
 * This route is READ-ONLY — it never modifies any data.
 */

import type { Express } from "express";
import { db } from "../db";
import { products, pbv2TreeVersions, materials, pricingFormulas } from "@shared/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { getRequestOrganizationId } from "../tenantContext";

// ─── Types ─────────────────────────────────────────────────────────────────

export type PricingType =
  | "material_driven"
  | "market_pricing"
  | "hybrid"
  | "no_pricing"
  | "unknown";

export type FormulaSource =
  | "pbv2_override"      // treeJson.meta.pricingFormula
  | "pbv2_structured"    // treeJson.meta.pricingV2 (no formula string)
  | "formula_library"    // product.pricingFormulaId → pricingFormulas.expression
  | "legacy_formula"     // product.pricingFormula (direct text)
  | "none";

export interface ProductAuditRow {
  id: string;
  name: string;
  category: string | null;
  materialType: string | null;
  pricingEngine: string | null;
  isActive: boolean;

  // Material linkage
  primaryMaterialId: string | null;
  primaryMaterialName: string | null;

  // Formula provenance
  formulaSource: FormulaSource;
  formulaString: string | null;

  // Variable analysis
  referencedVariables: string[];
  usesMaterialBasePrice: boolean;  // base_price or p
  usesCost: boolean;               // cost / costPerUnit references

  // Structured PBV2 details (when formulaSource === "pbv2_structured")
  hasStructuredPbv2: boolean;
  perSqftCents: number | null;
  perPieceCents: number | null;
  hasTieredPricing: boolean;

  // Classification
  pricingType: PricingType;
  hasHardcodedMultiplier: boolean;
  hardcodedValues: number[];

  // Flags
  materialNotUsedInPricing: boolean;   // has primary material but formula ignores it
  multiMaterialWarning: boolean;       // roll product that may need multiple materials
  notes: string[];
}

export interface PricingAuditResult {
  organizationId: string;
  generatedAt: string;
  totalProducts: number;
  summary: {
    materialDriven: number;
    marketPricing: number;
    hybrid: number;
    noPricing: number;
    unknown: number;
    pctMaterialDriven: number;
    pctMarketPricing: number;
    pctNoPricing: number;
    pctHardcoded: number;
    pctMaterialNotUsed: number;
  };
  rows: ProductAuditRow[];
}

// ─── Formula analysis helpers ───────────────────────────────────────────────

const MATERIAL_BASE_PRICE_PATTERNS = [
  /\bbase_price\b/,
  /\bp\b/,   // single-character alias for base_price
];

const COST_PATTERNS = [
  /\bcost\b/,
  /\bcost_per_unit\b/,
  /\bcostPerUnit\b/,
];

const STANDARD_VARIABLES = [
  "sqft",
  "total_sqft",
  "q",
  "quantity",
  "w",
  "h",
  "fw",
  "fh",
  "linear_feet",
  "trim_allowance",
  "trim_allowance_x",
  "trim_allowance_y",
  "ordered_width",
  "ordered_height",
  "finished_width",
  "finished_height",
];

// Matches: sqft * 3.5  |  3.5 * sqft  |  q * 10  |  linear_feet / 2
const HARDCODED_MULTIPLIER_REGEX =
  /\b(?:sqft|total_sqft|q|quantity|w|h|fw|fh|linear_feet)\s*[\*\/]\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*[\*\/]\s*(?:sqft|total_sqft|q|quantity|w|h|fw|fh|linear_feet)\b/g;

// Pure constant: formula is only numbers and arithmetic operators
const PURE_CONSTANT_REGEX = /^[\d\s\+\-\*\/\.()]+$/;

function analyzeFormula(formula: string | null): {
  referencedVariables: string[];
  usesMaterialBasePrice: boolean;
  usesCost: boolean;
  hasHardcodedMultiplier: boolean;
  hardcodedValues: number[];
} {
  if (!formula || formula.trim() === "") {
    return {
      referencedVariables: [],
      usesMaterialBasePrice: false,
      usesCost: false,
      hasHardcodedMultiplier: false,
      hardcodedValues: [],
    };
  }

  const f = formula.trim();
  const vars = new Set<string>();

  const usesMaterialBasePrice = MATERIAL_BASE_PRICE_PATTERNS.some((re) => re.test(f));
  const usesCost = COST_PATTERNS.some((re) => re.test(f));

  if (usesMaterialBasePrice) {
    if (/\bbase_price\b/.test(f)) vars.add("base_price");
    if (/\bp\b/.test(f)) vars.add("p");
  }
  if (usesCost) vars.add("cost");

  for (const v of STANDARD_VARIABLES) {
    if (new RegExp(`\\b${v}\\b`).test(f)) vars.add(v);
  }

  // Extract hardcoded numeric multipliers
  const hardcodedValues: number[] = [];
  let m: RegExpExecArray | null;
  HARDCODED_MULTIPLIER_REGEX.lastIndex = 0;
  while ((m = HARDCODED_MULTIPLIER_REGEX.exec(f)) !== null) {
    const raw = m[1] ?? m[2];
    if (raw !== undefined) {
      hardcodedValues.push(parseFloat(raw));
    }
  }

  // Also flag pure constant formulas
  const isPureConstant = PURE_CONSTANT_REGEX.test(f);
  if (isPureConstant && hardcodedValues.length === 0) {
    // Extract the numeric value from a pure constant formula
    const num = parseFloat(f.replace(/[^0-9.]/g, ""));
    if (!isNaN(num)) hardcodedValues.push(num);
  }

  return {
    referencedVariables: Array.from(vars),
    usesMaterialBasePrice,
    usesCost,
    hasHardcodedMultiplier: hardcodedValues.length > 0 || isPureConstant,
    hardcodedValues: [...new Set(hardcodedValues)],
  };
}

function classifyPricingType(opts: {
  formulaSource: FormulaSource;
  usesMaterialBasePrice: boolean;
  usesCost: boolean;
  hasHardcodedMultiplier: boolean;
  formulaString: string | null;
  hasStructuredPbv2: boolean;
}): PricingType {
  const {
    formulaSource,
    usesMaterialBasePrice,
    usesCost,
    hasHardcodedMultiplier,
    formulaString,
    hasStructuredPbv2,
  } = opts;

  if (formulaSource === "none" && !hasStructuredPbv2) return "no_pricing";

  // Structured PBV2 without formula override → hardcoded perSqftCents in tree
  if (formulaSource === "pbv2_structured") return "market_pricing";

  if (!formulaString) return "no_pricing";

  const usesMaterial = usesMaterialBasePrice || usesCost;

  if (usesMaterial && hasHardcodedMultiplier) return "hybrid";
  if (usesMaterial) return "material_driven";
  if (hasHardcodedMultiplier) return "market_pricing";

  // Formula exists but we couldn't classify it
  return "unknown";
}

function buildNotes(row: {
  pricingType: PricingType;
  formulaSource: FormulaSource;
  formulaString: string | null;
  hasHardcodedMultiplier: boolean;
  hardcodedValues: number[];
  primaryMaterialId: string | null;
  materialNotUsedInPricing: boolean;
  multiMaterialWarning: boolean;
  pricingEngine: string | null;
  hasTieredPricing: boolean;
  perSqftCents: number | null;
}): string[] {
  const notes: string[] = [];

  if (row.formulaSource === "pbv2_structured") {
    const rate =
      row.perSqftCents !== null
        ? `$${(row.perSqftCents / 100).toFixed(4)}/sqft`
        : "unset";
    notes.push(`Structured PBV2 rate: ${rate}`);
    if (row.hasTieredPricing) notes.push("Has qty/sqft tier overrides");
  }

  if (row.hasHardcodedMultiplier && row.hardcodedValues.length > 0) {
    notes.push(`Hardcoded multiplier(s): ${row.hardcodedValues.join(", ")}`);
  }

  if (row.materialNotUsedInPricing && row.primaryMaterialId) {
    notes.push("Primary material linked but not referenced in formula");
  }

  if (row.multiMaterialWarning) {
    notes.push("Roll product — may require multiple materials (e.g. vinyl + laminate)");
  }

  if (row.pricingType === "no_pricing") {
    notes.push("No pricing configured");
  }

  if (row.formulaSource === "pbv2_override") {
    notes.push("Formula overrides default PBV2 structured pricing");
  }

  return notes;
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerPricingAuditRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  }
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  /**
   * GET /api/admin/pricing-audit
   *
   * Returns a full pricing audit for every active product in the org.
   * Read-only — no data is modified.
   */
  app.get(
    "/api/admin/pricing-audit",
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) {
          return res.status(500).json({ message: "Missing organization context" });
        }

        // ── 1. Fetch all active products ───────────────────────────────────
        const allProducts = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.organizationId, organizationId),
              eq(products.isActive, true)
            )
          )
          .orderBy(asc(products.name));

        if (allProducts.length === 0) {
          return res.json(buildEmptyResult(organizationId));
        }

        const productIds = allProducts.map((p) => p.id);

        // ── 2. Fetch PBV2 trees (PUBLISHED status only) ────────────────────
        const treeVersionRows = await db
          .select()
          .from(pbv2TreeVersions)
          .where(
            and(
              eq(pbv2TreeVersions.organizationId, organizationId),
              inArray(pbv2TreeVersions.productId, productIds),
              eq(pbv2TreeVersions.status, "PUBLISHED")
            )
          );

        // Map productId → latest published tree
        const treeByProduct = new Map<string, any>();
        for (const tree of treeVersionRows) {
          const existing = treeByProduct.get(tree.productId);
          if (!existing || (tree.publishedAt && existing.publishedAt && tree.publishedAt > existing.publishedAt)) {
            treeByProduct.set(tree.productId, tree);
          }
        }

        // ── 3. Fetch materials ─────────────────────────────────────────────
        const allMaterials = await db
          .select()
          .from(materials)
          .where(eq(materials.organizationId, organizationId));

        const materialById = new Map(allMaterials.map((m) => [m.id, m]));

        // ── 4. Fetch pricing formula library entries ───────────────────────
        const formulaLibraryIds = [
          ...new Set(
            allProducts
              .map((p) => p.pricingFormulaId)
              .filter((id): id is string => !!id)
          ),
        ];

        const formulaLibraryRows =
          formulaLibraryIds.length > 0
            ? await db
                .select()
                .from(pricingFormulas)
                .where(inArray(pricingFormulas.id, formulaLibraryIds))
            : [];

        const formulaById = new Map(formulaLibraryRows.map((f) => [f.id, f]));

        // ── 5. Analyse each product ────────────────────────────────────────
        const rows: ProductAuditRow[] = [];

        for (const product of allProducts) {
          const tree = product.pbv2ActiveTreeVersionId
            ? treeByProduct.get(product.id)
            : null;

          const treeJson: any = tree?.treeJson ?? null;
          const pricingV2 = treeJson?.meta?.pricingV2 ?? null;
          const treeFormulaOverride: string | null =
            typeof treeJson?.meta?.pricingFormula === "string"
              ? treeJson.meta.pricingFormula.trim() || null
              : null;

          // Determine formula source and string
          let formulaSource: FormulaSource = "none";
          let formulaString: string | null = null;
          let hasStructuredPbv2 = false;
          let perSqftCents: number | null = null;
          let perPieceCents: number | null = null;
          let hasTieredPricing = false;

          if (treeFormulaOverride) {
            formulaSource = "pbv2_override";
            formulaString = treeFormulaOverride;
          } else if (pricingV2) {
            hasStructuredPbv2 = true;
            formulaSource = "pbv2_structured";
            perSqftCents =
              typeof pricingV2.base?.perSqftCents === "number"
                ? pricingV2.base.perSqftCents
                : null;
            perPieceCents =
              typeof pricingV2.base?.perPieceCents === "number"
                ? pricingV2.base.perPieceCents
                : null;
            hasTieredPricing =
              (Array.isArray(pricingV2.qtyTiers) && pricingV2.qtyTiers.length > 0) ||
              (Array.isArray(pricingV2.sqftTiers) && pricingV2.sqftTiers.length > 0);
          } else if (product.pricingFormulaId && formulaById.has(product.pricingFormulaId)) {
            const libFormula = formulaById.get(product.pricingFormulaId)!;
            formulaSource = "formula_library";
            formulaString = libFormula.expression ?? null;
          } else if (product.pricingFormula) {
            formulaSource = "legacy_formula";
            formulaString = product.pricingFormula;
          }

          // Analyse the formula text
          const analysis = analyzeFormula(formulaString);

          // Classify
          const pricingType = classifyPricingType({
            formulaSource,
            usesMaterialBasePrice: analysis.usesMaterialBasePrice,
            usesCost: analysis.usesCost,
            hasHardcodedMultiplier: analysis.hasHardcodedMultiplier,
            formulaString,
            hasStructuredPbv2,
          });

          // Material linkage
          const mat = product.primaryMaterialId
            ? materialById.get(product.primaryMaterialId)
            : null;

          const materialNotUsedInPricing =
            !!product.primaryMaterialId &&
            !analysis.usesMaterialBasePrice &&
            !analysis.usesCost;

          // Multi-material warning: roll products typically use media + laminate
          const multiMaterialWarning =
            product.materialType === "roll" ||
            (typeof product.category === "string" &&
              /\b(vinyl|banner|roll|window\s*perf|perforated)\b/i.test(
                product.category
              ));

          const row: ProductAuditRow = {
            id: product.id,
            name: product.name ?? "(unnamed)",
            category: product.category ?? null,
            materialType: product.materialType ?? null,
            pricingEngine: product.pricingEngine ?? null,
            isActive: product.isActive ?? true,

            primaryMaterialId: product.primaryMaterialId ?? null,
            primaryMaterialName: mat?.name ?? null,

            formulaSource,
            formulaString,

            referencedVariables: analysis.referencedVariables,
            usesMaterialBasePrice: analysis.usesMaterialBasePrice,
            usesCost: analysis.usesCost,

            hasStructuredPbv2,
            perSqftCents,
            perPieceCents,
            hasTieredPricing,

            pricingType,
            hasHardcodedMultiplier: analysis.hasHardcodedMultiplier,
            hardcodedValues: analysis.hardcodedValues,

            materialNotUsedInPricing,
            multiMaterialWarning,
            notes: [],
          };

          row.notes = buildNotes(row);
          rows.push(row);
        }

        // ── 6. Compute summary ─────────────────────────────────────────────
        const total = rows.length;
        const count = (type: PricingType) =>
          rows.filter((r) => r.pricingType === type).length;

        const materialDriven = count("material_driven");
        const marketPricing = count("market_pricing");
        const hybrid = count("hybrid");
        const noPricing = count("no_pricing");
        const unknown = count("unknown");
        const hardcoded = rows.filter((r) => r.hasHardcodedMultiplier).length;
        const materialNotUsed = rows.filter((r) => r.materialNotUsedInPricing).length;

        const pct = (n: number) =>
          total > 0 ? Math.round((n / total) * 100) : 0;

        const result: PricingAuditResult = {
          organizationId,
          generatedAt: new Date().toISOString(),
          totalProducts: total,
          summary: {
            materialDriven,
            marketPricing,
            hybrid,
            noPricing,
            unknown,
            pctMaterialDriven: pct(materialDriven),
            pctMarketPricing: pct(marketPricing),
            pctNoPricing: pct(noPricing),
            pctHardcoded: pct(hardcoded),
            pctMaterialNotUsed: pct(materialNotUsed),
          },
          rows,
        };

        return res.json(result);
      } catch (error) {
        console.error("[PricingAudit] Error:", error);
        return res.status(500).json({ message: "Failed to run pricing audit" });
      }
    }
  );
}

function buildEmptyResult(organizationId: string): PricingAuditResult {
  return {
    organizationId,
    generatedAt: new Date().toISOString(),
    totalProducts: 0,
    summary: {
      materialDriven: 0,
      marketPricing: 0,
      hybrid: 0,
      noPricing: 0,
      unknown: 0,
      pctMaterialDriven: 0,
      pctMarketPricing: 0,
      pctNoPricing: 0,
      pctHardcoded: 0,
      pctMaterialNotUsed: 0,
    },
    rows: [],
  };
}
