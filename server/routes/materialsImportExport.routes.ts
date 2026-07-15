/**
 * materialsImportExport.routes.ts
 *
 * CSV-based bulk import/export workflow for materials.
 *
 * Workflow:
 *   1. Admin downloads template  → GET  /api/admin/data/materials/template.csv
 *   2. Admin exports current     → GET  /api/admin/data/materials/export.csv
 *   3. Admin uploads CSV         → POST /api/admin/data/materials/import
 *      → staged in material_import_batches + material_import_rows (never touches live materials)
 *   4. Admin reviews             → GET  /api/admin/data/materials/imports/:batchId
 *   5. Admin commits             → POST /api/admin/data/materials/imports/:batchId/commit
 *      → permanent materials written inside a DB transaction
 *   6. Admin cancels (optional)  → POST /api/admin/data/materials/imports/:batchId/cancel
 *   7. Admin lists history       → GET  /api/admin/data/materials/imports
 *
 * SAFETY RULES:
 *   - No CSV row ever goes directly to `materials`. The commit step is required.
 *   - Commit runs in a DB transaction; on failure the batch is marked 'failed'.
 *   - Empty insert arrays are guarded before any DB call.
 *   - IN() with empty lists never runs.
 */

import type { Express } from "express";
import { z } from "zod";
import Papa from "papaparse";
import { db } from "../db";
import {
  materials,
  vendors,
  materialImportBatches,
  materialImportRows,
  auditLogs,
  type MaterialImportBatchStatus,
  type MaterialImportRowStatus,
} from "@shared/schema";
import { eq, and, desc, inArray, ilike } from "drizzle-orm";
import { getRequestOrganizationId } from "../tenantContext";
import {
  normalizeRow,
  validateNormalizedRow,
  buildMaterialPayload,
} from "../utils/materialsCsvNormalization";

// ─── Template column map ───────────────────────────────────────────────────
// CSV column name → schema field path (used for template + export)

const TEMPLATE_COLUMNS = [
  "material_id",        // optional — present in export, used to identify updates
  "material_name",      // required → materials.name
  "sku",                // required → materials.sku
  "material_form",      // required → materials.materialForm
  "inventory_unit",     // required → canonical physical inventory unit
  "consumption_unit",   // required → production consumption unit
  "vendor_cost_unit",   // optional → current vendor-cost detail
  "category",           // → materials.category
  "color",              // → materials.color
  "width",              // → materials.width (sheet width or roll width)
  "height",             // → materials.height (sheet only)
  "thickness",          // → materials.thickness
  "thickness_unit",     // → materials.thicknessUnit (in|mm|mil|gauge)
  "cost_per_unit",      // → materials.costPerUnit
  "stock_quantity",     // → materials.stockQuantity
  "reorder_point",      // → materials.minStockAlert
  "vendor_name",        // → lookup vendors by name → materials.preferredVendorId
  "vendor_sku",         // → materials.vendorSku
  "vendor_cost_per_unit",// → materials.vendorCostPerUnit
  "roll_length_ft",     // → materials.rollLengthFt
  "cost_per_roll",      // → materials.costPerRoll
  "edge_waste_in_per_side",// → materials.edgeWasteInPerSide
  "lead_waste_ft",      // → materials.leadWasteFt
  "tail_waste_ft",      // → materials.tailWasteFt
  "active",             // → materials.isActive (true|false|yes|no|1|0)
  "weight_value",       // → materials.weightValue (numeric, optional)
  "weight_unit",        // → materials.weightUnit (oz|lb|g|kg)
  "weight_basis",       // → materials.weightBasis (each|sqft|sheet|linear_ft|roll)
  "weight_oz_per_basis",// → materials.weightOzPerBasis — export-visible/debug only;
                        //   server always recomputes this on import; imported values are ignored
] as const;

