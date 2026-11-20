import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { staffOrderCreateRequests, type OrderWithRelations } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StaffOrderCreateRequest = Pick<typeof staffOrderCreateRequests.$inferInsert,
    "organizationId" | "actorUserId" | "operation" | "keyHash" | "requestHash">;
type StaffOrderCreateReceipt = Pick<typeof staffOrderCreateRequests.$inferSelect, "orderId" | "followUpVerified">;

export function prepareStaffOrderCreateRequest(organizationId: string, actorUserId: string, key: string, fingerprint: string): StaffOrderCreateRequest {
    return {
        organizationId,
        actorUserId,
        operation: "orders:create",
        keyHash: createHash("sha256").update(key, "utf16le").digest("hex"),
        requestHash: createHash("sha256").update(fingerprint).digest("hex"),
    };
}

function requestScope(request: StaffOrderCreateRequest) {
    return and(
        eq(staffOrderCreateRequests.organizationId, request.organizationId),
        eq(staffOrderCreateRequests.actorUserId, request.actorUserId),
        eq(staffOrderCreateRequests.operation, request.operation),
        eq(staffOrderCreateRequests.keyHash, request.keyHash),
    );
}

export async function readStaffOrderCreateReceipt(request: StaffOrderCreateRequest, executor: Executor | typeof db = db): Promise<StaffOrderCreateReceipt | null> {
    const [receipt] = await executor.select().from(staffOrderCreateRequests).where(requestScope(request)).limit(1);
    if (!receipt) return null;
    if (receipt.requestHash !== request.requestHash) {
        throw Object.assign(new Error("Idempotency key was reused with a different order creation payload."), {
            statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        });
    }
    return receipt;
}

export async function runStaffOrderCreateRequest(request: StaffOrderCreateRequest, create: (tx: Executor) => Promise<OrderWithRelations>) {
    return db.transaction(async tx => {
        const scope = JSON.stringify([request.organizationId, request.actorUserId, request.operation, request.keyHash]);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
        const receipt = await readStaffOrderCreateReceipt(request, tx);
        if (receipt) return { receipt, replayed: true } as const;
        const order = await create(tx);
        await tx.insert(staffOrderCreateRequests).values({ ...request, orderId: order.id });
        return { order, replayed: false } as const;
    });
}

export async function recoverStaffOrderCreateResult(organizationId: string, receipt: StaffOrderCreateReceipt) {
    const order = await storage.getOrderById(organizationId, receipt.orderId);
    if (!order) {
        throw Object.assign(new Error("The Order saved for this request is no longer available. Review Orders before starting a new one."), {
            statusCode: 409, code: "ORDER_CREATE_RESULT_REMOVED",
        });
    }
    return order;
}

export async function markStaffOrderCreateFollowUpVerified(request: StaffOrderCreateRequest) {
    await db.update(staffOrderCreateRequests).set({ followUpVerified: true }).where(requestScope(request));
}
