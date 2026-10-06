import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { TransactionalClient } from "../persistence/types.js";
import { enterAuthorityMutation, assertStructuralFloor } from "./postgresAuthorityMutation.js";

/** Existing memberships are enrolled by the canonical membership trigger.
 * Rehearsal callers may verify enrollment, never rehydrate deleted authority. */
export class PostgresPermissionBootstrap {
  constructor(private readonly client: TransactionalClient) {}
  async bootstrapLegacyMembership(input: { organizationId: string; userId: string; correlationId: string; businessRequestId: string }): Promise<void> {
    if (!input.correlationId.trim() || !input.businessRequestId.trim()) throw new V2ApplicationError("VALIDATION_ERROR","Permission bootstrap requires correlation and business request identity.");
    await this.client.query("BEGIN");
    try {
      await enterAuthorityMutation(this.client,[input.organizationId]);
      const enrolled=await this.client.query("SELECT 1 FROM v2_staff_authority_enrollments e JOIN user_organizations m ON m.organization_id=e.organization_id AND m.user_id=e.user_id WHERE e.organization_id=$1 AND e.user_id=$2 AND m.is_active",[input.organizationId,input.userId]);
      if(!enrolled.rowCount) throw new V2ApplicationError("CONFLICT","Membership requires canonical first-time enrollment; bootstrap cannot restore authority.");
      await assertStructuralFloor(this.client,input.organizationId);
      await this.client.query("COMMIT");
    } catch(error) { await this.client.query("ROLLBACK"); throw error; }
  }
}
