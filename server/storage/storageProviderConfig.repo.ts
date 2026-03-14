import { db } from "../db";
import { storageProviderConfigs, type InsertStorageProviderConfig, type StorageProviderConfig } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export class StorageProviderConfigRepository {
  constructor(private readonly dbInstance = db) {}

  async getByIdForOrganization(organizationId: string, id: string): Promise<StorageProviderConfig | null> {
    const [row] = await this.dbInstance
      .select()
      .from(storageProviderConfigs)
      .where(and(eq(storageProviderConfigs.organizationId, organizationId), eq(storageProviderConfigs.id, id)))
      .limit(1);

    return row ?? null;
  }

  async getByOrganizationAndRole(
    organizationId: string,
    role: StorageProviderConfig["role"],
  ): Promise<StorageProviderConfig | null> {
    const [row] = await this.dbInstance
      .select()
      .from(storageProviderConfigs)
      .where(and(eq(storageProviderConfigs.organizationId, organizationId), eq(storageProviderConfigs.role, role)))
      .limit(1);

    return row ?? null;
  }

  async create(
    values: InsertStorageProviderConfig,
    executor: any = this.dbInstance,
  ): Promise<StorageProviderConfig> {
    const [created] = await executor.insert(storageProviderConfigs).values(values).returning();
    if (!created) {
      throw new Error("Failed to create storage provider config");
    }
    return created;
  }

  async update(
    id: string,
    values: Partial<InsertStorageProviderConfig>,
    executor: any = this.dbInstance,
  ): Promise<StorageProviderConfig> {
    const [updated] = await executor
      .update(storageProviderConfigs)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(storageProviderConfigs.id, id))
      .returning();

    if (!updated) {
      throw new Error("Storage provider config not found");
    }

    return updated;
  }
}

export const storageProviderConfigRepository = new StorageProviderConfigRepository();
