import { db } from "../db";
import {
  importJobs,
  importJobRows,
  type ImportJob,
  type ImportJobRow,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export class ImportRepository {
  constructor(private readonly dbInstance = db) {}

  async createJob(args: {
    organizationId: string;
    resource: ImportJob["resource"];
    applyMode: ImportJob["applyMode"];
    createdByUserId?: string | null;
    sourceFilename?: string | null;
    summaryJson?: any;
  }): Promise<ImportJob> {
    const [job] = await this.dbInstance
      .insert(importJobs)
      .values({
        organizationId: args.organizationId,
        resource: args.resource,
        applyMode: args.applyMode,
        createdByUserId: args.createdByUserId ?? null,
        sourceFilename: args.sourceFilename ?? null,
        summaryJson: args.summaryJson ?? null,
        status: "validated",
        updatedAt: new Date(),
      })
      .returning();

    return job;
  }

  async addJobRows(
    organizationId: string,
    jobId: string,
    rows: Array<{
      rowNumber: number;
      status: ImportJobRow["status"];
      rawJson?: any;
      normalizedJson?: any;
      error?: string | null;
    }>
  ): Promise<void> {
    if (rows.length === 0) return;

    await this.dbInstance.insert(importJobRows).values(
      rows.map((r) => ({
        organizationId,
        jobId,
        rowNumber: r.rowNumber,
        status: r.status,
        rawJson: r.rawJson ?? null,
        normalizedJson: r.normalizedJson ?? null,
        error: r.error ?? null,
      }))
    );
  }

  async getJob(organizationId: string, jobId: string): Promise<ImportJob | null> {
    const [job] = await this.dbInstance
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.organizationId, organizationId), eq(importJobs.id, jobId)))
      .limit(1);

    return job ?? null;
  }

  async listJobs(organizationId: string, args?: { resource?: ImportJob["resource"]; limit?: number }): Promise<ImportJob[]> {
    const where = [eq(importJobs.organizationId, organizationId)];
    if (args?.resource) where.push(eq(importJobs.resource, args.resource));

    return this.dbInstance
      .select()
      .from(importJobs)
      .where(and(...where))
      .orderBy(desc(importJobs.createdAt))
      .limit(args?.limit ?? 25);
  }

  async listJobRows(
    organizationId: string,
    jobId: string,
    args?: { status?: ImportJobRow["status"]; limit?: number }
  ): Promise<ImportJobRow[]> {
    const where = [eq(importJobRows.organizationId, organizationId), eq(importJobRows.jobId, jobId)];
    if (args?.status) where.push(eq(importJobRows.status, args.status));

    return this.dbInstance
      .select()
      .from(importJobRows)
      .where(and(...where))
      .orderBy(importJobRows.rowNumber)
      .limit(args?.limit ?? 200);
  }

  async updateJobStatus(
    organizationId: string,
    jobId: string,
    patch: Partial<Pick<ImportJob, "status" | "applyMode" | "summaryJson">>
  ): Promise<ImportJob> {
    const [job] = await this.dbInstance
      .update(importJobs)
      .set({
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.applyMode ? { applyMode: patch.applyMode } : {}),
        ...(patch.summaryJson !== undefined ? { summaryJson: patch.summaryJson as any } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(importJobs.organizationId, organizationId), eq(importJobs.id, jobId)))
      .returning();

    return job;
  }

  async markRowsApplied(organizationId: string, rowIds: string[]): Promise<void> {
    if (rowIds.length === 0) return;
    await this.dbInstance
      .update(importJobRows)
      .set({ status: "applied" })
      .where(and(eq(importJobRows.organizationId, organizationId), inArray(importJobRows.id, rowIds)));
  }
}
