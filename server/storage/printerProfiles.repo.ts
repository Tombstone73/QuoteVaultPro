import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  printerProfiles,
  type InsertPrinterProfile,
  type PrinterProfile,
  type UpdatePrinterProfile,
} from "@shared/schema";

export class PrinterProfilesRepository {
  constructor(private readonly dbInstance = db) {}

  async listPrinterProfiles(
    organizationId: string,
    filters: { activeOnly?: boolean; intendedUse?: string; printerType?: string } = {},
  ): Promise<PrinterProfile[]> {
    const conditions = [eq(printerProfiles.organizationId, organizationId)];
    if (filters.activeOnly) conditions.push(eq(printerProfiles.isActive, true));
    if (filters.intendedUse) conditions.push(eq(printerProfiles.intendedUse, filters.intendedUse));
    if (filters.printerType) conditions.push(eq(printerProfiles.printerType, filters.printerType as any));
    return this.dbInstance
      .select()
      .from(printerProfiles)
      .where(and(...conditions))
      .orderBy(desc(printerProfiles.isDefault), desc(printerProfiles.updatedAt));
  }

  async getPrinterProfile(organizationId: string, id: string): Promise<PrinterProfile | undefined> {
    const [profile] = await this.dbInstance
      .select()
      .from(printerProfiles)
      .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, id)))
      .limit(1);
    return profile;
  }

  async createPrinterProfile(
    organizationId: string,
    data: InsertPrinterProfile,
    userId?: string | null,
  ): Promise<PrinterProfile> {
    return this.dbInstance.transaction(async (tx) => {
      if (data.isDefault && data.isActive !== false) {
        await tx
          .update(printerProfiles)
          .set({ isDefault: false, updatedAt: new Date(), updatedByUserId: userId ?? null } as any)
          .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.intendedUse, data.intendedUse)));
      }
      const [created] = await tx
        .insert(printerProfiles)
        .values({
          ...data,
          organizationId,
          isDefault: Boolean(data.isDefault && data.isActive !== false),
          createdByUserId: userId ?? null,
          updatedByUserId: userId ?? null,
        } as any)
        .returning();
      return created;
    });
  }

  async updatePrinterProfile(
    organizationId: string,
    id: string,
    data: UpdatePrinterProfile,
    userId?: string | null,
  ): Promise<PrinterProfile> {
    return this.dbInstance.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(printerProfiles)
        .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, id)))
        .limit(1);
      if (!existing) {
        const error = new Error("Printer profile not found");
        (error as any).statusCode = 404;
        throw error;
      }

      const nextIntendedUse = data.intendedUse ?? existing.intendedUse;
      const nextIsActive = data.isActive ?? existing.isActive;
      const wantsDefault = data.isDefault === true && nextIsActive;
      if (wantsDefault) {
        await tx
          .update(printerProfiles)
          .set({ isDefault: false, updatedAt: new Date(), updatedByUserId: userId ?? null } as any)
          .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.intendedUse, nextIntendedUse)));
      }

      const [updated] = await tx
        .update(printerProfiles)
        .set({
          ...data,
          isDefault: nextIsActive ? (data.isDefault ?? existing.isDefault) : false,
          updatedAt: new Date(),
          updatedByUserId: userId ?? null,
        } as any)
        .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, id)))
        .returning();
      return updated;
    });
  }

  async setDefaultPrinterProfile(
    organizationId: string,
    id: string,
    userId?: string | null,
  ): Promise<PrinterProfile> {
    const profile = await this.getPrinterProfile(organizationId, id);
    if (!profile) {
      const error = new Error("Printer profile not found");
      (error as any).statusCode = 404;
      throw error;
    }
    if (!profile.isActive) {
      const error = new Error("Inactive printer profiles cannot be set as default.");
      (error as any).statusCode = 400;
      throw error;
    }
    return this.updatePrinterProfile(organizationId, id, { isDefault: true }, userId);
  }

  async deactivatePrinterProfile(
    organizationId: string,
    id: string,
    userId?: string | null,
  ): Promise<PrinterProfile> {
    return this.updatePrinterProfile(organizationId, id, { isActive: false, isDefault: false }, userId);
  }

  async deletePrinterProfile(organizationId: string, id: string): Promise<{ deleted: boolean; profile?: PrinterProfile }> {
    const profile = await this.getPrinterProfile(organizationId, id);
    if (!profile) {
      const error = new Error("Printer profile not found");
      (error as any).statusCode = 404;
      throw error;
    }
    await this.dbInstance
      .delete(printerProfiles)
      .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, id)));
    return { deleted: true, profile };
  }

  async markPrinterProfileUsed(organizationId: string, id: string): Promise<void> {
    await this.dbInstance
      .update(printerProfiles)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() } as any)
      .where(and(eq(printerProfiles.organizationId, organizationId), eq(printerProfiles.id, id)));
  }
}
