import { AuthorityPolicy } from "../../authorization/authorityPolicy.js";
import { V2ApplicationError } from "../../errors/applicationError.js";
import type { AiExecutionContext, AiToolDefinition } from "./contracts.js";
import { isAiHardDenied } from "./contracts.js";

/** Typed registry; no string-to-SQL or direct repository escape hatch exists. */
export class AiToolRegistry {
  private readonly definitions = new Map<string, AiToolDefinition<unknown, unknown>>();
  constructor(private readonly policy = new AuthorityPolicy()) {}
  register<Input, Output>(definition: AiToolDefinition<Input, Output>): void {
    if (!definition.name || isAiHardDenied(definition.name) || this.definitions.has(definition.name))
      throw new V2ApplicationError("VALIDATION_ERROR", "AI tool registration is invalid or permanently denied.");
    if (definition.kind === "read" && definition.confirmationRequired)
      throw new V2ApplicationError("VALIDATION_ERROR", "AI read tools cannot require confirmation.");
    if (definition.kind === "command" && !definition.confirmationRequired)
      throw new V2ApplicationError("VALIDATION_ERROR", "AI commands must require GO confirmation.");
    this.definitions.set(definition.name, definition as AiToolDefinition<unknown, unknown>);
  }
  definition(name: string): AiToolDefinition<unknown, unknown> {
    if (isAiHardDenied(name)) throw new V2ApplicationError("FORBIDDEN", "This operation is permanently unavailable to AI.");
    const definition = this.definitions.get(name);
    if (!definition || definition.status === "unsupported_yet" || definition.status === "permanently_denied")
      throw new V2ApplicationError("NOT_FOUND", "This AI tool is not supported.");
    return definition;
  }
  async executeRead(context: AiExecutionContext, name: string, rawInput: unknown): Promise<unknown> {
    const definition = this.definition(name);
    if (definition.kind !== "read") throw new V2ApplicationError("FORBIDDEN", "AI commands require an explicit GO confirmation.");
    if (!this.policy.decide(context.user, { capability: definition.capability, resource: { organizationId: context.organizationId } }).allowed)
      throw new V2ApplicationError("FORBIDDEN", "The signed-in user is not authorized for this AI read.");
    return definition.execute(context, definition.parseInput(rawInput));
  }
  list(): readonly Pick<AiToolDefinition<unknown, unknown>, "name" | "description" | "kind" | "capability" | "confirmationRequired" | "status">[] {
    return Object.freeze([...this.definitions.values()].map(({ name, description, kind, capability, confirmationRequired, status }) => ({ name, description, kind, capability, confirmationRequired, status })));
  }
}
