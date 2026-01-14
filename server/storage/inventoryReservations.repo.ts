import { db } from "../db";
import { inventoryReservations, materials, users } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

function normalizeDecimal2(value: number): string {
  if (!Number.isFinite(value)) return (0).toFixed(2);
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2);
}

export type ManualReservationRow = {
  id: string;
  organizationId: string;
  orderId: string;
  orderLineItemId: string | null;
  sourceType: string;
  sourceKey: string;
  uom: string;
  qty: string;
  status: string;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ManualReservationView = {
  id: string;
  orderId: string;
  material: {
    id: string;
    name: string;
    sku: string;
    unitOfMeasure: string;
  } | null;
  uom: string;
  qty: string;
  status: string;
  createdAt: string;
  createdBy: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
  } | null;
};

function buildUserDisplayName(user: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  id: string;
}): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (user.email) return user.email;
  return user.id;
}

export class InventoryReservationsRepository {
  constructor(private readonly dbInstance = db) {}

  async createManualReservationForOrder(args: {
    organizationId: string;
    orderId: string;
    materialId: string;
    quantity: number;
    createdByUserId: string | null;
  }): Promise<ManualReservationView> {
    const { organizationId, orderId, materialId, quantity, createdByUserId } = args;

    const [material] = await this.dbInstance
      .select({
        id: materials.id,
        name: materials.name,
        sku: materials.sku,
        unitOfMeasure: materials.unitOfMeasure,
      })
      .from(materials)
      .where(and(eq(materials.organizationId, organizationId), eq(materials.id, materialId)))
      .limit(1);

    if (!material) {
      const err: any = new Error("Material not found");
      err.statusCode = 404;
      throw err;
    }

    const qty = normalizeDecimal2(quantity);

    const [created] = await this.dbInstance
      .insert(inventoryReservations)
      .values({
        organizationId,
        orderId,
        orderLineItemId: null,
        sourceType: "MANUAL",
        sourceKey: material.sku,
        uom: material.unitOfMeasure,
        qty,
        status: "RESERVED",
        createdByUserId,
      } as any)
      .returning();

    const [enriched] = await this.dbInstance
      .select({
        reservation: {
          id: inventoryReservations.id,
          orderId: inventoryReservations.orderId,
          sourceKey: inventoryReservations.sourceKey,
          uom: inventoryReservations.uom,
          qty: inventoryReservations.qty,
          status: inventoryReservations.status,
          createdAt: inventoryReservations.createdAt,
          createdByUserId: inventoryReservations.createdByUserId,
        },
        material: {
          id: materials.id,
          name: materials.name,
          sku: materials.sku,
          unitOfMeasure: materials.unitOfMeasure,
        },
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(inventoryReservations)
      .leftJoin(
        materials,
        and(eq(materials.organizationId, organizationId), eq(materials.sku, inventoryReservations.sourceKey)),
      )
      .leftJoin(users, eq(users.id, inventoryReservations.createdByUserId))
      .where(and(eq(inventoryReservations.organizationId, organizationId), eq(inventoryReservations.id, created.id)))
      .limit(1);

    const createdAt = enriched?.reservation?.createdAt
      ? new Date(enriched.reservation.createdAt as any).toISOString()
      : new Date().toISOString();

    return {
      id: String(enriched?.reservation?.id ?? created.id),
      orderId: String(enriched?.reservation?.orderId ?? orderId),
      material: enriched?.material?.id
        ? {
            id: String(enriched.material.id),
            name: String(enriched.material.name),
            sku: String(enriched.material.sku),
            unitOfMeasure: String(enriched.material.unitOfMeasure),
          }
        : material
        ? {
            id: String(material.id),
            name: String(material.name),
            sku: String(material.sku),
            unitOfMeasure: String(material.unitOfMeasure),
          }
        : null,
      uom: String(enriched?.reservation?.uom ?? material.unitOfMeasure),
      qty: String(enriched?.reservation?.qty ?? qty),
      status: String(enriched?.reservation?.status ?? "RESERVED"),
      createdAt,
      createdBy:
        enriched?.user?.id
          ? {
              id: String(enriched.user.id),
              email: enriched.user.email ?? null,
              firstName: enriched.user.firstName ?? null,
              lastName: enriched.user.lastName ?? null,
              displayName: buildUserDisplayName({
                id: String(enriched.user.id),
                email: enriched.user.email ?? null,
                firstName: enriched.user.firstName ?? null,
                lastName: enriched.user.lastName ?? null,
              }),
            }
          : createdByUserId
          ? {
              id: createdByUserId,
              email: null,
              firstName: null,
              lastName: null,
              displayName: createdByUserId,
            }
          : null,
    };
  }

  async listManualReservationsForOrder(args: {
    organizationId: string;
    orderId: string;
  }): Promise<ManualReservationView[]> {
    const { organizationId, orderId } = args;

    const rows = await this.dbInstance
      .select({
        reservation: {
          id: inventoryReservations.id,
          orderId: inventoryReservations.orderId,
          sourceKey: inventoryReservations.sourceKey,
          uom: inventoryReservations.uom,
          qty: inventoryReservations.qty,
          status: inventoryReservations.status,
          createdAt: inventoryReservations.createdAt,
          createdByUserId: inventoryReservations.createdByUserId,
        },
        material: {
          id: materials.id,
          name: materials.name,
          sku: materials.sku,
          unitOfMeasure: materials.unitOfMeasure,
        },
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(inventoryReservations)
      .leftJoin(
        materials,
        and(eq(materials.organizationId, organizationId), eq(materials.sku, inventoryReservations.sourceKey)),
      )
      .leftJoin(users, eq(users.id, inventoryReservations.createdByUserId))
      .where(
        and(
          eq(inventoryReservations.organizationId, organizationId),
          eq(inventoryReservations.orderId, orderId),
          eq(inventoryReservations.sourceType, "MANUAL"),
        ),
      )
      .orderBy(desc(inventoryReservations.createdAt));

    return rows.map((r) => {
      const createdAt = r.reservation.createdAt
        ? new Date(r.reservation.createdAt as any).toISOString()
        : new Date().toISOString();

      return {
        id: String(r.reservation.id),
        orderId: String(r.reservation.orderId),
        material: r.material?.id
          ? {
              id: String(r.material.id),
              name: String(r.material.name),
              sku: String(r.material.sku),
              unitOfMeasure: String(r.material.unitOfMeasure),
            }
          : null,
        uom: String(r.reservation.uom),
        qty: String(r.reservation.qty),
        status: String(r.reservation.status),
        createdAt,
        createdBy:
          r.user?.id
            ? {
                id: String(r.user.id),
                email: r.user.email ?? null,
                firstName: r.user.firstName ?? null,
                lastName: r.user.lastName ?? null,
                displayName: buildUserDisplayName({
                  id: String(r.user.id),
                  email: r.user.email ?? null,
                  firstName: r.user.firstName ?? null,
                  lastName: r.user.lastName ?? null,
                }),
              }
            : r.reservation.createdByUserId
            ? {
                id: String(r.reservation.createdByUserId),
                email: null,
                firstName: null,
                lastName: null,
                displayName: String(r.reservation.createdByUserId),
              }
            : null,
      };
    });
  }

  async deleteManualReservationForOrder(args: {
    organizationId: string;
    orderId: string;
    reservationId: string;
  }): Promise<
    | { deleted: true }
    | { deleted: false; reason: "not_found" | "not_manual" }
  > {
    const { organizationId, orderId, reservationId } = args;

    const [existing] = await this.dbInstance
      .select({
        id: inventoryReservations.id,
        sourceType: inventoryReservations.sourceType,
      })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.organizationId, organizationId),
          eq(inventoryReservations.orderId, orderId),
          eq(inventoryReservations.id, reservationId),
        ),
      )
      .limit(1);

    if (!existing) return { deleted: false, reason: "not_found" };
    if (String(existing.sourceType) !== "MANUAL") return { deleted: false, reason: "not_manual" };

    await this.dbInstance
      .delete(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.organizationId, organizationId),
          eq(inventoryReservations.orderId, orderId),
          eq(inventoryReservations.id, reservationId),
          eq(inventoryReservations.sourceType, "MANUAL"),
        ),
      );

    return { deleted: true };
  }
}
