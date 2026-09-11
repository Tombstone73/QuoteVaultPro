import { Router, type Request, type Response } from "express";
import type { Principal } from "../../authorization/principals.js";
import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { brandedId } from "../../modules/shared/commercialValues.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { OperationContext } from "../../application/operation.js";
import type { CustomerActivityPage, CustomerActivityPageRequest, CustomerCatalogPage, CustomerCatalogPageRequest, CustomerWorkspaceRead } from "../../../infrastructure/compatibility/postgresCustomerWorkspaceRead.js";
import type { AddCustomerInternalNoteInput, UpdateCustomerInput, SetBillingContactInput, SetPrimaryContactInput } from "../../../infrastructure/customers/postgresCustomerContactAdministration.js";

export type CustomerHttpDependencies = Readonly<{
  customers: Readonly<{
    list(organizationId: string, request?: CustomerCatalogPageRequest): Promise<CustomerCatalogPage>;
    read(organizationId: string, customerId: string): Promise<CustomerWorkspaceRead | null>;
    activity?(organizationId: string, customerId: string, request?: CustomerActivityPageRequest): Promise<CustomerActivityPage>;
  }>;
  creation?: Readonly<{
    create(context: OperationContext, input: CustomerCreateInput): Promise<CustomerWorkspaceRead>;
  }>;
  administration?: Readonly<{
    updateCustomer(organizationId: string, principal: Principal, customerId: string, input: UpdateCustomerInput): Promise<void>;
    setPrimaryContact(organizationId: string, principal: Principal, input: SetPrimaryContactInput): Promise<void>;
    setBillingContact(organizationId: string, principal: Principal, input: SetBillingContactInput): Promise<void>;
    addInternalNote(organizationId: string, principal: Principal, input: AddCustomerInternalNoteInput): Promise<string>;
  }>;
  principals: Readonly<{ principal(request: Request, organizationId: string): Promise<Principal> }>;
}>;

export type CustomerCreateInput = Readonly<{
  companyName: string;
  displayName?: string;
  email?: string;
  phone?: string;
}>;

const deny = (response: Response, status: 403 | 404, code: "FORBIDDEN" | "NOT_FOUND", message: string) =>
  response.status(status).json({ ok: false, error: { code, message } });

const fail = (response: Response, error: unknown) => {
  const known = error instanceof V2ApplicationError ? error : null;
  const status = known?.code === "VALIDATION_ERROR" ? 400 : known?.code === "NOT_FOUND" ? 404 : known?.code === "FORBIDDEN" ? 403 : known?.code === "CONFLICT" || known?.code === "STALE_STATE" || known?.code === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
  return response.status(status).json({
    ok: false,
    error: {
      code: known?.code ?? "INTERNAL_ERROR",
      message: known?.publicMessage ?? "Customer creation is unavailable.",
    },
  });
};

const optionalText = (value: unknown, field: string, limit: number): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new V2ApplicationError("VALIDATION_ERROR", `${field} must be text.`);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > limit) throw new V2ApplicationError("VALIDATION_ERROR", `${field} is too long.`);
  return normalized;
};

