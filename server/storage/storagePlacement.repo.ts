import { db } from "../db";
import { storagePlacements, type InsertStoragePlacement, type StoragePlacement } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export class StoragePlacementRepository {
  constructor(private readonly dbInstance = db) {}

  async getById(id: string, executor: any = this.dbInstance): Promise<StoragePlacement | null> {
    const [placement] = await executor
      .select()
      .from(storagePlacements)
      .where(eq(storagePlacements.id, id))
      .limit(1);

    return placement ?? null;
  }

  async create(values: InsertStoragePlacement, executor: any = this.dbInstance): Promise<StoragePlacement> {
    const [created] = await executor.insert(storagePlacements).values(values).returning();
    if (!created) {
      throw new Error("Failed to create storage placement");
    }
    return created;
  }

  async listByFileRecordId(fileRecordId: string): Promise<StoragePlacement[]> {
    return this.dbInstance.select().from(storagePlacements).where(eq(storagePlacements.fileRecordId, fileRecordId));
  }

  async getActiveCanonicalPlacementByFileRecordId(
    fileRecordId: string,
    executor: any = this.dbInstance,
  ): Promise<StoragePlacement | null> {
    const [placement] = await executor
      .select()
      .from(storagePlacements)
      .where(
        and(
          eq(storagePlacements.fileRecordId, fileRecordId),
          eq(storagePlacements.placementRole, "canonical"),
          eq(storagePlacements.placementState, "active"),
        ),
      )
      .orderBy(desc(storagePlacements.createdAt))
      .limit(1);

    return placement ?? null;
  }
}

export const storagePlacementRepository = new StoragePlacementRepository();
