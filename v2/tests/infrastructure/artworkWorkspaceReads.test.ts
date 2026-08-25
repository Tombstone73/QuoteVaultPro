import { describe, expect, test } from "@jest/globals";
import { PostgresArtworkWorkspaceReads } from "../../infrastructure/artwork/postgresArtworkWorkspaceReads";

const row = (assignmentId = "assignment-a") => ({ assignment_id: assignmentId, artwork_file_id: "file-a", order_id: "order-a", order_line_id: "line-a", purpose: "production", side: "front", source_page_index: 0, layer_key: "ink", layer_order: 1, assignment_created_at: new Date("2026-08-17"), file_id: "file-a", original_filename: "front-original.pdf", display_filename: "front.pdf", content_type: "application/pdf", byte_size: "12", source_kind: "prepress_derived", page_count: 2, detected_width_microns: 100000, detected_height_microns: 200000, derived_from_artwork_file_id: "file-source", file_created_at: new Date("2026-08-17"), order_number: "SO-100", customer_id: "customer-a", customer_display_name: "Acme", line_description: "Signs" });

describe("M6 Artwork workspace PostgreSQL projection", () => {
  test("binds tenant scope and returns typed assignment context without a new file identity", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresArtworkWorkspaceReads({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [row()] as T[] }; } } as any);
    await expect(reader.list("org-a", "front")).resolves.toMatchObject([{ assignment: { artworkFileId: "file-a", purpose: "production", side: "front", sourcePageIndex: 0, layerKey: "ink", layerOrder: 1 }, file: { id: "file-a", originalFilename: "front-original.pdf", pageCount: 2, derivedFromArtworkFileId: "file-source" }, customerId: "customer-a" }]);
    expect(calls[0]!.text).toContain("a.organization_id=$1"); expect(calls[0]!.text).toContain("LIMIT 100"); expect(calls[0]!.values).toEqual(["org-a", "%front%"]);
  });

  test("reads one Artwork file under tenant scope and keeps all assignments rather than choosing one", async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const reader = new PostgresArtworkWorkspaceReads({ query: async <T>(text: string, values?: readonly unknown[]) => { calls.push({ text, values }); return { rows: [row("assignment-a"), { ...row("assignment-b"), purpose: "proof", side: "back", order_line_id: "line-b" }] as T[] }; } } as any);
    await expect(reader.get("org-a", "file-a")).resolves.toMatchObject({ file: { id: "file-a", detectedWidthMicrons: 100000 }, assignments: [{ assignment: { id: "assignment-a" } }, { assignment: { id: "assignment-b", purpose: "proof", side: "back" } }] });
    expect(calls[0]!.text).toContain("f.organization_id=$1 AND f.id=$2"); expect(calls[0]!.values).toEqual(["org-a", "file-a"]);
  });
});
