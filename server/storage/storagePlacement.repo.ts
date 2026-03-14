import { db } from "../db";
import { storagePlacements, type InsertStoragePlacement, type StoragePlacement } from "@shared/schema";
import { eq } from "drizzle-orm";

export class StoragePlacementRepository {
  constructor(private readonly dbInstance = db) {}

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
}

export const storagePlacementRepository = new StoragePlacementRepository();
