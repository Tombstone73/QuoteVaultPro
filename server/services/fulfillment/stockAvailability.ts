import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { FulfillmentStockAvailability } from "@shared/fulfillmentReadiness";
import { normalizeMaterialUnit } from "@shared/materialUnits";
import { inventoryReservations, materials, orderLineItems, orderMaterialUsage, products, shipmentItems, shipments } from "@shared/schema";
import type { db } from "../../db";
import { InventoryRepository } from "../../storage/inventory.repo";
import { FulfillmentHttpError } from "./types";

type Reader = Pick<typeof db, "select">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StockCandidate = { id: string; materialId: string | null };
export type StockAvailability = FulfillmentStockAvailability & { materialId: string | null; readyCapacity: number | null };

export const configuredStockMaterial = sql<string | null>`coalesce(${orderLineItems.materialId}, ${products.primaryMaterialId})`;

/** A draft's real allocations hold stock across orders sharing the same Material.
 * Use the same inventory pool for readback, draft edits and terminal handoffs. */
export async function readStockAvailability(
  tx: Reader, organizationId: string, candidates: StockCandidate[],
  options: { excludeShipmentId?: string; lockStock?: boolean } = {},
): Promise<Map<string, StockAvailability>> {
  const result = new Map<string, StockAvailability>();
  for (const { id, materialId } of candidates) {
    result.set(id, { materialId, status: materialId ? "reconcile" : "untracked", availableQuantity: null,
      readyCapacity: materialId ? 0 : null });
  }
  const materialIds = [...new Set(candidates.flatMap(line => line.materialId ? [line.materialId] : []))].sort();
  if (!materialIds.length) return result;
  const materialQuery = tx.select().from(materials).where(and(
    eq(materials.organizationId, organizationId), inArray(materials.id, materialIds),
  )).orderBy(materials.id);
  const materialRows = await (options.lockStock ? materialQuery.for("update") : materialQuery);
  const eachMaterials = materialRows.filter(material => material.materialForm === "each" &&
    normalizeMaterialUnit(material.inventoryUnit) === "each" && normalizeMaterialUnit(material.consumptionUnit) === "each");
  if (!eachMaterials.length) return result;
  const eachIds = eachMaterials.map(material => material.id);
  const skus = eachMaterials.flatMap(material => material.sku ? [material.sku] : []);
  const draftMaterial = sql<string>`coalesce(${shipmentItems.stockMaterialId}, ${configuredStockMaterial})`;
  const [reservations, drafts, priorUsage] = await Promise.all([
    tx.select({ key: inventoryReservations.sourceKey, source: inventoryReservations.sourceType, uom: inventoryReservations.uom,
      quantity: inventoryReservations.qty }).from(inventoryReservations).where(and(
        eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.status, "RESERVED"),
        or(and(eq(inventoryReservations.sourceType, "PBV2_MATERIAL"), inArray(inventoryReservations.sourceKey, [...eachIds, ...skus])),
          skus.length ? and(eq(inventoryReservations.sourceType, "MANUAL"), inArray(inventoryReservations.sourceKey, skus)) : undefined),
      )),
    tx.select({ materialId: draftMaterial, lineId: shipmentItems.orderLineItemId,
      quantity: sql<number>`sum(${shipmentItems.quantity})::int` }).from(shipmentItems)
      .innerJoin(shipments, eq(shipments.id, shipmentItems.shipmentId))
      .innerJoin(orderLineItems, eq(orderLineItems.id, shipmentItems.orderLineItemId))
      .innerJoin(products, eq(products.id, orderLineItems.productId)).where(and(
        eq(shipmentItems.organizationId, organizationId), eq(shipments.organizationId, organizationId),
        eq(products.organizationId, organizationId), eq(shipments.status, "DRAFT"),
        options.excludeShipmentId ? ne(shipments.id, options.excludeShipmentId) : undefined,
        or(inArray(shipmentItems.stockMaterialId, eachIds), and(isNull(shipmentItems.stockMaterialId),
          inArray(configuredStockMaterial, eachIds), ne(products.workflowIntent, "service_fee"),
          or(eq(products.workflowIntent, "fulfillment_only"), eq(products.requiresProductionJob, false), eq(orderLineItems.productionBypassed, true)))),
      )).groupBy(draftMaterial, shipmentItems.orderLineItemId),
    // Old orders can already have a Materials usage record from the legacy
    // production deduction path. Its presence is insufficient proof of how much
    // stock was deducted, so do not consume the same units a second time.
    tx.select({ lineId: orderMaterialUsage.orderLineItemId, materialId: orderMaterialUsage.materialId })
      .from(orderMaterialUsage).where(and(inArray(orderMaterialUsage.materialId, eachIds),
        inArray(orderMaterialUsage.orderLineItemId, candidates.map(line => line.id)))),
  ]);
  const bySku = new Map(eachMaterials.map(material => [material.sku, material.id]));
  const eachById = new Map(eachMaterials.map(material => [material.id, material]));
  const reserved = new Map<string, number>();
  const unsafe = new Set<string>();
  for (const row of reservations) {
    const materialId = row.source === "MANUAL" || !eachById.has(row.key) ? bySku.get(row.key) : row.key;
    if (!materialId) continue;
    if (normalizeMaterialUnit(row.uom) !== "each") unsafe.add(materialId);
    reserved.set(materialId, (reserved.get(materialId) ?? 0) + Number(row.quantity));
  }
  const draftTotals = new Map<string, number>();
  const draftLines = new Map<string, number>();
  for (const row of drafts) {
    draftTotals.set(row.materialId, (draftTotals.get(row.materialId) ?? 0) + Number(row.quantity));
    draftLines.set(`${row.materialId}:${row.lineId}`, Number(row.quantity));
  }
  const legacyUsage = new Set(priorUsage.map(row => `${row.materialId}:${row.lineId}`));
  for (const { id, materialId } of candidates) {
    const material = materialId ? eachById.get(materialId) : null;
    if (!materialId || !material || unsafe.has(materialId) || legacyUsage.has(`${materialId}:${id}`)) continue;
    const free = Math.floor(Number(material.stockQuantity) - (reserved.get(materialId) ?? 0) - (draftTotals.get(materialId) ?? 0));
    result.set(id, { materialId, status: "tracked", availableQuantity: Math.max(0, free),
      readyCapacity: Math.max(0, free + (draftLines.get(`${materialId}:${id}`) ?? 0)) });
  }
  return result;
}

export function stockAllocationFits(lines: Iterable<{ stock?: StockAvailability } & { quantity: number }>): boolean {
  const balances = new Map<string, number>();
  for (const { stock, quantity } of lines) {
    if (stock?.status !== "tracked" || !stock.materialId) continue;
    const balance = (balances.get(stock.materialId) ?? stock.availableQuantity ?? 0) - quantity;
    if (balance < 0) return false;
    balances.set(stock.materialId, balance);
  }
  return true;
}

export async function moveFulfillmentStock(
  tx: Transaction, organizationId: string, userId: string | null,
  items: Array<{ materialId: string; orderId: string; quantity: number }>, reason: string,
) {
  if (!items.length) return;
  if (!userId) throw new FulfillmentHttpError(403, "An identified staff member is required to move tracked stock.", "STOCK_ACTOR_REQUIRED");
  const inventory = new InventoryRepository();
  for (const item of [...items].sort((a, b) => a.materialId.localeCompare(b.materialId))) {
    await inventory.recordFulfillmentStockMovement(tx, { organizationId, userId, reason,
      orderId: item.orderId, materialId: item.materialId, quantityDelta: item.quantity });
  }
}
