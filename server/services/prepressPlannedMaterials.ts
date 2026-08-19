/**
 * Prepress remains the V1 consumer, but the PBV2 choice inventory-consumption
 * semantics are shared with V2's immutable Order requirement resolver.
 */
export {
  computePlannedMaterialsForLineItem,
  type PlannedMaterial,
  type PlannedMaterialsResult,
} from "@shared/pbv2/inventoryConsumption";
