import { db } from "../db";
import { fileDerivatives, type FileDerivative, type InsertFileDerivative } from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

type ReplaceReadyValues = {
  fileRecordId: NonNullable<InsertFileDerivative["fileRecordId"]>;
  derivativeType: NonNullable<InsertFileDerivative["derivativeType"]>;
  sourcePlacementId?: InsertFileDerivative["sourcePlacementId"];
  bucket?: InsertFileDerivative["bucket"];
  objectKey?: InsertFileDerivative["objectKey"];
  mimeType?: InsertFileDerivative["mimeType"];
  sizeBytes?: InsertFileDerivative["sizeBytes"];
};

export class FileDerivativeRepository {
  constructor(private readonly dbInstance = db) {}

  async listByFileRecordIdAndType(
    fileRecordId: string,
    derivativeType: FileDerivative["derivativeType"],
    executor: any = this.dbInstance,
  ): Promise<FileDerivative[]> {
    return executor
      .select()
      .from(fileDerivatives)
      .where(
        and(
          eq(fileDerivatives.fileRecordId, fileRecordId),
          eq(fileDerivatives.derivativeType, derivativeType),
        ),
      )
      .orderBy(desc(fileDerivatives.updatedAt), desc(fileDerivatives.createdAt));
  }

  async getPreferredByFileRecordIdAndType(
    fileRecordId: string,
    derivativeType: FileDerivative["derivativeType"],
    executor: any = this.dbInstance,
  ): Promise<FileDerivative | null> {
    const rows = await this.listByFileRecordIdAndType(fileRecordId, derivativeType, executor);
    return (
      rows.find((row) => row.state === "ready" && !!row.objectKey) ??
      rows.find((row) => row.state === "pending") ??
      null
    );
  }

  async replaceReady(
    values: ReplaceReadyValues,
    executor: any = this.dbInstance,
  ): Promise<FileDerivative> {
    const now = new Date();

    await executor
      .update(fileDerivatives)
      .set({
        state: "replaced",
        updatedAt: now,
      })
      .where(
        and(
          eq(fileDerivatives.fileRecordId, values.fileRecordId),
          eq(fileDerivatives.derivativeType, values.derivativeType),
          inArray(fileDerivatives.state, ["ready", "pending"]),
        ),
      );

    const [created] = await executor
      .insert(fileDerivatives)
      .values({
        ...values,
        state: "ready",
        errorText: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) {
      throw new Error("Failed to persist file derivative");
    }

    return created;
  }
}

export const fileDerivativeRepository = new FileDerivativeRepository();