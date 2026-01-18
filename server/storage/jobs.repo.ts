import { db } from "../db";
import {
    jobs,
    jobNotes,
    jobStatusLog,
    jobStatuses,
    jobFiles,
    orders,
    orderLineItems,
    orderAttachments,
    type Job,
    type InsertJob,
    type JobNote,
    type InsertJobNote,
    type JobStatusLog,
    type InsertJobStatusLog,
    type JobStatus,
    type InsertJobStatus,
    type JobFile,
    type InsertJobFile,
    type Order,
    type OrderLineItem,
    type OrderAttachment,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export class JobsRepository {
    constructor(private readonly dbInstance = db) { }

    // Job Operations
    async getJobs(organizationId: string, filters?: { statusKey?: string; assignedToUserId?: string; orderId?: string }): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; customerName?: string; orderNumber?: string | null; dueDate?: Date | null; quantity?: number; mediaType?: string })[]> {
        // First, get all orders for this organization
        const orgOrders = await this.dbInstance.select({ id: orders.id }).from(orders).where(eq(orders.organizationId, organizationId));
        const orderIds = orgOrders.map(o => o.id);

        if (orderIds.length === 0) return [];

        const conditions: any[] = [inArray(jobs.orderId as any, orderIds)];
        if (filters?.statusKey) conditions.push(eq(jobs.statusKey as any, filters.statusKey));
        if (filters?.assignedToUserId) conditions.push(eq(jobs.assignedToUserId as any, filters.assignedToUserId));
        if (filters?.orderId) conditions.push(eq(jobs.orderId as any, filters.orderId));
        let query = this.dbInstance.select().from(jobs) as any;
        query = query.where(and(...conditions));
        query = query.orderBy(desc(jobs.createdAt as any));
        const records: Job[] = await query;
        const enriched = await Promise.all(records.map(async (j) => {
            const orderRecord = j.orderId ? await this.dbInstance.query.orders.findFirst({
                where: eq(orders.id, j.orderId),
                with: { customer: true },
            }) : undefined;
            const lineItemRecord = j.orderLineItemId ? await this.dbInstance.query.orderLineItems.findFirst({
                where: eq(orderLineItems.id, j.orderLineItemId),
                with: {
                    product: true,
                    productVariant: true,
                },
            }) : undefined;
            return {
                ...j,
                order: orderRecord || null,
                orderLineItem: lineItemRecord || null,
                customerName: orderRecord?.customer?.companyName || 'Unknown',
                orderNumber: orderRecord?.orderNumber || null,
                dueDate: orderRecord?.dueDate || null,
                quantity: lineItemRecord?.quantity || 0,
                mediaType: lineItemRecord?.productVariant?.name || lineItemRecord?.product?.name || 'Unknown',
            } as any;
        }));
        return enriched as any;
    }

    async getJob(organizationId: string, id: string): Promise<(Job & { order?: Order | null; orderLineItem?: OrderLineItem | null; notesLog?: JobNote[]; statusLog?: JobStatusLog[] }) | undefined> {
        // Find job and verify it belongs to an order in this organization
        const [job] = await this.dbInstance.select().from(jobs).where(eq(jobs.id, id));
        if (!job || !job.orderId) return undefined;

        // Verify the order belongs to this organization
        const [order] = await this.dbInstance.select().from(orders).where(and(eq(orders.id, job.orderId), eq(orders.organizationId, organizationId)));
        if (!order) return undefined;

        const [li] = job.orderLineItemId ? await this.dbInstance.select().from(orderLineItems).where(eq(orderLineItems.id, job.orderLineItemId)) : [undefined];
        const notes = await this.dbInstance.select().from(jobNotes).where(eq(jobNotes.jobId as any, job.id)).orderBy(desc(jobNotes.createdAt as any));
        const status = await this.dbInstance.select().from(jobStatusLog).where(eq(jobStatusLog.jobId as any, job.id)).orderBy(desc(jobStatusLog.createdAt as any));
        return { ...job, order: order || null, orderLineItem: li || null, notesLog: notes as any, statusLog: status as any } as any;
    }

    async updateJob(organizationId: string, id: string, data: Partial<InsertJob>, userId?: string): Promise<Job> {
        // Find job and verify it belongs to an order in this organization
        const [existing] = await this.dbInstance.select().from(jobs).where(eq(jobs.id, id));
        if (!existing || !existing.orderId) throw new Error('Job not found');

        // Verify the order belongs to this organization
        const [order] = await this.dbInstance.select().from(orders).where(and(eq(orders.id, existing.orderId), eq(orders.organizationId, organizationId)));
        if (!order) throw new Error('Job not found');

        const updateData: any = { ...data, updatedAt: new Date() };
        if ((data as any).assignedTo !== undefined) {
            updateData.assignedToUserId = (data as any).assignedTo;
            delete (updateData as any).assignedTo;
        }
        if ((data as any).notes !== undefined) {
            updateData.notesInternal = (data as any).notes;
            delete (updateData as any).notes;
        }
        // Handle production tracking fields
        if ((data as any).rollWidthUsedInches !== undefined) {
            updateData.rollWidthUsedInches = (data as any).rollWidthUsedInches;
        }
        if ((data as any).materialId !== undefined) {
            updateData.materialId = (data as any).materialId;
        }
        const [updated] = await this.dbInstance.update(jobs).set(updateData).where(eq(jobs.id, id)).returning();
        if (!updated) throw new Error('Job not found after update');
        if (data.statusKey && data.statusKey !== existing.statusKey) {
            // Fail-soft: job status audit logging should not block the update.
            try {
                if (!organizationId) {
                    console.error('[updateJob] Missing organizationId; skipping job_status_log insert', {
                        jobId: id,
                        oldStatusKey: existing.statusKey,
                        newStatusKey: data.statusKey,
                    });
                } else {
                    await this.dbInstance.insert(jobStatusLog).values({
                        organizationId,
                        jobId: id,
                        oldStatusKey: existing.statusKey,
                        newStatusKey: data.statusKey,
                        userId: userId || null,
                    } as InsertJobStatusLog).returning();
                }
            } catch (error) {
                console.error('[updateJob] Failed job_status_log insert (non-blocking)', {
                    organizationId,
                    jobId: id,
                    oldStatusKey: existing.statusKey,
                    newStatusKey: data.statusKey,
                    error,
                });
            }
        }
        return updated;
    }

    async addJobNote(jobId: string, noteText: string, userId: string): Promise<JobNote> {
        const [note] = await this.dbInstance.insert(jobNotes).values({ jobId, userId, noteText } as InsertJobNote).returning();
        return note;
    }

    async getJobsForOrder(organizationId: string, orderId: string): Promise<Job[]> {
        // Verify the order belongs to this organization
        const [order] = await this.dbInstance.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.organizationId, organizationId)));
        if (!order) return [];
        return await this.dbInstance.select().from(jobs).where(eq(jobs.orderId as any, orderId)).orderBy(desc(jobs.createdAt as any));
    }

    // Job Status Configuration
    async getJobStatuses(organizationId: string): Promise<JobStatus[]> {
        return this.dbInstance.select().from(jobStatuses).where(eq(jobStatuses.organizationId, organizationId)).orderBy(jobStatuses.position);
    }

    async createJobStatus(organizationId: string, data: Omit<InsertJobStatus, 'organizationId'>): Promise<JobStatus> {
        const [status] = await this.dbInstance.insert(jobStatuses).values({ ...data, organizationId }).returning();
        return status;
    }

    async updateJobStatus(organizationId: string, id: string, data: Partial<Omit<InsertJobStatus, 'organizationId'>>): Promise<JobStatus> {
        const [updated] = await this.dbInstance.update(jobStatuses).set({ ...data, updatedAt: new Date() }).where(and(eq(jobStatuses.id, id), eq(jobStatuses.organizationId, organizationId))).returning();
        if (!updated) throw new Error('Job status not found');
        return updated;
    }

    async deleteJobStatus(organizationId: string, id: string): Promise<void> {
        await this.dbInstance.delete(jobStatuses).where(and(eq(jobStatuses.id, id), eq(jobStatuses.organizationId, organizationId)));
    }

    // Job File Operations
    async listJobFiles(jobId: string): Promise<(JobFile & { file?: OrderAttachment | null })[]> {
        const jobFileRecords = await this.dbInstance
            .select({
                jobFile: jobFiles,
                file: orderAttachments,
            })
            .from(jobFiles)
            .leftJoin(orderAttachments, eq(jobFiles.fileId, orderAttachments.id))
            .where(eq(jobFiles.jobId, jobId))
            .orderBy(desc(jobFiles.createdAt));

        return jobFileRecords.map(record => ({
            ...record.jobFile,
            file: record.file || null,
        }));
    }

    async attachFileToJob(data: InsertJobFile): Promise<JobFile> {
        const [newJobFile] = await this.dbInstance.insert(jobFiles).values(data).returning();
        return newJobFile;
    }

    async detachJobFile(id: string): Promise<void> {
        await this.dbInstance.delete(jobFiles).where(eq(jobFiles.id, id));
    }
}
