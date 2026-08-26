import type { OperationContext } from "../../application/operation.js";
import { requireOperationPrincipalScope } from "../../application/operation.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { failure, success, type ApplicationResult, V2ApplicationError } from "../../errors/applicationError.js";
import type { InvoiceId, OrderId } from "../shared/commercialValues.js";
import { brandedId, type InvoiceCheckpointId, type OrganizationId } from "../shared/commercialValues.js";
import { canonicalJson, type BusinessRequestId } from "../shared/commercialValues.js";
import { createHash, randomUUID } from "node:crypto";
import { principalSubject, staffActorId } from "../../authorization/principals.js";
import type { BillingReadPort, DraftInvoiceReadModel, InvoiceListRequest, InvoiceListItem, IssuedInvoiceCheckpoint, IssuedInvoiceResult, IssueInvoiceInput } from "./contracts.js";

export interface BillingReadRunner { read<T>(action: (port: BillingReadPort) => Promise<T>): Promise<T>; }
type Actor=Readonly<{principalKind:OperationContext["principal"]["kind"];principalSubject:string;staffActorUserId?:string}>;
type Reservation=Readonly<{kind:"new"|"resumed"|"replay";request:Readonly<{id:string;resultJson:unknown|null}>}>;
export type LockedInvoice=Readonly<{invoice:Readonly<{id:string;organization_id:string;sales_order_document_id:string;invoice_state:"draft"|"issued"|"void";customer_id:string|null;contact_id:string|null;purchase_order_number:string|null;currency:string;terms_code:string|null;source_sales_state_token:string;synchronization_version:string;subtotal_cents:string;tax_total_cents:string;total_cents:string;sales_adjustment_cents:string;sales_adjustment_reason:string|null;tax_context_reference:string|null;tax_calculator_version:string;tax_evidence:unknown;issued_at:Date|null;voided_at:Date|null;created_at:Date;updated_at:Date}>;order:Readonly<{id:string;customer_id:string|null;contact_id:string|null;currency:string;terms_json:unknown;revision:string;commercial_state:"open"|"cancelled"}>;lines:readonly Readonly<{source_sales_line_id:string;product_id:string;description:string;quantity:number;selling_unit_cents:string;selling_line_cents:string;sales_pricing_evidence_fingerprint:string}>[]}>;
export interface BillingIssueTransaction {
  reserve(input:Readonly<{organizationId:string;operation:string;businessRequestId:string;payloadFingerprint:string}&Actor>):Promise<Reservation>;
  lockInvoice(organizationId:OrganizationId,invoiceId:InvoiceId):Promise<LockedInvoice|null>;
  issue(input:Readonly<{organizationId:OrganizationId;invoiceId:InvoiceId}&Actor>):Promise<LockedInvoice["invoice"]|null>;
  customerPresentation(input:Readonly<{organizationId:OrganizationId;customerId?:string;contactId?:string}>):Promise<IssuedInvoiceCheckpoint["customerPresentation"]>;
  buildCheckpoint(input:Readonly<{organizationId:OrganizationId;invoice:LockedInvoice["invoice"];lines:LockedInvoice["lines"];checkpointId:InvoiceCheckpointId;customerPresentation:IssuedInvoiceCheckpoint["customerPresentation"]}&Actor>):IssuedInvoiceCheckpoint;
  writeCheckpoint(input:Readonly<{organizationId:OrganizationId;invoiceId:InvoiceId;checkpoint:IssuedInvoiceCheckpoint}>):Promise<void>;
  attribute(input:Readonly<{organizationId:string;requestId:string;operation:string;invoiceId:string}&Actor>):Promise<void>;
  audit(input:Readonly<{organizationId:string;requestId:string;operation:string;invoiceId:string;orderId:string;checkpointId:string}&Actor>):Promise<void>;
  enqueue(input:Readonly<{organizationId:string;requestId:string;invoiceId:string;orderId:string;checkpointId:string}>):Promise<void>;
  succeed(organizationId:string,requestId:string,result:IssuedInvoiceResult):Promise<void>;
}
export interface BillingIssueTransactionRunner { transaction<T>(action:(transaction:BillingIssueTransaction)=>Promise<T>):Promise<T>; }
const actor=(context:OperationContext):Actor=>({principalKind:context.principal.kind,principalSubject:principalSubject(context.principal),...(staffActorId(context.principal)?{staffActorUserId:staffActorId(context.principal)}:{})});
const fingerprint=(value:unknown)=>`sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
const cents=(value:string)=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed))throw new V2ApplicationError("VALIDATION_ERROR","Invoice money is outside the safe cent range.");return parsed;};

export class BillingApplicationService {
  constructor(private readonly runner: BillingReadRunner, private readonly authority = new AuthorityPolicy(), private readonly issueRunner?: BillingIssueTransactionRunner) {}
  async readInvoice(context: OperationContext, invoiceId: InvoiceId): Promise<ApplicationResult<DraftInvoiceReadModel>> {
    try {
      requireOperationPrincipalScope(context);
      const invoice = await this.runner.read((port) => port.readInvoice(brandedId<"OrganizationId">(context.organizationId), invoiceId));
      if (!invoice) throw new V2ApplicationError("NOT_FOUND", "Invoice was not found.");
      const decision = this.authority.decide(context.principal, { capability: "invoice.view", resource: { organizationId: context.organizationId, customerId: invoice.customerId } });
      if (!decision.allowed) throw new V2ApplicationError("FORBIDDEN", "The principal cannot view this Invoice.");
      return success(invoice);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Invoice could not be read."));
    }
  }
  async readInvoiceForOrder(context: OperationContext, orderId: OrderId): Promise<ApplicationResult<DraftInvoiceReadModel | null>> {
    try {
      requireOperationPrincipalScope(context);
      const invoice = await this.runner.read((port) => port.readInvoiceForOrder(brandedId<"OrganizationId">(context.organizationId), orderId));
      if (!invoice) return success(null);
      if (!this.authority.decide(context.principal, { capability: "invoice.view", resource: { organizationId: context.organizationId, customerId: invoice.customerId } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal cannot view this Invoice.");
      return success(invoice);
    } catch (error) { return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Invoice could not be read.")); }
  }
  async listInvoices(context: OperationContext, request: InvoiceListRequest): Promise<ApplicationResult<readonly InvoiceListItem[]>> {
    try {
      requireOperationPrincipalScope(context);
      const visible = await this.runner.read((port) => port.listInvoices(brandedId<"OrganizationId">(context.organizationId), request));
      const invoices = visible.filter((invoice) => this.authority.decide(context.principal, { capability: "invoice.view", resource: { organizationId: context.organizationId, customerId: invoice.customerId } }).allowed);
      if (!invoices.length && !this.authority.decide(context.principal, { capability: "invoice.view", resource: { organizationId: context.organizationId, customerId: context.principal.kind === "portal" ? context.principal.customerId : undefined } }).allowed)
        throw new V2ApplicationError("FORBIDDEN", "The principal cannot view Invoices.");
      return success(invoices);
    } catch (error) {
      return failure(error instanceof V2ApplicationError ? error : new V2ApplicationError("INTERNAL_ERROR", "Invoices could not be listed."));
    }
  }
  async issueInvoice(context:OperationContext,input:IssueInvoiceInput):Promise<ApplicationResult<IssuedInvoiceResult>>{
    try {
      requireOperationPrincipalScope(context);
      if(!context.businessRequest||context.businessRequest.id!==input.businessRequestId)throw new V2ApplicationError("VALIDATION_ERROR","A matching business request identity is required.");
      if(!this.issueRunner)throw new V2ApplicationError("INTERNAL_ERROR","Invoice issuance is unavailable.");
      return success(await this.issueRunner.transaction(async tx=>{
        const locked=await tx.lockInvoice(brandedId<"OrganizationId">(context.organizationId),input.invoiceId);
        if(!locked)throw new V2ApplicationError("NOT_FOUND","Invoice was not found.");
        const decision=this.authority.decide(context.principal,{capability:"invoice.issue",resource:{organizationId:context.organizationId,customerId:locked.invoice.customer_id??undefined}});
        if(!decision.allowed)throw new V2ApplicationError("FORBIDDEN","The principal cannot issue this Invoice.");
        const operation="billing.invoice.issue.v1", request=await tx.reserve({organizationId:context.organizationId,operation,businessRequestId:input.businessRequestId,payloadFingerprint:fingerprint(input),...actor(context)});
        if(request.kind==="replay")return request.request.resultJson as IssuedInvoiceResult;
        if(locked.invoice.invoice_state!=="draft")throw new V2ApplicationError("CONFLICT","Only a Draft Invoice may be issued.");
        if(locked.order.commercial_state!=="open")throw new V2ApplicationError("CONFLICT","A cancelled Order cannot be issued.");
        if(locked.invoice.source_sales_state_token!==locked.order.revision)throw new V2ApplicationError("CONFLICT","The Draft Invoice is not synchronized with the locked Sales Order.");
        if(locked.invoice.currency!==locked.order.currency||!locked.lines.length)throw new V2ApplicationError("CONFLICT","The Draft Invoice financial snapshot is incomplete.");
        const subtotal=locked.lines.reduce((total,line)=>total+cents(line.selling_line_cents),0)+cents(locked.invoice.sales_adjustment_cents),tax=cents(locked.invoice.tax_total_cents),total=cents(locked.invoice.total_cents);
        if(!Number.isSafeInteger(subtotal)||subtotal!==cents(locked.invoice.subtotal_cents)||total!==subtotal+tax)throw new V2ApplicationError("CONFLICT","The Draft Invoice financial snapshot is inconsistent.");
        const issued=await tx.issue({organizationId:brandedId<"OrganizationId">(context.organizationId),invoiceId:input.invoiceId,...actor(context)});
        if(!issued)throw new V2ApplicationError("CONFLICT","Invoice issuance lost its Draft state.");
        const presentation=await tx.customerPresentation({organizationId:brandedId<"OrganizationId">(context.organizationId),...(issued.customer_id?{customerId:issued.customer_id}:{}),...(issued.contact_id?{contactId:issued.contact_id}:{})});
        const checkpointId=brandedId<"InvoiceCheckpointId">(randomUUID());
        const checkpoint=tx.buildCheckpoint({organizationId:brandedId<"OrganizationId">(context.organizationId),invoice:issued,lines:locked.lines,checkpointId,customerPresentation:presentation,...actor(context)});
        await tx.writeCheckpoint({organizationId:brandedId<"OrganizationId">(context.organizationId),invoiceId:input.invoiceId,checkpoint});
        const invoice:DraftInvoiceReadModel={invoiceId:input.invoiceId,organizationId:brandedId<"OrganizationId">(context.organizationId),sourceOrderId:brandedId<"OrderId">(issued.sales_order_document_id),lifecycle:"issued",...(issued.customer_id?{customerId:brandedId<"CustomerId">(issued.customer_id)}:{}),currency:checkpoint.commercial.currency,synchronizationVersion:issued.synchronization_version,lines:checkpoint.lines.map(line=>({sourceOrderLineId:brandedId<"OrderLineId">(line.lineId),productId:line.productId,description:line.description,quantity:line.quantity,sellingUnitAmount:line.unitAmount,lineAmount:line.lineAmount})),subtotal:checkpoint.commercial.subtotal,taxTotal:checkpoint.commercial.taxTotal,total:checkpoint.commercial.total,createdAt:issued.created_at.toISOString(),updatedAt:issued.updated_at.toISOString()};
        const result={invoice,checkpoint,boundary:{invoiceId:input.invoiceId,status:"issued" as const,checkpointId,silentOrderSynchronization:false as const}};
        await tx.attribute({organizationId:context.organizationId,requestId:request.request.id,operation,invoiceId:input.invoiceId,...actor(context)});await tx.audit({organizationId:context.organizationId,requestId:request.request.id,operation,invoiceId:input.invoiceId,orderId:issued.sales_order_document_id,checkpointId,...actor(context)});await tx.enqueue({organizationId:context.organizationId,requestId:request.request.id,invoiceId:input.invoiceId,orderId:issued.sales_order_document_id,checkpointId});await tx.succeed(context.organizationId,request.request.id,result);return result;
      }));
    } catch(error) {return failure(error instanceof V2ApplicationError?error:new V2ApplicationError("INTERNAL_ERROR","Invoice could not be issued."));}
  }
}