// A sample row for the template so users see the expected format
const TEMPLATE_EXAMPLE_ROW: Record<string, string> = {
  material_id:            "",
  material_name:          "3M Premium Gloss White Vinyl",
  sku:                    "VNL-3M-PGW-54",
  material_form:          "roll",
  inventory_unit:         "square_foot",
  consumption_unit:       "square_foot",
  vendor_cost_unit:       "square_foot",
  category:               "Vinyl",
  color:                  "White",
  width:                  "54",
  height:                 "",
  thickness:              "3",
  thickness_unit:         "mil",
  cost_per_unit:          "0.45",
  stock_quantity:         "0",
  reorder_point:          "0",
  vendor_name:            "3M",
  vendor_sku:             "3M-IJ180C-10",
  vendor_cost_per_unit:   "0.38",
  roll_length_ft:         "164",
  cost_per_roll:          "62.32",
  edge_waste_in_per_side: "0.5",
  lead_waste_ft:          "1",
  tail_waste_ft:          "1",
  active:                 "true",
  weight_value:           "0.32",
  weight_unit:            "lb",
  weight_basis:           "sqft",
  weight_oz_per_basis:    "",    // leave blank — server always recomputes this
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

// ─── Route registration ────────────────────────────────────────────────────

export function registerMaterialsImportExportRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  }
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // ── 1. Download CSV template ─────────────────────────────────────────────
  app.get(
    '/api/admin/data/materials/template.csv',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (_req, res) => {
      const csv = Papa.unparse({
        fields: [...TEMPLATE_COLUMNS],
        data: [TEMPLATE_COLUMNS.map((col) => TEMPLATE_EXAMPLE_ROW[col] ?? '')],
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="materials_template.csv"');
      res.send(csv);
    }
  );

  // ── 2. Download demo CSV (realistic filled example) ─────────────────────
  app.get(
    '/api/admin/data/materials/demo.csv',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (_req, res) => {
      const DEMO_ROWS: Record<string, string>[] = [
        // ── Sheet substrate ────────────────────────────────────────────────
        {
          material_id: '',
          material_name: '4mm White Coroplast 48x96',
          sku: 'CORO-4MM-WHT-48X96',
          material_form: 'sheet',
          inventory_unit: 'sheet',
          vendor_cost_unit: 'sqft',
          consumption_unit: 'sheet',
          category: 'Substrate',
          color: 'White',
          width: '48',
          height: '96',
          thickness: '4',
          thickness_unit: 'mm',
          cost_per_unit: '0.15',
          stock_quantity: '50',
          reorder_point: '10',
          vendor_name: 'Grimco',
          vendor_sku: 'C4W4896',
          vendor_cost_per_unit: '0.12',
          roll_length_ft: '',
          cost_per_roll: '',
          edge_waste_in_per_side: '',
          lead_waste_ft: '',
          tail_waste_ft: '',
          active: 'true',
          weight_value: '0.18',
          weight_unit: 'lb',
          weight_basis: 'sqft',
          weight_oz_per_basis: '',
        },
        // ── Roll media — print vinyl ───────────────────────────────────────
        {
          material_id: '',
          material_name: '54in Economy Print Vinyl',
          sku: 'VINYL-IJ35C-54',
          material_form: 'roll',
          inventory_unit: 'square_foot',
          vendor_cost_unit: 'sqft',
          consumption_unit: 'square_foot',
          category: 'Roll Media',
          color: 'White',
          width: '54',
          height: '',
          thickness: '3',
          thickness_unit: 'mil',
          cost_per_unit: '0.42',
          stock_quantity: '5',
          reorder_point: '1',
          vendor_name: 'Fellers',
          vendor_sku: 'IJ35C-54',
          vendor_cost_per_unit: '0.35',
          roll_length_ft: '150',
          cost_per_roll: '185.00',
          edge_waste_in_per_side: '0.5',
          lead_waste_ft: '1',
          tail_waste_ft: '1',
          active: 'true',
          weight_value: '0.32',
          weight_unit: 'lb',
          weight_basis: 'sqft',
          weight_oz_per_basis: '',
        },
        // ── Roll media — laminate ──────────────────────────────────────────
        {
          material_id: '',
          material_name: '54in Gloss Laminate',
          sku: 'LAM-GLOSS-54',
          material_form: 'roll',
          inventory_unit: 'square_foot',
          vendor_cost_unit: 'sqft',
          consumption_unit: 'square_foot',
          category: 'Laminate',
          color: 'Clear',
          width: '54',
          height: '',
          thickness: '',
          thickness_unit: '',
          cost_per_unit: '0.28',
          stock_quantity: '3',
          reorder_point: '1',
          vendor_name: 'Fellers',
          vendor_sku: 'LAMG54',
          vendor_cost_per_unit: '0.24',
          roll_length_ft: '150',
          cost_per_roll: '165.00',
          edge_waste_in_per_side: '0.5',
          lead_waste_ft: '1',
          tail_waste_ft: '1',
          active: 'true',
          weight_value: '',
          weight_unit: '',
          weight_basis: '',
          weight_oz_per_basis: '',
        },
        // ── Consumable — wire stake ────────────────────────────────────────
        {
          material_id: '',
          material_name: '30in Wire H-Stake',
          sku: 'STAKE-WIRE-30',
          material_form: 'each',
          inventory_unit: 'each',
          vendor_cost_unit: 'ea',
          consumption_unit: 'each',
          category: 'Accessory',
          color: 'Silver',
          width: '',
          height: '',
          thickness: '',
          thickness_unit: '',
          cost_per_unit: '0.42',
          stock_quantity: '200',
          reorder_point: '50',
          vendor_name: 'Grimco',
          vendor_sku: 'HSTAKE30',
          vendor_cost_per_unit: '0.42',
          roll_length_ft: '',
          cost_per_roll: '',
          edge_waste_in_per_side: '',
          lead_waste_ft: '',
          tail_waste_ft: '',
          active: 'true',
          weight_value: '0.15',
          weight_unit: 'lb',
          weight_basis: 'each',
          weight_oz_per_basis: '',
        },
        // ── Ink ───────────────────────────────────────────────────────────
        {
          material_id: '',
          material_name: 'HP 792 Latex Black 775ml',
          sku: 'INK-HP792-BLK-775',
          material_form: 'liquid',
          inventory_unit: 'milliliter',
          vendor_cost_unit: 'ml',
          consumption_unit: 'milliliter',
          category: 'Ink',
          color: 'Black',
          width: '',
          height: '',
          thickness: '',
          thickness_unit: '',
          cost_per_unit: '0.065',
          stock_quantity: '4',
          reorder_point: '1',
          vendor_name: 'HP',
          vendor_sku: 'CN705A',
          vendor_cost_per_unit: '0.058',
          roll_length_ft: '',
          cost_per_roll: '',
          edge_waste_in_per_side: '',
          lead_waste_ft: '',
          tail_waste_ft: '',
          active: 'true',
          weight_value: '',
          weight_unit: '',
          weight_basis: '',
          weight_oz_per_basis: '',
        },
      ];

      const csv = Papa.unparse({
        fields: [...TEMPLATE_COLUMNS],
        data: DEMO_ROWS.map((row) => TEMPLATE_COLUMNS.map((col) => row[col] ?? '')),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="materials_demo.csv"');
      res.send(csv);
    }
  );

  // ── 3. Download field guide (plain-text column reference) ────────────────
  app.get(
    '/api/admin/data/materials/field-guide.txt',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (_req, res) => {
      const guide = `MATERIALS CSV — FIELD GUIDE
===========================
TitanOS  |  Materials Import/Export


OVERVIEW
--------
Upload a CSV to stage rows for review, then commit to apply changes permanently.
No live materials are touched until you click Commit.


MATCH PRIORITY  (how the importer decides create vs. update)
------------------------------------------------------------
Each row is matched against existing materials using four signals, in priority order:

  1. material_id   — strongest. Direct UUID from an export. Use this to be certain.
  2. sku           — matches materials.sku. Only used if that SKU is unique in your catalog.
  3. vendor_name + vendor_sku — matches by preferred vendor + vendor part number pair.
  4. material_name — weakest fallback. Case-insensitive name match.

If two signals on the same row point to different existing materials, the row is
flagged CONFLICT and must be fixed or skipped before the batch can be committed.
Rows with no signal match are treated as new creates.


COLUMNS
-------

material_id
  Required : No
  Type     : UUID string
  Example  : (leave blank for new materials; copy from an export to update existing)
  Notes    : When present, this takes priority over all other identity signals.
             Export your current materials to get these IDs.

material_name
  Required : YES
  Type     : Text
  Example  : 4mm White Coroplast 48x96
  Notes    : Display name shown throughout the app.
             Used as the weakest identity match signal when no id/sku/vendor is set.

sku
  Required : YES
  Type     : Text (max 100 characters)
  Example  : CORO-4MM-WHT-48X96
  Notes    : Your internal stock-keeping unit. Must be non-empty.
             Used as identity match signal — must be unique across your catalog for
             reliable matching.

material_form
  Required : YES
  Allowed  : sheet | roll | liquid | each | bulk_weight
  Example  : sheet
  Notes    : sheet     — rigid cut sheets (coroplast, ACM, foam board, etc.)
             roll      — roll media (vinyl, laminate, banner, canvas)
             liquid    — inks, toners, and other liquids
             each      — hardware and countable items
             bulk_weight — bulk weight-based materials

inventory_unit
  Required : YES
  Allowed  : square_foot | linear_foot | sheet | each | milliliter | pound
  Example  : square_foot
  Notes    : Canonical physical quantity for stock and reorder points.

vendor_cost_unit
  Required : No
  Allowed  : square_foot | linear_foot | sheet | each | milliliter | pound
  Example  : square_foot
  Notes    : Current supplier cost basis when recorded.

consumption_unit
  Required : YES
  Allowed  : square_foot | linear_foot | sheet | each | milliliter | pound
  Example  : square_foot
  Notes    : Production requirement unit. Roll linear feet convert to inventory square feet using usable roll width.

category
  Required : No
  Type     : Text
  Example  : Substrate
  Notes    : Free-form grouping label visible in inventory views.
             Common values: Vinyl, Substrate, Laminate, Ink, Accessory, Banner.

color
  Required : No
  Type     : Text
  Example  : White
  Notes    : Material color. Informational only.

width
  Required : YES for roll; recommended for sheet
  Type     : Number (inches)
  Example  : 54
  Notes    : Roll width or sheet width in inches.

height
  Required : Recommended for sheet
  Type     : Number (inches)
  Example  : 96
  Notes    : Sheet height in inches. Not applicable to rolls.

thickness
  Required : No
  Type     : Number
  Example  : 4
  Notes    : Numeric thickness value. Must be paired with thickness_unit.

thickness_unit
  Required : No  (required if thickness is set)
  Allowed  : in | mm | mil | gauge
  Example  : mm
  Notes    : Unit for the thickness value above.

cost_per_unit
  Required : YES
  Type     : Decimal (USD — no $ symbol)
  Example  : 0.15
  Notes    : Internal material cost per inventory unit. Product sell pricing belongs in PBV2.

stock_quantity
  Required : No  (defaults to 0)
  Type     : Integer
  Example  : 50
  Notes    : Current on-hand quantity in inventory_unit units.

reorder_point
  Required : No  (defaults to 0)
  Type     : Integer
  Example  : 10
  Notes    : Quantity below which a restock alert fires (maps to minStockAlert).

vendor_name
  Required : No
  Type     : Text — must match an existing vendor name, case-insensitive
  Example  : Grimco
  Notes    : Sets the preferred vendor. Paired with vendor_sku as a match signal.
             If vendor_name is not found in your vendor list, a new vendor record
             will be created automatically on commit.

vendor_sku
  Required : No
  Type     : Text
  Example  : C4W4896
  Notes    : The vendor's own part/catalog number for this material.
             Used with vendor_name as an identity match signal.

vendor_cost_per_unit
  Required : No
  Type     : Decimal (USD)
  Example  : 0.12
  Notes    : What the vendor charges you per vendor_cost_unit.

roll_length_ft
  Required : No  (recommended for roll materials)
  Type     : Number (feet)
  Example  : 150
  Notes    : Length of one roll in feet.
             Leave blank for sheet, ink, and consumable materials.

cost_per_roll
  Required : No
  Type     : Decimal (USD)
  Example  : 185.00
  Notes    : Total purchase cost of one full roll.
             If provided, takes precedence over any derived calculation.

edge_waste_in_per_side
  Required : No
  Type     : Number (inches, per side)
  Example  : 0.5
  Notes    : Unusable edge on each side of a roll. Applied once per side, not total.
             A value of 0.5 means 1 inch total width is lost (0.5 each side).

lead_waste_ft
  Required : No  (defaults to 0)
  Type     : Number (feet)
  Example  : 1
  Notes    : Unusable leader at the start of a roll before usable media begins.

tail_waste_ft
  Required : No  (defaults to 0)
  Type     : Number (feet)
  Example  : 1
  Notes    : Unusable tail at the end of a roll after usable media ends.

active
  Required : No  (defaults to true)
  Allowed  : true | false | yes | no | 1 | 0
  Example  : true
  Notes    : Set to false to deactivate a material. Inactive materials are hidden
             from product builder and pricing lookups but remain in the database.

weight_value
  Required : No  (all weight fields must be present together or all left blank)
  Type     : Decimal (positive number)
  Example  : 0.42
  Notes    : The weight of one weight_basis unit of this material, expressed in
             weight_unit units. Must be greater than 0 when provided.
             Leave blank to indicate this material has no weight configured.

weight_unit
  Required : No  (required if weight_value is provided)
  Allowed  : oz | lb | g | kg
  Example  : lb
  Notes    : The unit for weight_value. All weight fields must be provided together
             or all left blank — partial weight data is invalid.

weight_basis
  Required : No  (required if weight_value is provided)
  Allowed  : each | sqft | sheet | linear_ft | roll
  Example  : sqft
  Notes    : The basis unit that weight_value applies to.
               each      — weight per individual item (e.g. a stake, a grommet)
               sqft      — weight per square foot (e.g. vinyl, coroplast, ACM)
               sheet     — weight per full sheet
               linear_ft — weight per linear foot (e.g. extrusion, trim)
               roll      — weight per full roll

weight_oz_per_basis
  Required : No  — do not fill in; server always recomputes this value.
  Type     : Decimal
  Example  : (leave blank on import)
  Notes    : Canonical normalized weight in ounces per weight_basis unit.
             This column is EXPORT-ONLY for visibility and debugging.
             Any value provided here during import is silently ignored.
             The server always recomputes it from weight_value + weight_unit +
             weight_basis using the same formula as the runtime weight resolver.


COMMIT BEHAVIOR
---------------
  create  — row inserts a new material record.
  update  — row updates the matched existing material in-place.
  skip    — row was manually skipped and will not be applied.

Commit runs inside a database transaction. If any row fails, ALL changes roll back
and the batch is marked "failed". No partial commits are possible.

New vendor records are created inside the same transaction if vendor_name is
provided but not found in your existing vendor list.


TIPS
----
  * Export your current materials first, edit the CSV, then re-import —
    the exported material_id values guarantee exact matches with no ambiguity.

  * SKU is the most reliable match signal if you don't have material IDs.
    Keep SKUs globally unique within your catalog.

  * Leave material_id blank on every row when importing net-new materials.

  * Invalid and conflict rows must be fixed or skipped before a batch can be
    committed. Use "Skip all invalid / conflict" to commit only the clean rows.
`;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="materials_field_guide.txt"');
      res.send(guide);
    }
  );

  // ── 4. Export current materials as CSV ───────────────────────────────────
  app.get(
    '/api/admin/data/materials/export.csv',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';

        const rows = await db
          .select()
          .from(materials)
          .where(
            includeInactive
              ? eq(materials.organizationId, organizationId)
              : and(eq(materials.organizationId, organizationId), eq(materials.isActive, true))
          )
          .orderBy(materials.name);

        // Fetch all vendors to resolve names
        const allVendors = await db
          .select({ id: vendors.id, name: vendors.name })
          .from(vendors)
          .where(eq(vendors.organizationId, organizationId));
        const vendorById = new Map(allVendors.map((v) => [v.id, v.name]));

        const exportRows = rows.map((m) => ({
          material_id:            m.id,
          material_name:          m.name,
          sku:                    m.sku,
          material_form:          m.materialForm ?? '',
          inventory_unit:         m.inventoryUnit ?? '',
          consumption_unit:       m.consumptionUnit ?? '',
          vendor_cost_unit:       m.vendorCostUnit ?? '',
          category:               m.category ?? '',
          color:                  m.color ?? '',
          width:                  m.width ?? '',
          height:                 m.height ?? '',
          thickness:              m.thickness ?? '',
          thickness_unit:         m.thicknessUnit ?? '',
          cost_per_unit:          m.costPerUnit,
          stock_quantity:         m.stockQuantity,
          reorder_point:          m.minStockAlert,
          vendor_name:            m.preferredVendorId ? (vendorById.get(m.preferredVendorId) ?? '') : '',
          vendor_sku:             m.vendorSku ?? '',
          vendor_cost_per_unit:   m.vendorCostPerUnit ?? '',
          roll_length_ft:         m.rollLengthFt ?? '',
          cost_per_roll:          m.costPerRoll ?? '',
          edge_waste_in_per_side: m.edgeWasteInPerSide ?? '',
          lead_waste_ft:          m.leadWasteFt ?? '',
          tail_waste_ft:          m.tailWasteFt ?? '',
          active:                 m.isActive ? 'true' : 'false',
          weight_value:           m.weightValue ?? '',
          weight_unit:            m.weightUnit ?? '',
          weight_basis:           m.weightBasis ?? '',
          weight_oz_per_basis:    m.weightOzPerBasis ?? '',  // server-computed canonical value
        }));

        const csv = Papa.unparse(exportRows, { columns: [...TEMPLATE_COLUMNS] });
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="materials_export_${ts}.csv"`);
        res.send(csv);
      } catch (error) {
        console.error('[MaterialsExport] Error:', error);
        res.status(500).json({ message: 'Failed to export materials' });
      }
    }
  );

  // ── 5. Upload + stage CSV ────────────────────────────────────────────────
  app.post(
    '/api/admin/data/materials/import',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const bodySchema = z.object({
          csvData: z.string().min(1, 'csvData is required'),
          sourceFilename: z.string().optional(),
        });

        let parsed;
        try {
          parsed = bodySchema.parse(req.body);
        } catch (err: any) {
          return res.status(400).json({ message: err.message });
        }

        // Parse CSV
        const parseResult = Papa.parse<Record<string, string>>(parsed.csvData, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_'),
        });

        if (parseResult.errors.length > 0) {
          return res.status(400).json({
            message: `CSV parsing error: ${parseResult.errors[0].message}`,
            errors: parseResult.errors.map((e) => e.message),
          });
        }

        const csvRows = parseResult.data;
        if (!csvRows.length) {
          return res.status(400).json({ message: 'CSV must contain at least one data row' });
        }

        // Fetch existing materials for multi-signal identity matching
        const existingMaterials = await db
          .select({
            id: materials.id,
            name: materials.name,
            sku: materials.sku,
            preferredVendorId: materials.preferredVendorId,
            vendorSku: materials.vendorSku,
          })
          .from(materials)
          .where(eq(materials.organizationId, organizationId));

        // Build lookup maps — track duplicates so ambiguous keys are never used for matching
        const existingByNameLower = new Map<string, typeof existingMaterials[0]>();
        const existingBySku = new Map<string, typeof existingMaterials[0]>();
        const skuInDbDuplicates = new Set<string>(); // skus that map to >1 material
        const existingByVendorKey = new Map<string, typeof existingMaterials[0]>();
        const vendorKeyInDbDuplicates = new Set<string>(); // vendor+sku pairs that map to >1 material

        for (const m of existingMaterials) {
          // name map (last-write wins; conflict detection handled at row level)
          existingByNameLower.set(m.name.toLowerCase(), m);

          // sku map
          const skuKey = (m.sku || '').trim().toLowerCase();
          if (skuKey) {
            if (existingBySku.has(skuKey)) {
              skuInDbDuplicates.add(skuKey);
            } else {
              existingBySku.set(skuKey, m);
            }
          }

          // vendor+vendorSku composite key
          if (m.preferredVendorId && m.vendorSku) {
            const vk = `${m.preferredVendorId}::${m.vendorSku.trim().toLowerCase()}`;
            if (existingByVendorKey.has(vk)) {
              vendorKeyInDbDuplicates.add(vk);
            } else {
              existingByVendorKey.set(vk, m);
            }
          }
        }

        // Fetch vendors for name lookup
        const allVendors = await db
          .select({ id: vendors.id, name: vendors.name })
          .from(vendors)
          .where(eq(vendors.organizationId, organizationId));
        const vendorByNameLower = new Map(allVendors.map((v) => [v.name.toLowerCase(), v.id]));

        // Build intra-CSV duplicate maps to detect conflicting rows within the upload itself
        const csvSkuCounts = new Map<string, number>();
        const csvVendorKeyCounts = new Map<string, number>();
        const csvNameCounts = new Map<string, number>();

        for (const row of csvRows) {
          const name = (row['material_name'] || '').trim().toLowerCase();
          if (name) csvNameCounts.set(name, (csvNameCounts.get(name) ?? 0) + 1);

          const sku = (row['sku'] || '').trim().toLowerCase();
          if (sku) csvSkuCounts.set(sku, (csvSkuCounts.get(sku) ?? 0) + 1);

          const vName = (row['vendor_name'] || '').trim().toLowerCase();
          const vSku  = (row['vendor_sku']  || '').trim().toLowerCase();
          if (vName && vSku) {
            const ck = `${vName}::${vSku}`;
            csvVendorKeyCounts.set(ck, (csvVendorKeyCounts.get(ck) ?? 0) + 1);
          }
        }

        // Create batch record in 'uploaded' state
        const userId = getUserId(req.user);
        const [batch] = await db.insert(materialImportBatches).values({
          organizationId,
          status: 'uploaded',
          sourceFilename: parsed.sourceFilename ?? null,
          createdByUserId: userId ?? null,
          totalRows: csvRows.length,
        }).returning();

        // Process each row
        type RowInsert = {
          organizationId: string;
          batchId: string;
          rowNumber: number;
          status: MaterialImportRowStatus;
          action: 'create' | 'update' | 'skip' | undefined;
          existingMaterialId: string | null;
          rawJson: Record<string, string>;
          normalizedJson: Record<string, any>;
          validationErrors: string[];
          matchedBy: 'material_id' | 'sku' | 'vendor_lookup' | 'name' | 'new' | 'conflict' | null;
        };

        const rowInserts: RowInsert[] = [];
        let validCount = 0;
        let invalidCount = 0;
        let conflictCount = 0;

        for (let i = 0; i < csvRows.length; i++) {
          const row = csvRows[i];
          const rowNumber = i + 2; // 1-indexed, row 1 is header
          const normalized = normalizeRow(row);
          const validationErrors = validateNormalizedRow(normalized);

          // Resolve vendor if vendorName is given
          const resolvedVendorId = normalized.vendorName
            ? vendorByNameLower.get(normalized.vendorName.toLowerCase()) ?? null
            : null;

          // Store resolved vendor info in normalizedJson (matchedBy added after resolution below)
          const normalizedJson: Record<string, any> = {
            ...normalized,
            resolvedVendorId,
            vendorWillBeCreated: !!normalized.vendorName && !resolvedVendorId,
          };

          let status: MaterialImportRowStatus = 'pending';
          let action: 'create' | 'update' | 'skip' | undefined;
          let existingMaterialId: string | null = null;
          let matchedBy: RowInsert['matchedBy'] = null;

          if (validationErrors.length > 0) {
            status = 'invalid';
            invalidCount++;
          } else {
            const nameLower    = normalized.name.toLowerCase();
            const skuLower     = (normalized.sku || '').trim().toLowerCase();
            const vNameLower   = (normalized.vendorName || '').trim().toLowerCase();
            const vSkuLower    = (normalized.vendorSku  || '').trim().toLowerCase();

            // ── Intra-CSV duplicate checks ─────────────────────────────────────
            const csvSkuDupe    = skuLower  ? (csvSkuCounts.get(skuLower)!   > 1) : false;
            const csvVendorKey  = (vNameLower && vSkuLower) ? `${vNameLower}::${vSkuLower}` : '';
            const csvVendorDupe = csvVendorKey ? (csvVendorKeyCounts.get(csvVendorKey)! > 1) : false;
            const csvNameDupe   = csvNameCounts.get(nameLower)! > 1;

            if (csvSkuDupe || csvVendorDupe || csvNameDupe) {
              const dupeReasons: string[] = [];
              if (csvSkuDupe)    dupeReasons.push(`duplicate sku "${normalized.sku}" within this CSV`);
              if (csvVendorDupe) dupeReasons.push(`duplicate vendor+vendor_sku "${normalized.vendorName}/${normalized.vendorSku}" within this CSV`);
              if (csvNameDupe)   dupeReasons.push(`duplicate material_name "${normalized.name}" within this CSV`);
              status = 'conflict';
              matchedBy = 'conflict';
              validationErrors.push(...dupeReasons.map((r) => `Conflict: ${r} — each identity key must be unique per upload`));
              conflictCount++;
            } else {
              // ── Four-level priority identity resolution ───────────────────────
              // Level 1: material_id (direct UUID)
              const byId = normalized.materialId
                ? existingMaterials.find((m) => m.id === normalized.materialId) ?? null
                : null;

              // Level 2: sku
              const skuAmbiguous = skuLower ? skuInDbDuplicates.has(skuLower) : false;
              const bySku = (!byId && skuLower && !skuAmbiguous)
                ? existingBySku.get(skuLower) ?? null
                : null;

              // Level 3: vendor name + vendor sku
              const resolvedVendorIdForKey = vNameLower ? vendorByNameLower.get(vNameLower) ?? null : null;
              const vendorDbKey = (resolvedVendorIdForKey && vSkuLower)
                ? `${resolvedVendorIdForKey}::${vSkuLower}` : '';
              const vendorKeyAmbiguous = vendorDbKey ? vendorKeyInDbDuplicates.has(vendorDbKey) : false;
              const byVendorKey = (!byId && !bySku && vendorDbKey && !vendorKeyAmbiguous)
                ? existingByVendorKey.get(vendorDbKey) ?? null
                : null;

              // Level 4: name (weakest fallback)
              const byName = (!byId && !bySku && !byVendorKey)
                ? existingByNameLower.get(nameLower) ?? null
                : null;

              // Pick the first match found
              const primaryMatch = byId ?? bySku ?? byVendorKey ?? byName ?? null;
              let primaryMatchedBy: RowInsert['matchedBy'] = byId
                ? 'material_id'
                : bySku
                ? 'sku'
                : byVendorKey
                ? 'vendor_lookup'
                : byName
                ? 'name'
                : null;

              // ── Cross-signal conflict check ───────────────────────────────────
              // If multiple signals agree on different materials → conflict
              const allSignals = [
                byId       ? { match: byId,       via: 'material_id' as const }   : null,
                bySku      ? { match: bySku,       via: 'sku' as const }           : null,
                byVendorKey? { match: byVendorKey, via: 'vendor_lookup' as const } : null,
                byName     ? { match: byName,      via: 'name' as const }          : null,
              ].filter((s): s is NonNullable<typeof s> => s !== null);

              const uniqueIds = Array.from(new Set(allSignals.map((s) => s.match.id)));
              if (uniqueIds.length > 1) {
                // Two signals point to different existing materials — genuinely ambiguous
                const conflictDesc = allSignals
                  .map((s) => `${s.via} → "${s.match.name}" (${s.match.id.slice(0, 8)}…)`)
                  .join('; ');
                status = 'conflict';
                matchedBy = 'conflict';
                validationErrors.push(`Conflict: identity signals disagree — ${conflictDesc}`);
                conflictCount++;
              } else if (primaryMatch) {
                status = 'valid';
                action = 'update';
                existingMaterialId = primaryMatch.id;
                matchedBy = primaryMatchedBy;
                validCount++;
              } else {
                status = 'valid';
                action = 'create';
                matchedBy = 'new';
                validCount++;
              }
            }
          }

          // Stamp matchedBy into normalizedJson so the frontend can read it without a join
          normalizedJson.matchedBy = matchedBy;

          rowInserts.push({
            organizationId,
            batchId: batch.id,
            rowNumber,
            status,
            action,
            existingMaterialId,
            rawJson: row,
            normalizedJson,
            validationErrors,
            matchedBy,
          });
        }

        // Guard: only insert if we have rows
        if (rowInserts.length > 0) {
          await db.insert(materialImportRows).values(
            rowInserts.map((r) => ({
              organizationId: r.organizationId,
              batchId: r.batchId,
              rowNumber: r.rowNumber,
              status: r.status,
              action: r.action ?? null,
              existingMaterialId: r.existingMaterialId,
              rawJson: r.rawJson,
              normalizedJson: r.normalizedJson,
              validationErrors: r.validationErrors.length > 0 ? r.validationErrors : null,
              matchedBy: r.matchedBy ?? null,
            }))
          );
        }

        // Update batch counts and move to review_ready
        await db
          .update(materialImportBatches)
          .set({
            status: 'review_ready',
            totalRows: csvRows.length,
            validRows: validCount,
            invalidRows: invalidCount,
            conflictRows: conflictCount,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(materialImportBatches.id, batch.id),
              eq(materialImportBatches.organizationId, organizationId)
            )
          );

        return res.status(201).json({
          success: true,
          data: {
            batchId: batch.id,
            totalRows: csvRows.length,
            validRows: validCount,
            invalidRows: invalidCount,
            conflictRows: conflictCount,
          },
          message: `CSV staged: ${validCount} valid, ${invalidCount} invalid, ${conflictCount} conflict rows.`,
        });
      } catch (error) {
        console.error('[MaterialsImport] Error staging import:', error);
        res.status(500).json({ message: 'Failed to stage CSV import' });
      }
    }
  );

  // ── 6. List import batches ───────────────────────────────────────────────
  app.get(
    '/api/admin/data/materials/imports',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const limitParam = parseInt(req.query.limit as string) || 20;
        const limit = Math.min(limitParam, 100);

        const batches = await db
          .select()
          .from(materialImportBatches)
          .where(eq(materialImportBatches.organizationId, organizationId))
          .orderBy(desc(materialImportBatches.createdAt))
          .limit(limit);

        return res.json({ success: true, data: batches });
      } catch (error) {
        console.error('[MaterialsImport] Error listing batches:', error);
        res.status(500).json({ message: 'Failed to list import batches' });
      }
    }
  );

  // ── 7. Get batch detail + rows ───────────────────────────────────────────
  app.get(
    '/api/admin/data/materials/imports/:batchId',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const { batchId } = req.params;

        const [batch] = await db
          .select()
          .from(materialImportBatches)
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!batch) return res.status(404).json({ message: 'Import batch not found' });

        const rows = await db
          .select()
          .from(materialImportRows)
          .where(
            and(
              eq(materialImportRows.batchId, batchId),
              eq(materialImportRows.organizationId, organizationId)
            )
          )
          .orderBy(materialImportRows.rowNumber);

        return res.json({ success: true, data: { batch, rows } });
      } catch (error) {
        console.error('[MaterialsImport] Error fetching batch:', error);
        res.status(500).json({ message: 'Failed to fetch import batch' });
      }
    }
  );

  // ── 8. Commit batch ──────────────────────────────────────────────────────
  app.post(
    '/api/admin/data/materials/imports/:batchId/commit',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

      const { batchId } = req.params;

      // Load batch
      const [batch] = await db
        .select()
        .from(materialImportBatches)
        .where(
          and(
            eq(materialImportBatches.id, batchId),
            eq(materialImportBatches.organizationId, organizationId)
          )
        )
        .limit(1);

      if (!batch) return res.status(404).json({ message: 'Import batch not found' });

      const nonCommittable: MaterialImportBatchStatus[] = ['committed', 'cancelled', 'failed'];
      if (nonCommittable.includes(batch.status)) {
        return res.status(409).json({
          message: `Batch is already in '${batch.status}' state and cannot be committed`,
        });
      }

      // Load rows — only process valid/ready_to_apply; skip invalid/conflict/skipped
      const allRows = await db
        .select()
        .from(materialImportRows)
        .where(
          and(
            eq(materialImportRows.batchId, batchId),
            eq(materialImportRows.organizationId, organizationId)
          )
        );

      // Block commit if any invalid or conflict rows remain (not yet skipped)
      const blockingRows = allRows.filter(
        (r) => r.status === 'invalid' || r.status === 'conflict'
      );
      if (blockingRows.length > 0) {
        return res.status(422).json({
          message: `Cannot commit: ${blockingRows.length} row(s) are invalid or have conflicts. Skip them first or re-upload with corrections.`,
          blockingCount: blockingRows.length,
        });
      }

      const rowsToApply = allRows.filter(
        (r) => r.status === 'valid' || r.status === 'ready_to_apply'
      );

      if (rowsToApply.length === 0) {
        return res.status(422).json({ message: 'No valid rows to commit' });
      }

      const userId = getUserId(req.user);
      let created = 0;
      let updated = 0;
      let commitErrors: Array<{ rowNumber: number; error: string }> = [];

      try {
        await db.transaction(async (tx) => {
          // Fetch existing vendors (for name→id creation during commit)
          const allVendors = await tx
            .select({ id: vendors.id, name: vendors.name })
            .from(vendors)
            .where(eq(vendors.organizationId, organizationId));
          const vendorByNameLower = new Map(allVendors.map((v) => [v.name.toLowerCase(), v.id]));

          const appliedRowIds: string[] = [];
          const commitErrorsInner: typeof commitErrors = [];

          for (const r of rowsToApply) {
            const n = r.normalizedJson as ReturnType<typeof normalizeRow> & {
              resolvedVendorId?: string | null;
              vendorWillBeCreated?: boolean;
            };

            try {
              // Resolve or create vendor
              let vendorId: string | null = n.resolvedVendorId ?? null;
              if (!vendorId && n.vendorName && n.vendorWillBeCreated) {
                // Create the vendor inside the transaction
                const [newVendor] = await tx
                  .insert(vendors)
                  .values({
                    organizationId,
                    name: n.vendorName,
                    isActive: true,
                  })
                  .returning({ id: vendors.id });
                vendorId = newVendor.id;
                // Cache so later rows with same vendor name reuse
                vendorByNameLower.set(n.vendorName.toLowerCase(), vendorId);
              } else if (!vendorId && n.vendorName) {
                // Re-check in case it was just created in this loop
                vendorId = vendorByNameLower.get(n.vendorName.toLowerCase()) ?? null;
              }

              const payload = buildMaterialPayload(n, vendorId);

              if (r.action === 'update' && r.existingMaterialId) {
                await tx
                  .update(materials)
                  .set({ ...payload, updatedAt: new Date() })
                  .where(
                    and(
                      eq(materials.id, r.existingMaterialId),
                      eq(materials.organizationId, organizationId)
                    )
                  );
                updated++;
              } else if (r.action === 'create') {
                await tx.insert(materials).values({
                  ...payload,
                  organizationId,
                } as any);
                created++;
              }

              appliedRowIds.push(r.id);
            } catch (rowErr: any) {
              commitErrorsInner.push({
                rowNumber: r.rowNumber,
                error: rowErr?.message ?? 'Unknown error',
              });
            }
          }

          // If any row failed, roll back the whole transaction
          if (commitErrorsInner.length > 0) {
            commitErrors = commitErrorsInner;
            throw new Error('Commit aborted due to row errors — transaction will be rolled back');
          }

          // Mark applied rows
          if (appliedRowIds.length > 0) {
            await tx
              .update(materialImportRows)
              .set({ status: 'applied' })
              .where(
                and(
                  inArray(materialImportRows.id, appliedRowIds),
                  eq(materialImportRows.organizationId, organizationId)
                )
              );
          }

          // Mark skipped rows
          const skippedIds = allRows
            .filter((r) => r.status === 'skipped')
            .map((r) => r.id);
          // (already marked skipped by /skip endpoint — nothing to do here)

          // Mark batch committed
          await tx
            .update(materialImportBatches)
            .set({
              status: 'committed',
              summaryJson: { created, updated, total: appliedRowIds.length },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(materialImportBatches.id, batchId),
                eq(materialImportBatches.organizationId, organizationId)
              )
            );

          // Audit log
          await tx.insert(auditLogs).values({
            organizationId,
            userId: userId ?? null,
            actionType: 'IMPORT',
            entityType: 'material',
            entityId: batchId,
            entityName: batch.sourceFilename ?? `batch-${batchId.slice(0, 8)}`,
            description: `Materials CSV import committed: ${created} created, ${updated} updated`,
            newValues: { batchId, created, updated, sourceFilename: batch.sourceFilename },
          } as any);
        });

        return res.json({
          success: true,
          data: { created, updated, total: created + updated },
          message: `Commit complete: ${created} created, ${updated} updated`,
        });
      } catch (txErr: any) {
        // Mark batch failed
        await db
          .update(materialImportBatches)
          .set({
            status: 'failed',
            errorMessage: txErr?.message ?? 'Transaction failed',
            summaryJson: { commitErrors },
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          );

        return res.status(500).json({
          success: false,
          message: 'Commit failed — no permanent changes were made',
          errors: commitErrors,
        });
      }
    }
  );

  // ── 9. Cancel batch ──────────────────────────────────────────────────────
  app.post(
    '/api/admin/data/materials/imports/:batchId/cancel',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const { batchId } = req.params;

        const [batch] = await db
          .select()
          .from(materialImportBatches)
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!batch) return res.status(404).json({ message: 'Import batch not found' });
        if (batch.status === 'committed') {
          return res.status(409).json({ message: 'Committed batches cannot be cancelled' });
        }
        if (batch.status === 'cancelled') {
          return res.json({ success: true, message: 'Batch was already cancelled' });
        }

        await db
          .update(materialImportBatches)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          );

        return res.json({ success: true, message: 'Import batch cancelled' });
      } catch (error) {
        console.error('[MaterialsImport] Error cancelling batch:', error);
        res.status(500).json({ message: 'Failed to cancel import batch' });
      }
    }
  );

  // ── 10. Skip invalid rows in a batch ────────────────────────────────────
  // Marks all invalid/conflict rows as skipped so the commit can proceed.
  app.post(
    '/api/admin/data/materials/imports/:batchId/skip-invalid',
    isAuthenticated,
    tenantContext,
    isAdmin,
    async (req: any, res) => {
      try {
        const organizationId = getRequestOrganizationId(req);
        if (!organizationId) return res.status(500).json({ message: 'Missing organization context' });

        const { batchId } = req.params;

        const [batch] = await db
          .select()
          .from(materialImportBatches)
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          )
          .limit(1);

        if (!batch) return res.status(404).json({ message: 'Import batch not found' });
        if (batch.status === 'committed' || batch.status === 'cancelled') {
          return res.status(409).json({ message: `Batch is ${batch.status} and rows cannot be modified` });
        }

        // Fetch invalid and conflict rows separately to avoid empty-IN issues
        const invalidRows = await db
          .select({ id: materialImportRows.id })
          .from(materialImportRows)
          .where(
            and(
              eq(materialImportRows.batchId, batchId),
              eq(materialImportRows.organizationId, organizationId),
              eq(materialImportRows.status, 'invalid')
            )
          );

        const conflictRows = await db
          .select({ id: materialImportRows.id })
          .from(materialImportRows)
          .where(
            and(
              eq(materialImportRows.batchId, batchId),
              eq(materialImportRows.organizationId, organizationId),
              eq(materialImportRows.status, 'conflict')
            )
          );

        const idsToSkip = [
          ...invalidRows.map((r) => r.id),
          ...conflictRows.map((r) => r.id),
        ];

        if (idsToSkip.length > 0) {
          await db
            .update(materialImportRows)
            .set({ status: 'skipped' })
            .where(inArray(materialImportRows.id, idsToSkip));
        }

        // Update batch counts
        const skippedCount = idsToSkip.length;
        await db
          .update(materialImportBatches)
          .set({
            invalidRows: 0,
            conflictRows: 0,
            skippedRows: batch.skippedRows + skippedCount,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(materialImportBatches.id, batchId),
              eq(materialImportBatches.organizationId, organizationId)
            )
          );

        return res.json({
          success: true,
          skippedCount,
          message: `${skippedCount} row(s) marked as skipped`,
        });
      } catch (error) {
        console.error('[MaterialsImport] Error skipping rows:', error);
        res.status(500).json({ message: 'Failed to skip rows' });
      }
    }
  );
}
