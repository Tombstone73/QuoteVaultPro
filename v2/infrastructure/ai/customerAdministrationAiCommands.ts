import type { AiCommandHandler } from "../../src/modules/ai/assistantApplication.js";
import type { AiExecutionContext, AiPreparedCommand } from "../../src/modules/ai/contracts.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { Principal } from "../../src/authorization/principals.js";
import type { ContactWorkspaceRead } from "../compatibility/postgresContactWorkspaceRead.js";
import type { CustomerAddress, CustomerWorkspaceRead } from "../compatibility/postgresCustomerWorkspaceRead.js";
import type {
  CreateContactInput,
  SetPrimaryContactInput,
  UpdateContactInput,
  UpdateCustomerInput,
} from "../customers/postgresCustomerContactAdministration.js";

type CustomerAdministrationPort = Readonly<{
  updateCustomer(organizationId: string, principal: Principal, customerId: string, input: UpdateCustomerInput): Promise<void>;
  createContact(organizationId: string, principal: Principal, input: CreateContactInput): Promise<string>;
  updateContact(organizationId: string, principal: Principal, contactId: string, input: UpdateContactInput): Promise<void>;
  setPrimaryContact(organizationId: string, principal: Principal, input: SetPrimaryContactInput): Promise<void>;
}>;

export type CustomerAdministrationAiCommandDependencies = Readonly<{
  administration: CustomerAdministrationPort;
  customers: Readonly<{ read(organizationId: string, customerId: string): Promise<CustomerWorkspaceRead | null> }>;
  contacts: Readonly<{ read(organizationId: string, contactId: string): Promise<ContactWorkspaceRead | null> }>;
}>;

type CustomerPatch = Readonly<{
  companyName?: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: CustomerAddress | null;
  shippingAddress?: CustomerAddress | null;
}>;
type ContactPatch = Readonly<{
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  active?: boolean;
}>;
type CustomerUpdateCommand = Readonly<{ customerId: string; expectedRevision: string; value: Omit<UpdateCustomerInput, "businessRequestId" | "expectedRevision"> }>;
type ContactAddCommand = Readonly<{ customerId: string; expectedCustomerRevision: string; firstName: string; lastName: string; email?: string; phone?: string; title?: string }>;
type ContactUpdateCommand = Readonly<{ contactId: string; customerId: string; expectedCustomerRevision: string; expectedContactRevision: string; value: Omit<UpdateContactInput, "businessRequestId" | "expectedCustomerRevision" | "expectedContactRevision" | "customerId"> }>;
type SetPrimaryCommand = Readonly<{ customerId: string; contactId: string; expectedCustomerRevision: string }>;

const operation = (context: AiExecutionContext, name: string) =>
  ({ principal: context.user, organizationId: context.organizationId, operationId: `ai:prepare:${name}:${context.requestId}` });
const expiry = () => new Date(Date.now() + 5 * 60_000);
const text = (value: unknown, label: string, limit: number, required = false): string | undefined => {
  if (value === undefined || value === null) {
    if (required) throw new V2ApplicationError("VALIDATION_ERROR", `${label} is required.`);
    return undefined;
  }
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit)
    throw new V2ApplicationError("VALIDATION_ERROR", `${label} is invalid.`);
  return value.trim();
};
const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new V2ApplicationError("VALIDATION_ERROR", `${label} must be an object.`);
  return value as Record<string, unknown>;
};
const id = (value: unknown, label: string) => text(value, label, 200, true)!;
const optionalNullableText = (value: unknown, label: string, limit: number): string | null | undefined =>
  value === null ? null : value === undefined ? undefined : text(value, label, limit, true)!;
const address = (value: unknown, label: string): CustomerAddress | null | undefined => {
  if (value === undefined || value === null) return value;
  const input = object(value, label);
  const field = (name: keyof CustomerAddress, max: number) => optionalNullableText(input[name], `${label} ${name}`, max);
  const parsed = {
    street1: field("street1", 255), street2: field("street2", 255), city: field("city", 100),
    state: field("state", 100), postalCode: field("postalCode", 20), country: field("country", 100),
  };
  return Object.freeze(Object.fromEntries(Object.entries(parsed).filter(([, item]) => item !== undefined && item !== null)) as CustomerAddress);
};
const present = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const proposal = (heading: string, lines: readonly string[]) => `${heading}\n\n${lines.join("\n")}\n\nNo changes have been made yet.`;
const reference = (type: string, id: string) => ({ type, id });

const parseCustomerPatch = (raw: unknown): Readonly<{ customerId: string; patch: CustomerPatch }> => {
  const input = object(raw, "Customer update");
  const patch = object(input.patch, "Customer update patch");
  const allowed = new Set(["companyName", "displayName", "email", "phone", "billingAddress", "shippingAddress"]);
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key)))
    throw new V2ApplicationError("VALIDATION_ERROR", "Customer update fields are invalid.");
  return Object.freeze({
    customerId: id(input.customerId, "Customer"),
    patch: Object.freeze({
      ...(present(patch, "companyName") ? { companyName: text(patch.companyName, "Company name", 255, true)! } : {}),
      ...(present(patch, "displayName") ? { displayName: optionalNullableText(patch.displayName, "Display name", 255) } : {}),
      ...(present(patch, "email") ? { email: optionalNullableText(patch.email, "Email", 255) } : {}),
      ...(present(patch, "phone") ? { phone: optionalNullableText(patch.phone, "Phone", 50) } : {}),
      ...(present(patch, "billingAddress") ? { billingAddress: address(patch.billingAddress, "Billing address") } : {}),
      ...(present(patch, "shippingAddress") ? { shippingAddress: address(patch.shippingAddress, "Shipping address") } : {}),
    }),
  });
};

