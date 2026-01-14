import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  inventoryReservations,
  materials,
  users,
  type InventoryReservation,
} from "@shared/schema";

export type ManualReservationRow = {
  id: string;
  organizationId: string;
  orderId: string;
  orderLineItemId: string | null;
  sourceType: "MANUAL";
  sourceKey: string;
  uom: string;
  qty: string;
  status: "RESERVED" | "RELEASED";
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;

  materialName: string | null;

  createdByName: string | null;
  createdByEmail: string | null;
};

function normalizeQty2dp(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(2);
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2);
}

function addQty2dp(a: unknown, b: unknown): string {
  const n1 = Number(normalizeQty2dp(a));
  const n2 = Number(normalizeQty2dp(b));
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return (0).toFixed(2);
  return normalizeQty2dp(n1 + n2);
}

export async function listManualReservationsForOrder(
  db: PostgresJsDatabase<Record<string, never>>,
  args: { organizationId: string; orderId: string },
): Promise<ManualReservationRow[]> {
  const rows = await db
    .select({
      id: inventoryReservations.id,
      organizationId: inventoryReservations.organizationId,
      orderId: inventoryReservations.orderId,
      orderLineItemId: inventoryReservations.orderLineItemId,
      sourceType: inventoryReservations.sourceType,
      sourceKey: inventoryReservations.sourceKey,
      uom: inventoryReservations.uom,
      qty: inventoryReservations.qty,
      status: inventoryReservations.status,
      createdByUserId: inventoryReservations.createdByUserId,
      createdAt: inventoryReservations.createdAt,
      updatedAt: inventoryReservations.updatedAt,

      materialName: materials.name,

      createdByFirstName: users.firstName,
      createdByLastName: users.lastName,
      createdByEmail: users.email,
    })
    .from(inventoryReservations)
    .leftJoin(
      materials,
      and(
        eq(materials.organizationId, inventoryReservations.organizationId),
        eq(materials.sku, inventoryReservations.sourceKey),
      ),
    )
    .leftJoin(users, eq(users.id, inventoryReservations.createdByUserId))
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.sourceType, "MANUAL"),
      ),
    );

  return (rows as any[]).map((r) => {
    const first = typeof r.createdByFirstName === "string" ? r.createdByFirstName.trim() : "";
    const last = typeof r.createdByLastName === "string" ? r.createdByLastName.trim() : "";
    const createdByName = [first, last].filter(Boolean).join(" ") || null;

    const { createdByFirstName: _f, createdByLastName: _l, ...rest } = r;
    return {
      ...rest,
      sourceType: "MANUAL" as const,
      qty: normalizeQty2dp(r.qty),
      createdByName,
    };
  });
}

export async function createManualReservation(
  db: PostgresJsDatabase<Record<string, never>>,
  args: {
    organizationId: string;
    orderId: string;
    sourceKey: string;
    uom: string;
    qty: number;
    createdByUserId: string | null;
  },
): Promise<InventoryReservation> {
  const now = new Date();
  const incomingQty = normalizeQty2dp(args.qty);

  const existing = await db
    .select({ id: inventoryReservations.id, qty: inventoryReservations.qty })
    .from(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.sourceType, "MANUAL"),
        eq(inventoryReservations.status, "RESERVED"),
        eq(inventoryReservations.sourceKey, args.sourceKey),
        eq(inventoryReservations.uom, args.uom),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const nextQty = addQty2dp(existing[0].qty, incomingQty);
    const updated = await db
      .update(inventoryReservations)
      .set({ qty: nextQty, updatedAt: now } as any)
      .where(
        and(
          eq(inventoryReservations.organizationId, args.organizationId),
          eq(inventoryReservations.orderId, args.orderId),
          eq(inventoryReservations.id, existing[0].id),
          eq(inventoryReservations.sourceType, "MANUAL"),
          eq(inventoryReservations.status, "RESERVED"),
        ),
      )
      .returning();

    return updated[0] as any;
  }

  const inserted = await db
    .insert(inventoryReservations)
    .values({
      organizationId: args.organizationId,
      orderId: args.orderId,
      orderLineItemId: null,
      sourceType: "MANUAL",
      sourceKey: args.sourceKey,
      uom: args.uom,
      qty: incomingQty,
      status: "RESERVED",
      createdByUserId: args.createdByUserId,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();

  return inserted[0] as any;
}

export async function getManualReservationById(
  db: PostgresJsDatabase<Record<string, never>>,
  args: { organizationId: string; orderId: string; reservationId: string },
): Promise<ManualReservationRow | null> {
  const rows = await db
    .select({
      id: inventoryReservations.id,
      organizationId: inventoryReservations.organizationId,
      orderId: inventoryReservations.orderId,
      orderLineItemId: inventoryReservations.orderLineItemId,
      sourceType: inventoryReservations.sourceType,
      sourceKey: inventoryReservations.sourceKey,
      uom: inventoryReservations.uom,
      qty: inventoryReservations.qty,
      status: inventoryReservations.status,
      createdByUserId: inventoryReservations.createdByUserId,
      createdAt: inventoryReservations.createdAt,
      updatedAt: inventoryReservations.updatedAt,

      materialName: materials.name,

      createdByFirstName: users.firstName,
      createdByLastName: users.lastName,
      createdByEmail: users.email,
    })
    .from(inventoryReservations)
    .leftJoin(
      materials,
      and(
        eq(materials.organizationId, inventoryReservations.organizationId),
        eq(materials.sku, inventoryReservations.sourceKey),
      ),
    )
    .leftJoin(users, eq(users.id, inventoryReservations.createdByUserId))
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.id, args.reservationId),
        eq(inventoryReservations.sourceType, "MANUAL"),
      ),
    )
    .limit(1);

  const row = rows[0] as any;
  if (!row) return null;

  const first = typeof row.createdByFirstName === "string" ? row.createdByFirstName.trim() : "";
  const last = typeof row.createdByLastName === "string" ? row.createdByLastName.trim() : "";
  const createdByName = [first, last].filter(Boolean).join(" ") || null;

  const { createdByFirstName: _f, createdByLastName: _l, ...rest } = row;
  return {
    ...rest,
    sourceType: "MANUAL" as const,
    qty: normalizeQty2dp(row.qty),
    createdByName,
  };
}

export async function deleteManualReservation(
  db: PostgresJsDatabase<Record<string, never>>,
  args: { organizationId: string; orderId: string; reservationId: string },
): Promise<number> {
  const deleted = await db
    .delete(inventoryReservations)
    .where(
      and(
        eq(inventoryReservations.organizationId, args.organizationId),
        eq(inventoryReservations.orderId, args.orderId),
        eq(inventoryReservations.id, args.reservationId),
        eq(inventoryReservations.sourceType, "MANUAL"),
      ),
    )
    .returning({ id: inventoryReservations.id });

  return deleted.length;
}
