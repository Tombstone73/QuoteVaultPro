import { db } from "../db";
import { organizationStorageProfiles, type InsertOrganizationStorageProfile, type OrganizationStorageProfile } from "@shared/schema";
import { eq } from "drizzle-orm";

export class OrganizationStorageProfileRepository {
  constructor(private readonly dbInstance = db) {}

  async getByOrganizationId(organizationId: string): Promise<OrganizationStorageProfile | null> {
    const [profile] = await this.dbInstance
      .select()
      .from(organizationStorageProfiles)
      .where(eq(organizationStorageProfiles.organizationId, organizationId))
      .limit(1);

    return profile ?? null;
  }

  async create(
    values: InsertOrganizationStorageProfile,
    executor: any = this.dbInstance,
  ): Promise<OrganizationStorageProfile> {
    const [created] = await executor.insert(organizationStorageProfiles).values(values).returning();
    if (!created) {
      throw new Error("Failed to create organization storage profile");
    }
    return created;
  }

  async update(
    id: string,
    values: Partial<InsertOrganizationStorageProfile>,
    executor: any = this.dbInstance,
  ): Promise<OrganizationStorageProfile> {
    const [updated] = await executor
      .update(organizationStorageProfiles)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(organizationStorageProfiles.id, id))
      .returning();

    if (!updated) {
      throw new Error("Organization storage profile not found");
    }

    return updated;
  }
}

export const organizationStorageProfileRepository = new OrganizationStorageProfileRepository();
