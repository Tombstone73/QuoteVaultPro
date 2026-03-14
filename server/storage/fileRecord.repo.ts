import { db } from "../db";
import { fileRecords, type FileRecord, type InsertFileRecord } from "@shared/schema";
import { and, eq } from "drizzle-orm";

export class FileRecordRepository {
  constructor(private readonly dbInstance = db) {}

  async create(values: InsertFileRecord, executor: any = this.dbInstance): Promise<FileRecord> {
    const [created] = await executor.insert(fileRecords).values(values).returning();
    if (!created) {
      throw new Error("Failed to create file record");
    }
    return created;
  }

  async getByIdForOrganization(organizationId: string, id: string): Promise<FileRecord | null> {
    const [row] = await this.dbInstance
      .select()
      .from(fileRecords)
      .where(and(eq(fileRecords.organizationId, organizationId), eq(fileRecords.id, id)))
      .limit(1);

    return row ?? null;
  }

  async getById(id: string, executor: any = this.dbInstance): Promise<FileRecord | null> {
    const [row] = await executor
      .select()
      .from(fileRecords)
      .where(eq(fileRecords.id, id))
      .limit(1);

    return row ?? null;
  }
}

export const fileRecordRepository = new FileRecordRepository();