const createInput = (value: unknown): CustomerCreateInput => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", "A Customer creation object is required.");
  const body = value as Record<string, unknown>;
  const companyName = optionalText(body.companyName, "Company name", 255);
  if (!companyName) throw new V2ApplicationError("VALIDATION_ERROR", "Company name is required.");
  const displayName = optionalText(body.displayName, "Display name", 255);
  const email = optionalText(body.email, "Email", 255);
  const phone = optionalText(body.phone, "Phone", 50);
  return { companyName, ...(displayName ? { displayName } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
};
const requiredText = (body: Record<string, unknown>, field: string, label: string, limit: number) => {
  const value = optionalText(body[field], label, limit); if (!value) throw new V2ApplicationError("VALIDATION_ERROR", `${label} is required.`); return value;
};
const address = (value: unknown, label: string) => {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", `${label} must be an address object.`);
  const source = value as Record<string, unknown>;
  return { ...(optionalText(source.street1, `${label} street`, 255) ? { street1: optionalText(source.street1, `${label} street`, 255) } : {}), ...(optionalText(source.street2, `${label} street`, 255) ? { street2: optionalText(source.street2, `${label} street`, 255) } : {}), ...(optionalText(source.city, `${label} city`, 100) ? { city: optionalText(source.city, `${label} city`, 100) } : {}), ...(optionalText(source.state, `${label} state`, 100) ? { state: optionalText(source.state, `${label} state`, 100) } : {}), ...(optionalText(source.postalCode, `${label} postal code`, 20) ? { postalCode: optionalText(source.postalCode, `${label} postal code`, 20) } : {}), ...(optionalText(source.country, `${label} country`, 100) ? { country: optionalText(source.country, `${label} country`, 100) } : {}) };
};
const updateInput = (value: unknown): UpdateCustomerInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "A Customer correction object is required.");
  const body = value as Record<string, unknown>;
  const terms = body.paymentTerms;
  if (terms !== undefined && terms !== "due_on_receipt" && terms !== "net_15" && terms !== "net_30" && terms !== "net_45" && terms !== "custom") throw new V2ApplicationError("VALIDATION_ERROR", "Payment terms are invalid.");
  if (body.creditLimitCents !== undefined && body.creditLimitCents !== null && (!Number.isSafeInteger(body.creditLimitCents) || (body.creditLimitCents as number) < 0)) throw new V2ApplicationError("VALIDATION_ERROR", "Credit limit must be a non-negative whole-cent amount.");
  if (body.taxExempt !== undefined && typeof body.taxExempt !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Tax exemption must be true or false.");
  if (body.taxExempt === true && !optionalText(body.taxExemptReason, "Tax exemption reason", 500)) throw new V2ApplicationError("VALIDATION_ERROR", "A tax exemption reason is required.");
  return { businessRequestId: requiredText(body, "businessRequestId", "Business request ID", 200), expectedRevision: requiredText(body, "expectedRevision", "Customer revision", 200), companyName: requiredText(body, "companyName", "Company name", 255), ...(optionalText(body.displayName, "Display name", 255) ? { displayName: optionalText(body.displayName, "Display name", 255) } : {}), ...(optionalText(body.email, "Email", 255) ? { email: optionalText(body.email, "Email", 255) } : {}), ...(optionalText(body.phone, "Phone", 50) ? { phone: optionalText(body.phone, "Phone", 50) } : {}), ...(body.billingAddress !== undefined ? { billingAddress: address(body.billingAddress, "Billing address") } : {}), ...(body.shippingAddress !== undefined ? { shippingAddress: address(body.shippingAddress, "Shipping address") } : {}), ...(terms !== undefined ? { paymentTerms: terms as UpdateCustomerInput["paymentTerms"] } : {}), ...(body.creditLimitCents !== undefined ? { creditLimitCents: body.creditLimitCents as number | null } : {}), ...(body.taxExempt !== undefined ? { taxExempt: body.taxExempt as boolean, ...(optionalText(body.taxExemptReason, "Tax exemption reason", 500) ? { taxExemptReason: optionalText(body.taxExemptReason, "Tax exemption reason", 500) } : {}), ...(optionalText(body.taxExemptCertificateRef, "Tax exemption certificate", 255) ? { taxExemptCertificateRef: optionalText(body.taxExemptCertificateRef, "Tax exemption certificate", 255) } : {}) } : {}) };
};
const primaryInput = (customerId: string, value: unknown): SetPrimaryContactInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "A Primary Contact selection is required.");
  const body = value as Record<string, unknown>;
  return { customerId, contactId: requiredText(body, "contactId", "Contact", 200), businessRequestId: requiredText(body, "businessRequestId", "Business request ID", 200), expectedCustomerRevision: requiredText(body, "expectedCustomerRevision", "Customer revision", 200) };
};
const billingInput = (customerId: string, value: unknown): SetBillingContactInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "A billing Contact selection is required.");
  const body = value as Record<string, unknown>;
  if (typeof body.billing !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Billing must be true or false.");
  return { customerId, contactId: requiredText(body, "contactId", "Contact", 200), businessRequestId: requiredText(body, "businessRequestId", "Business request ID", 200), expectedCustomerRevision: requiredText(body, "expectedCustomerRevision", "Customer revision", 200), billing: body.billing };
};
const noteInput = (customerId: string, value: unknown): AddCustomerInternalNoteInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new V2ApplicationError("VALIDATION_ERROR", "An internal Customer note is required.");
  const body = value as Record<string, unknown>;
  return { customerId, businessRequestId: requiredText(body, "businessRequestId", "Business request ID", 200), expectedCustomerRevision: requiredText(body, "expectedCustomerRevision", "Customer revision", 200), note: requiredText(body, "note", "Internal note", 4000) };
};

