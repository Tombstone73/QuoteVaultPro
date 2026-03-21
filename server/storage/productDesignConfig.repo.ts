import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  productDesignConfigs,
  type InsertProductDesignConfig,
  type ProductDesignConfig,
} from "@shared/schema";

export class ProductDesignConfigRepository {
  constructor(private readonly dbInstance = db) {}

  async getByProductId(
    organizationId: string,
    productId: string,
    executor: any = this.dbInstance,
  ): Promise<ProductDesignConfig | null> {
    const [config] = await executor
      .select()
      .from(productDesignConfigs)
      .where(
        and(
          eq(productDesignConfigs.organizationId, organizationId),
          eq(productDesignConfigs.productId, productId),
        ),
      )
      .limit(1);

    return config ?? null;
  }

  async listByProductIds(
    organizationId: string,
    productIds: string[],
    executor: any = this.dbInstance,
  ): Promise<ProductDesignConfig[]> {
    if (productIds.length === 0) {
      return [];
    }

    return executor
      .select()
      .from(productDesignConfigs)
      .where(
        and(
          eq(productDesignConfigs.organizationId, organizationId),
          inArray(productDesignConfigs.productId, productIds as [string, ...string[]]),
        ),
      );
  }

  async upsertForProduct(
    organizationId: string,
    productId: string,
    values: Omit<InsertProductDesignConfig, "id" | "organizationId" | "productId" | "createdAt" | "updatedAt">,
    executor: any = this.dbInstance,
  ): Promise<ProductDesignConfig> {
    const [config] = await executor
      .insert(productDesignConfigs)
      .values({
        organizationId,
        productId,
        ...values,
      })
      .onConflictDoUpdate({
        target: productDesignConfigs.productId,
        set: {
          ...values,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!config) {
      throw new Error("Failed to save product design config");
    }

    return config;
  }
}

export const productDesignConfigRepository = new ProductDesignConfigRepository();