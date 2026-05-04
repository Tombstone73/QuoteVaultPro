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
import { parseBool, parseNum } from "../utils/csvImportUtils";

// ─── Template column map ───────────────────────────────────────────────────
// CSV column name → schema field path (used for template + export)

const TEMPLATE_COLUMNS = [
  "material_id",        // optional — present in export, used to identify updates
  "material_name",      // required → materials.name
  "sku",                // required → materials.sku
  "material_type",      // required → materials.type (sheet|roll|ink|consumable)
  "unit_of_measure",    // required → materials.unitOfMeasure (sheet|sqft|linear_ft|ml|ea)
  "category",           // → materials.category
  "color",              // → materials.color
  "width",              // → materials.width (sheet width or roll width)
  "height",             // → materials.height (sheet only)
  "thickness",          // → materials.thickness
  "thickness_unit",     // → materials.thicknessUnit (in|mm|mil|gauge)
  "cost_per_unit",      // → materials.costPerUnit
  "wholesale_base_rate",// → materials.wholesaleBaseRate
  "wholesale_min_charge",// → materials.wholesaleMinCharge
  "retail_base_rate",   // → materials.retailBaseRate
  "retail_min_charge",  // → materials.retailMinCharge
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
] as const;

// A sample row for the template so users see the expected format
const TEMPLATE_EXAMPLE_ROW: Record<string, string> = {
  material_id:            "",
  material_name:          "3M Premium Gloss White Vinyl",
  sku:                    "VNL-3M-PGW-54",
  material_type:          "roll",
  unit_of_measure:        "sqft",
  category:               "Vinyl",
  color:                  "White",
  width:                  "54",
  height:                 "",
  thickness:              "3",
  thickness_unit:         "mil",
  cost_per_unit:          "0.45",
  wholesale_base_rate:    "",
  wholesale_min_charge:   "",
  retail_base_rate:       "",
  retail_min_charge:      "",
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
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

/** Normalise a single CSV row into a validated materials payload + metadata */
function normalizeRow(row: Record<string, string>): {
  name: string;
  sku: string;
  type: string;
  unitOfMeasure: string;
  category: string | undefined;
  color: string | undefined;
  width: number | undefined;
  height: number | undefined;
  thickness: number | undefined;
  thicknessUnit: string | undefined;
  costPerUnit: number | undefined;
  wholesaleBaseRate: number | undefined;
  wholesaleMinCharge: number | undefined;
  retailBaseRate: number | undefined;
  retailMinCharge: number | undefined;
  stockQuantity: number | undefined;
  minStockAlert: number | undefined;
  vendorSku: string | undefined;
  vendorCostPerUnit: number | undefined;
  rollLengthFt: number | undefined;
  costPerRoll: number | undefined;
  edgeWasteInPerSide: number | undefined;
  leadWasteFt: number | undefined;
  tailWasteFt: number | undefined;
  isActive: boolean | undefined;
  // metadata (not in materials table)
  materialId: string | undefined;
  vendorName: string | undefined;
} {
  return {
    name:             (row['material_name'] || '').trim(),
    sku:              (row['sku'] || '').trim(),
    type:             (row['material_type'] || '').trim().toLowerCase(),
    unitOfMeasure:    (row['unit_of_measure'] || '').trim().toLowerCase(),
    category:         (row['category'] || '').trim() || undefined,
    color:            (row['color'] || '').trim() || undefined,
    width:            parseNum(row['width']),
    height:           parseNum(row['height']),
    thickness:        parseNum(row['thickness']),
    thicknessUnit:    (row['thickness_unit'] || '').trim().toLowerCase() || undefined,
    costPerUnit:      parseNum(row['cost_per_unit']),
    wholesaleBaseRate: parseNum(row['wholesale_base_rate']),
    wholesaleMinCharge: parseNum(row['wholesale_min_charge']),
    retailBaseRate:   parseNum(row['retail_base_rate']),
    retailMinCharge:  parseNum(row['retail_min_charge']),
    stockQuantity:    parseNum(row['stock_quantity']),
    minStockAlert:    parseNum(row['reorder_point']),
    vendorSku:        (row['vendor_sku'] || '').trim() || undefined,
    vendorCostPerUnit: parseNum(row['vendor_cost_per_unit']),
    rollLengthFt:     parseNum(row['roll_length_ft']),
    costPerRoll:      parseNum(row['cost_per_roll']),
    edgeWasteInPerSide: parseNum(row['edge_waste_in_per_side']),
    leadWasteFt:      parseNum(row['lead_waste_ft']),
    tailWasteFt:      parseNum(row['tail_waste_ft']),
    isActive:         parseBool(row['active']) ?? true,
    // metadata
    materialId:       (row['material_id'] || '').trim() || undefined,
    vendorName:       (row['vendor_name'] || '').trim() || undefined,
  };
}

const VALID_TYPES: string[] = ['sheet', 'roll', 'ink', 'consumable'];
const VALID_UNITS: string[] = ['sheet', 'sqft', 'linear_ft', 'ml', 'ea'];
const VALID_THICKNESS_UNITS: string[] = ['in', 'mm', 'mil', 'gauge'];

function validateNormalizedRow(n: ReturnType<typeof normalizeRow>): string[] {
  const errors: string[] = [];

  if (!n.name) errors.push('material_name is required');
  if (!n.sku) errors.push('sku is required');
  if (!n.type) {
    errors.push('material_type is required');
  } else if (!VALID_TYPES.includes(n.type)) {
    errors.push(`material_type must be one of: ${VALID_TYPES.join(', ')} (got "${n.type}")`);
  }
  if (!n.unitOfMeasure) {
    errors.push('unit_of_measure is required');
  } else if (!VALID_UNITS.includes(n.unitOfMeasure)) {
    errors.push(`unit_of_measure must be one of: ${VALID_UNITS.join(', ')} (got "${n.unitOfMeasure}")`);
  }
  if (n.costPerUnit == null) {
    errors.push('cost_per_unit is required');
  } else if (n.costPerUnit < 0) {
    errors.push('cost_per_unit must be >= 0');
  }
  if (n.thicknessUnit && !VALID_THICKNESS_UNITS.includes(n.thicknessUnit)) {
    errors.push(`thickness_unit must be one of: ${VALID_THICKNESS_UNITS.join(', ')}`);
  }
  if (n.type === 'roll' && n.width == null) {
    errors.push('width (roll_width) is required for roll materials');
  }
  if (n.type === 'sheet' && (n.width == null || n.height == null)) {
    // Only warn, not hard block — some sheet materials may not have dimensions
  }
  if (n.wholesaleBaseRate != null && n.wholesaleBaseRate < 0) {
    errors.push('wholesale_base_rate must be >= 0');
  }
  if (n.retailBaseRate != null && n.retailBaseRate < 0) {
    errors.push('retail_base_rate must be >= 0');
  }
  if (n.stockQuantity != null && n.stockQuantity < 0) {
    errors.push('stock_quantity must be >= 0');
  }
  if (n.rollLengthFt != null && n.rollLengthFt <= 0) {
    errors.push('roll_length_ft must be > 0');
  }

  return errors;
}

// Build the DB insert/update payload from a normalized row + resolved vendor ID
function buildMaterialPayload(
  n: ReturnType<typeof normalizeRow>,
  resolvedVendorId: string | null
): Record<string, any> {
  return {
    name: n.name,
    sku: n.sku,
    type: n.type,
    unitOfMeasure: n.unitOfMeasure,
    category: n.category ?? null,
    color: n.color ?? null,
    width: n.width ?? null,
    height: n.height ?? null,
    thickness: n.thickness ?? null,
    thicknessUnit: n.thicknessUnit ?? null,
    costPerUnit: String(n.costPerUnit!),
    wholesaleBaseRate: n.wholesaleBaseRate != null ? String(n.wholesaleBaseRate) : null,
    wholesaleMinCharge: n.wholesaleMinCharge != null ? String(n.wholesaleMinCharge) : null,
    retailBaseRate: n.retailBaseRate != null ? String(n.retailBaseRate) : null,
    retailMinCharge: n.retailMinCharge != null ? String(n.retailMinCharge) : null,
    stockQuantity: n.stockQuantity != null ? String(n.stockQuantity) : "0",
    minStockAlert: n.minStockAlert != null ? String(n.minStockAlert) : "0",
    isActive: n.isActive ?? true,
    preferredVendorId: resolvedVendorId,
    vendorSku: n.vendorSku ?? null,
    vendorCostPerUnit: n.vendorCostPerUnit != null ? String(n.vendorCostPerUnit) : null,
    rollLengthFt: n.rollLengthFt != null ? String(n.rollLengthFt) : null,
    costPerRoll: n.costPerRoll != null ? String(n.costPerRoll) : null,
    edgeWasteInPerSide: n.edgeWasteInPerSide != null ? String(n.edgeWasteInPerSide) : null,
    leadWasteFt: n.leadWasteFt != null ? String(n.leadWasteFt) : "0",
    tailWasteFt: n.tailWasteFt != null ? String(n.tailWasteFt) : "0",
  };
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

  // ── 2. Export current materials as CSV ───────────────────────────────────
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
          material_type:          m.type,
          unit_of_measure:        m.unitOfMeasure,
          category:               m.category ?? '',
          color:                  m.color ?? '',
          width:                  m.width ?? '',
          height:                 m.height ?? '',
          thickness:              m.thickness ?? '',
          thickness_unit:         m.thicknessUnit ?? '',
          cost_per_unit:          m.costPerUnit,
          wholesale_base_rate:    m.wholesaleBaseRate ?? '',
          wholesale_min_charge:   m.wholesaleMinCharge ?? '',
          retail_base_rate:       m.retailBaseRate ?? '',
          retail_min_charge:      m.retailMinCharge ?? '',
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

  // ── 3. Upload + stage CSV ────────────────────────────────────────────────
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

  // ── 4. List import batches ───────────────────────────────────────────────
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

  // ── 5. Get batch detail + rows ───────────────────────────────────────────
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

  // ── 6. Commit batch ──────────────────────────────────────────────────────
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

  // ── 7. Cancel batch ──────────────────────────────────────────────────────
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

  // ── 8. Skip invalid rows in a batch ─────────────────────────────────────
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
