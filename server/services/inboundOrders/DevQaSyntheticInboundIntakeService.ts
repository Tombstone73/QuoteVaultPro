import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { inboundOrderEvents, inboundOrderFiles, inboundOrderRecords, inboundOrderSources, type InboundOrderRecord } from "@shared/schema";
import type { DevQaSyntheticInboundCreateRequest } from "@shared/inboundOrdersApi";
import { db } from "../../db";

const SOURCE_NAME = "DEV QA Synthetic Inbound";
const PROVIDER = "dev_qa_synthetic";
export type DevQaSyntheticInboundCreateResult = { record: InboundOrderRecord; replayed: boolean };

/** Emulates only provider-to-intake ingress; it never creates a mailbox or Order. */
export class DevQaSyntheticInboundIntakeService {
  constructor(private readonly dbInstance = db) {}
  async ingest(args: { organizationId: string; actorUserId: string; input: DevQaSyntheticInboundCreateRequest }): Promise<DevQaSyntheticInboundCreateResult> {
    const source = await this.ensureSource(args.organizationId, args.actorUserId);
    const sourceMessageId = args.input.sourceMessageId.trim();
    const idempotencyKey = `${PROVIDER}:${sourceMessageId}`;
    const receivedAt = new Date(args.input.receivedAt);
    const attachments = args.input.attachments ?? [];
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ sourceMessageId, sender: args.input.sender, recipient: args.input.recipient, subject: args.input.subject ?? null, bodyText: args.input.bodyText ?? null, receivedAt: receivedAt.toISOString(), attachments })).digest("hex");
    const [existing] = await this.dbInstance.select().from(inboundOrderRecords).where(and(eq(inboundOrderRecords.organizationId,args.organizationId),eq(inboundOrderRecords.sourceId,source.id),eq(inboundOrderRecords.idempotencyKey,idempotencyKey))).limit(1);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new Error("Synthetic inbound source message was retried with a different payload.");
      return { record: existing, replayed: true };
    }
    const result = await this.dbInstance.transaction(async tx => {
      const [created] = await tx.insert(inboundOrderRecords).values({
        organizationId:args.organizationId, sourceId:source.id, sourceType:"email", sourceLabel:SOURCE_NAME, sourceTrustLevel:"semi_trusted_email", sourceRecordId:sourceMessageId, sourceMessageId, status:"needs_review", requiresHumanDecision:true, reviewRequiredReason:"DEV QA synthetic inbound message needs staff review.", externalReference:args.input.subject?.trim()||sourceMessageId, idempotencyKey, payloadHash,
        rawPayloadJson:{intakeMode:"DEV_QA_SYNTHETIC",provider:PROVIDER,messageId:sourceMessageId,sender:args.input.sender,recipient:args.input.recipient,subject:args.input.subject??null,bodyText:args.input.bodyText??null,receivedAt:receivedAt.toISOString(),attachments},
        normalizedPayloadJson:{intakeMode:"DEV_QA_SYNTHETIC",source:{type:"email",provider:PROVIDER,messageId:sourceMessageId},sender:args.input.sender,recipient:args.input.recipient,subject:args.input.subject??null,bodyText:args.input.bodyText??null,attachments},
        extractedCustomerJson:{senderName:args.input.sender.name??null,senderEmail:args.input.sender.email??null}, extractedOrderJson:{subject:args.input.subject??null,bodyText:args.input.bodyText??null,attachments}, extractedShippingJson:{}, receivedAt,
      }).onConflictDoNothing({target:[inboundOrderRecords.organizationId,inboundOrderRecords.sourceId,inboundOrderRecords.idempotencyKey]}).returning();
      if (!created) return null;
      if (attachments.length) await tx.insert(inboundOrderFiles).values(attachments.map(attachment=>({organizationId:args.organizationId,inboundRecordId:created.id,sourceFilename:attachment.fileName,role:"other" as const,mimeType:attachment.mimeType??null,sizeBytes:attachment.sizeBytes??null,checksum:attachment.checksum??null,status:"uploaded" as const,providerAttachmentId:attachment.attachmentId??null,providerMessageId:sourceMessageId,contentDisposition:attachment.contentDisposition??null,metadataJson:{intakeMode:"DEV_QA_SYNTHETIC",provider:PROVIDER,attachmentState:"metadata_only",providerMessageId:sourceMessageId},reviewNotes:"Synthetic DEV QA attachment metadata; no provider file was fetched."})));
      await tx.insert(inboundOrderEvents).values({organizationId:args.organizationId,inboundRecordId:created.id,actorUserId:args.actorUserId,actorType:"user",eventType:"synthetic.dev_qa_candidate_created",fromStatus:null,toStatus:"needs_review",message:"DEV QA synthetic inbound candidate created for canonical review.",metadataJson:{intakeMode:"DEV_QA_SYNTHETIC",provider:PROVIDER,sourceMessageId,attachmentMetadataCount:attachments.length,createsQuote:false,createsOrder:false,invokesProvider:false}});
      return created;
    });
    if (result) return {record:result,replayed:false};
    const [conflicted] = await this.dbInstance.select().from(inboundOrderRecords).where(and(eq(inboundOrderRecords.organizationId,args.organizationId),eq(inboundOrderRecords.sourceId,source.id),eq(inboundOrderRecords.idempotencyKey,idempotencyKey))).limit(1);
    if (!conflicted) throw new Error("Synthetic inbound intake conflict could not be resolved.");
    if (conflicted.payloadHash !== payloadHash) throw new Error("Synthetic inbound source message was retried with a different payload.");
    return {record:conflicted,replayed:true};
  }
  private async ensureSource(organizationId:string,actorUserId:string) {
    const where=and(eq(inboundOrderSources.organizationId,organizationId),eq(inboundOrderSources.sourceType,"email"),eq(inboundOrderSources.name,SOURCE_NAME));
    const [existing]=await this.dbInstance.select().from(inboundOrderSources).where(where).limit(1); if(existing)return existing;
    const [created]=await this.dbInstance.insert(inboundOrderSources).values({organizationId,sourceType:"email",name:SOURCE_NAME,status:"active",sourceTrustLevel:"semi_trusted_email",authMode:"system",externalAccountId:PROVIDER,settingsJson:{intakeMode:"DEV_QA_SYNTHETIC",provider:PROVIDER},createdByUserId:actorUserId}).onConflictDoNothing().returning();
    if(created)return created; const [conflicted]=await this.dbInstance.select().from(inboundOrderSources).where(where).limit(1); if(!conflicted)throw new Error("Synthetic inbound source conflict could not be resolved."); return conflicted;
  }
}
export const devQaSyntheticInboundIntakeService = new DevQaSyntheticInboundIntakeService();
