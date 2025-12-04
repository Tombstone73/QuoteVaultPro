import { db } from "../db";
import {
    auditLogs,
    type AuditLog,
    type InsertAuditLog,
} from "@shared/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";

export class AuditRepository {
    constructor(private readonly dbInstance = db) { }

    async createAuditLog(organizationId: string, log: Omit<InsertAuditLog, 'organizationId'>): Promise<AuditLog> {
        const [auditLog] = await this.dbInstance.insert(auditLogs).values({ ...log, organizationId }).returning();
        return auditLog;
    }

    async getAuditLogs(organizationId: string, filters?: {
        userId?: string;
        actionType?: string;
        entityType?: string;
        startDate?: Date;
        endDate?: Date;
        limit?: number;
    }): Promise<AuditLog[]> {
        const conditions = [eq(auditLogs.organizationId, organizationId)];

        if (filters?.userId) {
            conditions.push(eq(auditLogs.userId, filters.userId));
        }
        if (filters?.actionType) {
            conditions.push(eq(auditLogs.actionType, filters.actionType));
        }
        if (filters?.entityType) {
            conditions.push(eq(auditLogs.entityType, filters.entityType));
        }
        if (filters?.startDate) {
            conditions.push(gte(auditLogs.createdAt, filters.startDate));
        }
        if (filters?.endDate) {
            conditions.push(lte(auditLogs.createdAt, filters.endDate));
        }

        let query = this.dbInstance.select().from(auditLogs);
        query = query.where(and(...conditions)) as any;
        query = query.orderBy(desc(auditLogs.createdAt)) as any;

        if (filters?.limit) {
            query = query.limit(filters.limit) as any;
        }

        return await query;
    }
}