const parseContactAdd = (raw: unknown): Omit<ContactAddCommand, "expectedCustomerRevision"> => {
  const input = object(raw, "Contact creation");
  return Object.freeze({ customerId: id(input.customerId, "Customer"), firstName: text(input.firstName, "First name", 100, true)!, lastName: text(input.lastName, "Last name", 100, true)!, ...(text(input.email, "Email", 255) ? { email: text(input.email, "Email", 255) } : {}), ...(text(input.phone, "Phone", 50) ? { phone: text(input.phone, "Phone", 50) } : {}), ...(text(input.title, "Title", 100) ? { title: text(input.title, "Title", 100) } : {}) });
};

const parseContactPatch = (raw: unknown): Readonly<{ contactId: string; patch: ContactPatch }> => {
  const input = object(raw, "Contact update");
  const patch = object(input.patch, "Contact update patch");
  const allowed = new Set(["firstName", "lastName", "email", "phone", "title", "active"]);
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key)))
    throw new V2ApplicationError("VALIDATION_ERROR", "Contact update fields are invalid.");
  if (present(patch, "active") && typeof patch.active !== "boolean") throw new V2ApplicationError("VALIDATION_ERROR", "Contact active status is invalid.");
  return Object.freeze({ contactId: id(input.contactId, "Contact"), patch: Object.freeze({ ...(present(patch, "firstName") ? { firstName: text(patch.firstName, "First name", 100, true)! } : {}), ...(present(patch, "lastName") ? { lastName: text(patch.lastName, "Last name", 100, true)! } : {}), ...(present(patch, "email") ? { email: optionalNullableText(patch.email, "Email", 255) } : {}), ...(present(patch, "phone") ? { phone: optionalNullableText(patch.phone, "Phone", 50) } : {}), ...(present(patch, "title") ? { title: optionalNullableText(patch.title, "Title", 100) } : {}), ...(present(patch, "active") ? { active: patch.active as boolean } : {}) }) });
};

const customerUpdate = (dependencies: CustomerAdministrationAiCommandDependencies): AiCommandHandler => ({
  name: "customer.update", capability: "customer.edit",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const requested = parseCustomerPatch(raw), current = await dependencies.customers.read(context.organizationId, requested.customerId);
    if (!current) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
    const patch = requested.patch, value = Object.freeze({
      companyName: patch.companyName ?? current.editable.companyName,
      ...(patch.displayName === undefined ? (current.editable.displayName ? { displayName: current.editable.displayName } : {}) : (patch.displayName ? { displayName: patch.displayName } : {})),
      ...(patch.email === undefined ? (current.editable.email ? { email: current.editable.email } : {}) : (patch.email ? { email: patch.email } : {})),
      ...(patch.phone === undefined ? (current.editable.phone ? { phone: current.editable.phone } : {}) : (patch.phone ? { phone: patch.phone } : {})),
      ...(patch.billingAddress === undefined ? (current.editable.billingAddress ? { billingAddress: current.editable.billingAddress } : {}) : (patch.billingAddress ? { billingAddress: patch.billingAddress } : {})),
      ...(patch.shippingAddress === undefined ? (current.editable.shippingAddress ? { shippingAddress: current.editable.shippingAddress } : {}) : (patch.shippingAddress ? { shippingAddress: patch.shippingAddress } : {})),
    });
    const normalized: CustomerUpdateCommand = Object.freeze({ customerId: requested.customerId, expectedRevision: current.revision, value });
    return { commandName: "customer.update", capability: "customer.edit", normalizedInput: normalized, proposal: proposal("Update Customer", [`Customer: ${current.displayName} (${requested.customerId})`, `Revision: ${current.revision}`, `Company name: ${current.editable.companyName} → ${value.companyName}`]), expectedEntityReferences: [reference("customer", requested.customerId)], expiresAt: expiry() };
  },
  execute: async (context, raw) => { const command = raw as CustomerUpdateCommand; await dependencies.administration.updateCustomer(context.organizationId, context.delegatedPrincipal, command.customerId, { ...command.value, expectedRevision: command.expectedRevision, businessRequestId: context.businessRequestId }); return Object.freeze({ customerId: command.customerId, updated: true }); },
});

