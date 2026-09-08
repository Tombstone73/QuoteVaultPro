import type { Capability } from "../../authorization/capabilities.js";
import type { Principal, StaffPrincipal } from "../../authorization/principals.js";

/** Server-derived facts only. Model/tool input never supplies tenant identity. */
export type AiExecutionContext = Readonly<{
  organizationId: string;
  user: StaffPrincipal;
  conversationId: string;
  requestId: string;
  locale?: string;
  timeZone?: string;
}>;

export type AiToolKind = "read" | "command";
export type AiCommandState = "pending_confirmation" | "confirmed" | "executing" | "succeeded" | "failed" | "expired" | "cancelled";
export type AiToolStatus = "available_read" | "available_write_with_go" | "unsupported_yet" | "permanently_denied";

export type AiToolDefinition<Input, Output> = Readonly<{
  name: string;
  description: string;
  kind: AiToolKind;
  capability: Capability;
  confirmationRequired: boolean;
  status: AiToolStatus;
  /** Explicit schema functions keep the tool plane independent of an LLM SDK. */
  parseInput(input: unknown): Input;
  execute(context: AiExecutionContext | Readonly<{ organizationId: string; principal: Principal }>, input: Input): Promise<Output>;
}>;

export type AiPreparedCommand = Readonly<{
  commandName: string;
  capability: Capability;
  normalizedInput: unknown;
  proposal: string;
  expectedEntityReferences: readonly Readonly<{ type: string; id?: string }>[];
  expiresAt: Date;
}>;

export type AiPendingCommand = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  conversationId: string;
  commandName: string;
  capability: Capability;
  normalizedInput: unknown;
  proposal: string;
  proposalFingerprint: string;
  state: AiCommandState;
  expiresAt: Date;
  businessRequestId: string;
  createdAt: Date;
  updatedAt: Date;
  result?: unknown;
  failureCode?: string;
}>;

export type AiConversation = Readonly<{ id: string; organizationId: string; userId: string; title?: string; createdAt: Date; updatedAt: Date }>;
export type AiConversationMessage = Readonly<{ id: string; conversationId: string; organizationId: string; userId: string; role: "user" | "assistant" | "tool" | "system"; content: string; toolName?: string; createdAt: Date }>;

export const aiHardDeniedToolNames = Object.freeze([
  "organization.delete", "organization.transfer_ownership", "organization.teardown",
  "developer.infrastructure", "database.sql", "secrets.read", "audit.disable",
  "stripe.direct", "quickbooks.direct", "gmail.direct", "finance.charge", "finance.refund",
] as const);
export type AiHardDeniedToolName = (typeof aiHardDeniedToolNames)[number];
export const isAiHardDenied = (name: string): boolean => (aiHardDeniedToolNames as readonly string[]).includes(name);

/** Prompt policy informs a provider but never replaces authorization below. */
export const v2AiSystemPolicy = `You are the PrintersHero V2 assistant. Server context defines organization and user identity. Tools are authoritative: never invent results or claim completion before a successful tool result. Reads may be performed only through permitted tools. Writes require an exact pending proposal and the literal confirmation GO. Never request or reveal secrets, provider credentials, arbitrary SQL, internal infrastructure actions, cross-tenant data, or financial/provider mutations. Pricing comes only from canonical pricing tools. Unsupported requests must be stated plainly.`;
