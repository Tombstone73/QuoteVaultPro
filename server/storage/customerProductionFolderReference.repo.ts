import { db } from "../db";
import {
  customerProductionFolderReferences,
  type CustomerProductionFolderReference,
  type InsertCustomerProductionFolderReference,
  type UpdateCustomerProductionFolderReference,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";

export class CustomerProductionFolderReferenceRepository {
  constructor(private readonly dbInstance = db) {}

  async getForCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<CustomerProductionFolderReference | null> {
    const [row] = await this.dbInstance
      .select()
      .from(customerProductionFolderReferences)
      .where(
        and(
          eq(customerProductionFolderReferences.organizationId, organizationId),
          eq(customerProductionFolderReferences.customerId, customerId),
        ),
      )
      .orderBy(desc(customerProductionFolderReferences.updatedAt))
      .limit(1);

    return row ?? null;
  }

  async upsertForCustomer(
    organizationId: string,
    customerId: string,
    values: Omit<InsertCustomerProductionFolderReference, "organizationId" | "customerId">,
    executor: any = this.dbInstance,
  ): Promise<CustomerProductionFolderReference> {
    const [existing] = await executor
      .select()
      .from(customerProductionFolderReferences)
      .where(
        and(
          eq(customerProductionFolderReferences.organizationId, organizationId),
          eq(customerProductionFolderReferences.customerId, customerId),
          eq(customerProductionFolderReferences.folderType, values.folderType),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await executor
        .update(customerProductionFolderReferences)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(customerProductionFolderReferences.id, existing.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to update customer production folder reference");
      }

      return updated;
    }

    const [created] = await executor
      .insert(customerProductionFolderReferences)
      .values({ ...values, organizationId, customerId })
      .returning();

    if (!created) {
      throw new Error("Failed to create customer production folder reference");
    }

    return created;
  }

  async updateById(
    id: string,
    values: UpdateCustomerProductionFolderReference,
    executor: any = this.dbInstance,
  ): Promise<CustomerProductionFolderReference> {
    const [updated] = await executor
      .update(customerProductionFolderReferences)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(customerProductionFolderReferences.id, id))
      .returning();

    if (!updated) {
      throw new Error("Customer production folder reference not found");
    }

    return updated;
  }
}

export const customerProductionFolderReferenceRepository = new CustomerProductionFolderReferenceRepository();