export const createCustomerRouter = (dependencies: CustomerHttpDependencies) => {
  const router = Router({ mergeParams: true });
  const principalFor = async (request: Request) => {
    const organizationId = (request.params as Record<string, string>).organizationId!;
    const principal = await dependencies.principals.principal(request, organizationId);
    const allowed = new AuthorityPolicy().decide(principal, {
      capability: "customer.view",
      resource: { organizationId },
    }).allowed;
    return { organizationId, principal, allowed };
  };
  router.get("/", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      const query = typeof request.query.q === "string" ? request.query.q : "";
      const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
      const requestedLimit = typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;
      const page = await dependencies.customers.list(organizationId, {
        query,
        ...(cursor ? { cursor } : {}),
        ...(Number.isInteger(requestedLimit) ? { limit: requestedLimit } : {}),
      });
      return response.status(200).json({ ok: true, data: page });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.get("/:customerId", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.params.customerId))
        return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      const customerId = brandedId<"CustomerId">(request.params.customerId);
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), customerId);
      if (!customer) return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.get("/:customerId/activity", async (request, response) => {
    try {
      const { organizationId, allowed } = await principalFor(request);
      if (!allowed) return deny(response, 403, "FORBIDDEN", "Customer access is unavailable.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(request.params.customerId))
        return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      const customerId = brandedId<"CustomerId">(request.params.customerId);
      // Resolve the Customer under the same organization first.  An empty
      // timeline must not become a cross-tenant existence oracle.
      if (!await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), customerId))
        return deny(response, 404, "NOT_FOUND", "Customer is unavailable in this organization.");
      const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
      const requestedLimit = typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;
      if (!dependencies.customers.activity) throw new V2ApplicationError("INTERNAL_ERROR", "Customer activity runtime is unavailable.");
      const activity = await dependencies.customers.activity(brandedId<"OrganizationId">(organizationId), customerId, {
        ...(cursor ? { cursor } : {}),
        ...(Number.isInteger(requestedLimit) ? { limit: requestedLimit } : {}),
      });
      return response.status(200).json({ ok: true, data: activity });
    } catch {
      return deny(response, 403, "FORBIDDEN", "Authenticated access is required.");
    }
  });
  router.post("/", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed)
        return deny(response, 403, "FORBIDDEN", "Customer creation is unavailable.");
      if (!dependencies.creation)
        throw new V2ApplicationError("INTERNAL_ERROR", "Customer creation runtime is unavailable.");
      const customer = await dependencies.creation.create({ organizationId, principal, operationId: "customers.create" }, createInput(request.body));
      return response.status(201).json({ ok: true, data: customer });
    } catch (error) {
      return fail(response, error);
    }
  });
  router.patch("/:customerId", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed) return deny(response, 403, "FORBIDDEN", "Customer correction is unavailable.");
      if (!dependencies.administration) throw new V2ApplicationError("INTERNAL_ERROR", "Customer administration runtime is unavailable.");
      await dependencies.administration.updateCustomer(organizationId, principal, request.params.customerId, updateInput(request.body));
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), brandedId<"CustomerId">(request.params.customerId));
      if (!customer) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch (error) { return fail(response, error); }
  });
  router.put("/:customerId/primary-contact", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed) return deny(response, 403, "FORBIDDEN", "Primary Contact administration is unavailable.");
      if (!dependencies.administration) throw new V2ApplicationError("INTERNAL_ERROR", "Customer administration runtime is unavailable.");
      await dependencies.administration.setPrimaryContact(organizationId, principal, primaryInput(request.params.customerId, request.body));
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), brandedId<"CustomerId">(request.params.customerId));
      if (!customer) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch (error) { return fail(response, error); }
  });
  router.put("/:customerId/billing-contact", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed) return deny(response, 403, "FORBIDDEN", "Billing Contact administration is unavailable.");
      if (!dependencies.administration) throw new V2ApplicationError("INTERNAL_ERROR", "Customer administration runtime is unavailable.");
      await dependencies.administration.setBillingContact(organizationId, principal, billingInput(request.params.customerId, request.body));
      const customer = await dependencies.customers.read(brandedId<"OrganizationId">(organizationId), brandedId<"CustomerId">(request.params.customerId));
      if (!customer) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
      return response.status(200).json({ ok: true, data: customer });
    } catch (error) { return fail(response, error); }
  });
  router.post("/:customerId/internal-notes", async (request, response) => {
    try {
      const { organizationId, principal } = await principalFor(request);
      if (!new AuthorityPolicy().decide(principal, { capability: "customer.edit", resource: { organizationId } }).allowed) return deny(response, 403, "FORBIDDEN", "Internal Customer notes are unavailable.");
      if (!dependencies.administration) throw new V2ApplicationError("INTERNAL_ERROR", "Customer administration runtime is unavailable.");
      const noteId = await dependencies.administration.addInternalNote(organizationId, principal, noteInput(request.params.customerId, request.body));
      return response.status(201).json({ ok: true, data: { noteId } });
    } catch (error) { return fail(response, error); }
  });
  return router;
};
