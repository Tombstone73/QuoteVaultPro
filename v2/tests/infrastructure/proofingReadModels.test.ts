import { describe, expect, test } from "@jest/globals";
import { PostgresProofingTransaction } from "../../infrastructure/proofing/postgresProofingTransaction";
import { brandedId } from "../../src/modules/shared/commercialValues";

const date = new Date("2026-08-25T00:00:00.000Z");
const workRow = { id: "proof-a", organization_id: "org-a", order_document_id: "order-a", order_line_id: "line-a", created_at: date, created_principal_kind: "staff", created_principal_subject: "staff-a", created_staff_actor_user_id: null };
const versionRow = { id: "version-a", organization_id: "org-a", proof_work_id: "proof-a", sequence: 1, created_at: date, created_principal_kind: "staff", created_principal_subject: "staff-a", created_staff_actor_user_id: null, issued_at: date, issued_principal_kind: "staff", issued_principal_subject: "staff-a", issued_staff_actor_user_id: null };

describe("Proofing PostgreSQL read models", () => {
  test("scopes work detail by tenant and keeps immutable evidence and response attached to its exact version", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const client = {
      query: async <T>(text: string, values?: readonly unknown[]) => {
        calls.push({ text, values });
        if (text.startsWith("SELECT * FROM v2_proof_works")) return { rows: values?.[0] === "org-a" ? [workRow] as T[] : [] as T[] };
        if (text.startsWith("SELECT * FROM v2_proof_versions WHERE organization_id=$1 AND proof_work_id")) return { rows: [versionRow] as T[] };
        if (text.startsWith("SELECT proof_version_id,position")) return { rows: [{ proof_version_id: "version-a", position: 0, artwork_assignment_id: "assignment-a", artwork_file_id: "file-a" }] as T[] };
        if (text.startsWith("SELECT * FROM v2_proof_responses")) return { rows: [{ id: "response-a", organization_id: "org-a", proof_version_id: "version-a", outcome: "approved", comment: null, response_origin: "direct", recorded_customer_id: null, responder_principal_kind: "portal", responder_principal_subject: "portal-a", responder_staff_actor_user_id: null, responded_at: date }] as T[] };
        throw new Error(`Unexpected query: ${text}`);
      },
    } as any;
    const repository = new PostgresProofingTransaction(client);
    const detail = await repository.readWork(brandedId<"OrganizationId">("org-a"), brandedId<"ProofWorkId">("proof-a"));
    const foreign = await repository.readWork(brandedId<"OrganizationId">("org-b"), brandedId<"ProofWorkId">("proof-a"));
    expect(detail).toMatchObject({
      work: { proofWorkId: "proof-a", orderId: "order-a", orderLineId: "line-a" },
      versions: [{ version: { proofVersionId: "version-a", artwork: [{ artworkAssignmentId: "assignment-a", artworkFileId: "file-a" }] }, response: { outcome: "approved", origin: "direct" }],
    });
    expect(foreign).toBeNull();
    expect(calls[0]).toMatchObject({ values: ["org-a", "proof-a"] });
    expect(calls[4]).toMatchObject({ values: ["org-b", "proof-a"] });
    expect(calls[0]!.text).toContain("organization_id=$1 AND id=$2");
  });

  test("bounds the queue to its tenant and projects only owner context plus latest proof state", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const client = { query: async <T>(text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      return { rows: [{ ...workRow, display_number: "SO-100", customer_display_name: "Acme", line_description: "Signs", latest_sequence: 2, latest_issued_at: date, latest_outcome: "revision_requested" }] as T[] };
    } } as any;
    const repository = new PostgresProofingTransaction(client);
    await expect(repository.listWorkQueue(brandedId<"OrganizationId">("org-a"), 25)).resolves.toEqual([{
      work: expect.objectContaining({ proofWorkId: "proof-a" }), orderNumber: "SO-100", customerDisplayName: "Acme", lineDescription: "Signs",
      latest: { sequence: 2, issuedAt: date.toISOString(), outcome: "revision_requested" },
    }]);
    expect(calls[0]!.text).toContain("WHERE w.organization_id=$1");
    expect(calls[0]!.values).toEqual(["org-a", 25]);
  });
});
