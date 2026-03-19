import { db } from "../db";
import { storageJobs, type InsertStorageJob, type StorageJob } from "@shared/schema";
import { eq } from "drizzle-orm";

export class StorageJobRepository {
  constructor(private readonly dbInstance = db) {}

  async create(values: InsertStorageJob, executor: any = this.dbInstance): Promise<StorageJob> {
    const [created] = await executor.insert(storageJobs).values(values).returning();
    if (!created) {
      throw new Error("Failed to create storage job");
    }
    return created;
  }

  async updateState(
    id: string,
    values: Partial<InsertStorageJob>,
    executor: any = this.dbInstance,
  ): Promise<StorageJob> {
    const [updated] = await executor.update(storageJobs).set(values).where(eq(storageJobs.id, id)).returning();
    if (!updated) {
      throw new Error("Storage job not found");
    }
    return updated;
  }
}

export const storageJobRepository = new StorageJobRepository();
