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

type SetStateValues = {
  fileRecordId: NonNullable<InsertFileDerivative["fileRecordId"]>;
  derivativeType: NonNullable<InsertFileDerivative["derivativeType"]>;
  state: "pending" | "failed";
  sourcePlacementId?: InsertFileDerivative["sourcePlacementId"];
  errorText?: InsertFileDerivative["errorText"];
};

export class FileDerivativeRepository {
  constructor(private readonly dbInstance = db) {}

  async deleteByFileRecordId(
    fileRecordId: string,
    executor: any = this.dbInstance,
  ): Promise<void> {
    await executor
      .delete(fileDerivatives)
      .where(eq(fileDerivatives.fileRecordId, fileRecordId));
  }

  async listByFileRecordId(
    fileRecordId: string,
    executor: any = this.dbInstance,
  ): Promise<FileDerivative[]> {
    return executor
      .select()
      .from(fileDerivatives)
      .where(eq(fileDerivatives.fileRecordId, fileRecordId))
      .orderBy(desc(fileDerivatives.updatedAt), desc(fileDerivatives.createdAt));
  }

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
      rows.find((row) => row.state === "failed") ??
      null
    );
  }

  async replaceReady(
    values: ReplaceReadyValues,
    executor: any = this.dbInstance,
  ): Promise<FileDerivative> {
    const now = new Date();
    const existing = await this.listByFileRecordIdAndType(values.fileRecordId, values.derivativeType, executor);
    const reusable = existing[0] ?? null;

    if (reusable) {
      const redundantIds = existing
        .filter((row) => row.id !== reusable.id)
        .map((row) => row.id);

      if (redundantIds.length > 0) {
        await executor
          .update(fileDerivatives)
          .set({
            state: "replaced",
            updatedAt: now,
          })
          .where(inArray(fileDerivatives.id, redundantIds));
      }

      const [updated] = await executor
        .update(fileDerivatives)
        .set({
          ...values,
          state: "ready",
          errorText: null,
          updatedAt: now,
        })
        .where(eq(fileDerivatives.id, reusable.id))
        .returning();

      if (!updated) {
        throw new Error("Failed to persist file derivative");
      }

      return updated;
    }

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

  async setState(
    values: SetStateValues,
    executor: any = this.dbInstance,
  ): Promise<FileDerivative> {
    const now = new Date();
    const existing = await this.listByFileRecordIdAndType(values.fileRecordId, values.derivativeType, executor);
    const reusable = existing[0] ?? null;
    const stateValues = {
      state: values.state,
      sourcePlacementId: values.sourcePlacementId ?? null,
      objectKey: null,
      bucket: null,
      mimeType: null,
      sizeBytes: null,
      errorText: values.errorText ?? null,
      updatedAt: now,
    } as const;

    if (reusable) {
      const [updated] = await executor
        .update(fileDerivatives)
        .set(stateValues)
        .where(eq(fileDerivatives.id, reusable.id))
        .returning();
      if (!updated) throw new Error("Failed to update file derivative state");
      return updated;
    }

    const [created] = await executor
      .insert(fileDerivatives)
      .values({
        fileRecordId: values.fileRecordId,
        derivativeType: values.derivativeType,
        ...stateValues,
        createdAt: now,
      })
      .returning();
    if (!created) throw new Error("Failed to create file derivative state");
    return created;
  }
}

export const fileDerivativeRepository = new FileDerivativeRepository();
