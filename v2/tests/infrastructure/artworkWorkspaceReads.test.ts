import { describe, expect, test } from "@jest/globals";
import { PostgresArtworkWorkspaceReads } from "../../infrastructure/artwork/postgresArtworkWorkspaceReads";

describe("M4 Artwork workspace PostgreSQL projection", () => {
  test("binds tenant scope and returns typed assignment context without a new file identity", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresArtworkWorkspaceReads({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [{ assignment_id: "assignment-a", artwork_file_id: "file-a", order_id: "order-a", order_line_id: "line-a", purpose: "production", side: "front", source_page_index: null, layer_key: null, layer_order: null, assignment_created_at: new Date("2026-08-17"), file_id: "file-a", display_filename: "front.pdf", content_type: "application/pdf", byte_size: "12", source_kind: "prepress_derived", derived_from_artwork_file_id: "file-source", file_created_at: new Date("2026-08-17"), order_number: "SO-100", customer_display_name: "Acme", line_description: "Signs" }] as T[] }; } } as any);
    await expect(reader.list("org-a", "front")).resolves.toMatchObject([{ assignment: { artworkFileId: "file-a", purpose: "production" }, file: { id: "file-a", derivedFromArtworkFileId: "file-source" } }]);
    expect(calls[0]!.text).toContain("a.organization_id=$1"); expect(calls[0]!.text).toContain("LIMIT 100"); expect(calls[0]!.values).toEqual(["org-a", "%front%"]);
  });
});
