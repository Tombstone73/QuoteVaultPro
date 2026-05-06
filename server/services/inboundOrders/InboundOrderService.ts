import {
  type InboundOrderDecisionFlag,
  type InboundOrderEvent,
  type InboundOrderFile,
  type InboundOrderLineItem,
  type InboundOrderRecord,
  type InboundOrderRecordStatus,
  type InboundOrderReviewSnapshot,
  type InboundOrderSourceType,
  type InboundOrderWarning,
} from "@shared/schema";
import {
  inboundOrdersRepository,
  type InboundOrderListFilters,
} from "../../storage/inboundOrders.repo";

export type InboundOrderDetail = {
  record: InboundOrderRecord;
  lineItems: InboundOrderLineItem[];
  files: InboundOrderFile[];
  warnings: InboundOrderWarning[];
  decisionFlags: InboundOrderDecisionFlag[];
  events: InboundOrderEvent[];
  reviewSnapshots: InboundOrderReviewSnapshot[];
};

export type ManualInboundOrderCreateInput = {
  organizationId: string;
  actorUserId: string | null;
  sourceId?: string | null;
  sourceLabel?: string | null;
  sourceRecordId?: string | null;
  sourceMessageId?: string | null;
  externalReference?: string | null;
  idempotencyKey?: string | null;
  payloadHash?: string | null;
  rawPayloadJson?: Record<string, unknown>;
  normalizedPayloadJson?: Record<string, unknown>;
  extractedCustomerJson?: Record<string, unknown> | null;
  extractedOrderJson?: Record<string, unknown> | null;
  extractedShippingJson?: Record<string, unknown> | null;
  requiresHumanDecision?: boolean;
  reviewRequiredReason?: string | null;
};

export class InboundOrderService {
  constructor(private readonly repository = inboundOrdersRepository) {}

  async listRecords(args: {
    organizationId: string;
    filters: InboundOrderListFilters;
  }): Promise<InboundOrderRecord[]> {
    return this.repository.listRecords(args.organizationId, args.filters);
  }

  async getDetail(args: {
    organizationId: string;
    inboundRecordId: string;
  }): Promise<InboundOrderDetail | null> {
    const record = await this.repository.getRecord(args.organizationId, args.inboundRecordId);

    if (!record) {
      return null;
    }

    const [
      lineItems,
      files,
      warnings,
      decisionFlags,
      events,
      reviewSnapshots,
    ] = await Promise.all([
      this.repository.listLineItems(args.organizationId, args.inboundRecordId),
      this.repository.listFiles(args.organizationId, args.inboundRecordId),
      this.repository.listWarnings(args.organizationId, args.inboundRecordId),
      this.repository.listDecisionFlags(args.organizationId, args.inboundRecordId),
      this.repository.listEvents(args.organizationId, args.inboundRecordId),
      this.repository.listReviewSnapshots(args.organizationId, args.inboundRecordId),
    ]);

    return {
      record,
      lineItems,
      files,
      warnings,
      decisionFlags,
      events,
      reviewSnapshots,
    };
  }

  async createManualRecord(args: ManualInboundOrderCreateInput): Promise<{
    record: InboundOrderRecord;
    event: InboundOrderEvent;
  }> {
    const status: InboundOrderRecordStatus = "received";
    const sourceType: InboundOrderSourceType = "manual";

    return this.repository.createManualRecordWithEvent({
      record: {
        organizationId: args.organizationId,
        sourceId: args.sourceId ?? null,
        sourceType,
        sourceLabel: args.sourceLabel ?? "Manual internal intake",
        sourceTrustLevel: "manual_internal",
        sourceRecordId: args.sourceRecordId ?? null,
        sourceMessageId: args.sourceMessageId ?? null,
        status,
        requiresHumanDecision: args.requiresHumanDecision ?? false,
        reviewRequiredReason: args.reviewRequiredReason ?? null,
        externalReference: args.externalReference ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        payloadHash: args.payloadHash ?? null,
        rawPayloadJson: args.rawPayloadJson ?? {},
        normalizedPayloadJson: args.normalizedPayloadJson ?? {},
        extractedCustomerJson: args.extractedCustomerJson ?? {},
        extractedOrderJson: args.extractedOrderJson ?? {},
        extractedShippingJson: args.extractedShippingJson ?? {},
        receivedAt: new Date(),
      },
      event: {
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        actorType: "user",
        eventType: "record.received",
        fromStatus: null,
        toStatus: status,
        message: "Manual inbound order record created",
        metadataJson: {
          sourceType,
          sourceTrustLevel: "manual_internal",
        },
      },
    });
  }
}

export const inboundOrderService = new InboundOrderService();