const contactAdd = (dependencies: CustomerAdministrationAiCommandDependencies): AiCommandHandler => ({
  name: "contact.add", capability: "customer.edit",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const requested = parseContactAdd(raw), customer = await dependencies.customers.read(context.organizationId, requested.customerId);
    if (!customer) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
    if (requested.email && customer.contacts.some((contact) => contact.status === "active" && contact.email?.toLowerCase() === requested.email!.toLowerCase())) throw new V2ApplicationError("CONFLICT", "An active Contact with this email already belongs to the Customer.");
    const normalized: ContactAddCommand = Object.freeze({ ...requested, expectedCustomerRevision: customer.revision });
    return { commandName: "contact.add", capability: "customer.edit", normalizedInput: normalized, proposal: proposal("Add Contact", [`Customer: ${customer.displayName} (${requested.customerId})`, `Contact: ${requested.firstName} ${requested.lastName}`, ...(requested.email ? [`Email: ${requested.email}`] : [])]), expectedEntityReferences: [reference("customer", requested.customerId)], expiresAt: expiry() };
  },
  execute: async (context, raw) => { const command = raw as ContactAddCommand; const contactId = await dependencies.administration.createContact(context.organizationId, context.delegatedPrincipal, { ...command, businessRequestId: context.businessRequestId }); return Object.freeze({ customerId: command.customerId, contactId, created: true }); },
});

const contactUpdate = (dependencies: CustomerAdministrationAiCommandDependencies): AiCommandHandler => ({
  name: "contact.update", capability: "customer.edit",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const requested = parseContactPatch(raw), current = await dependencies.contacts.read(context.organizationId, requested.contactId);
    if (!current) throw new V2ApplicationError("NOT_FOUND", "Contact is unavailable in this organization.");
    const patch = requested.patch, value = Object.freeze({ firstName: patch.firstName ?? current.firstName, lastName: patch.lastName ?? current.lastName, ...(patch.email === undefined ? (current.email ? { email: current.email } : {}) : (patch.email ? { email: patch.email } : {})), ...(patch.phone === undefined ? (current.phone ? { phone: current.phone } : {}) : (patch.phone ? { phone: patch.phone } : {})), ...(patch.title === undefined ? (current.title ? { title: current.title } : {}) : (patch.title ? { title: patch.title } : {})), active: patch.active ?? (current.status === "active") });
    const normalized: ContactUpdateCommand = Object.freeze({ contactId: requested.contactId, customerId: current.customerId, expectedCustomerRevision: current.customerRevision, expectedContactRevision: current.revision, value });
    return { commandName: "contact.update", capability: "customer.edit", normalizedInput: normalized, proposal: proposal("Update Contact", [`Customer: ${current.customerName} (${current.customerId})`, `Contact: ${current.displayName} (${requested.contactId})`, `Revision: ${current.revision}`]), expectedEntityReferences: [reference("customer", current.customerId), reference("customer_contact", requested.contactId)], expiresAt: expiry() };
  },
  execute: async (context, raw) => { const command = raw as ContactUpdateCommand; await dependencies.administration.updateContact(context.organizationId, context.delegatedPrincipal, command.contactId, { ...command.value, customerId: command.customerId, expectedCustomerRevision: command.expectedCustomerRevision, expectedContactRevision: command.expectedContactRevision, businessRequestId: context.businessRequestId }); return Object.freeze({ contactId: command.contactId, updated: true }); },
});

const setPrimary = (dependencies: CustomerAdministrationAiCommandDependencies): AiCommandHandler => ({
  name: "contact.set_primary", capability: "customer.edit",
  prepare: async (context, raw): Promise<AiPreparedCommand> => {
    const input = object(raw, "Primary Contact selection"), customerId = id(input.customerId, "Customer"), contactId = id(input.contactId, "Contact"), customer = await dependencies.customers.read(context.organizationId, customerId);
    if (!customer) throw new V2ApplicationError("NOT_FOUND", "Customer is unavailable in this organization.");
    const contact = customer.contacts.find((candidate) => candidate.contactId === contactId);
    if (!contact || contact.status !== "active") throw new V2ApplicationError("NOT_FOUND", "An active Contact for this Customer is required.");
    const normalized: SetPrimaryCommand = Object.freeze({ customerId, contactId, expectedCustomerRevision: customer.revision });
    return { commandName: "contact.set_primary", capability: "customer.edit", normalizedInput: normalized, proposal: proposal("Set Primary Contact", [`Customer: ${customer.displayName} (${customerId})`, `Primary Contact: ${contact.displayName} (${contactId})`]), expectedEntityReferences: [reference("customer", customerId), reference("customer_contact", contactId)], expiresAt: expiry() };
  },
  execute: async (context, raw) => { const command = raw as SetPrimaryCommand; await dependencies.administration.setPrimaryContact(context.organizationId, context.delegatedPrincipal, { ...command, businessRequestId: context.businessRequestId }); return Object.freeze({ customerId: command.customerId, contactId: command.contactId, primary: true }); },
});

/** CRM commands deliberately exclude Customer creation until that Staff service
 * has a canonical operation-request/idempotency boundary. */
export const customerAdministrationAiCommandHandlers = (dependencies: CustomerAdministrationAiCommandDependencies): readonly AiCommandHandler[] =>
  Object.freeze([customerUpdate(dependencies), contactAdd(dependencies), contactUpdate(dependencies), setPrimary(dependencies)]);
