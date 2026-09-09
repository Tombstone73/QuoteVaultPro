import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("Orders artwork thumbnail viewer", () => {
  test("uses the canonical viewer directly and keeps canonical download resolution", () => {
    const orders = source("client/src/pages/orders.tsx");
    const viewer = source("client/src/components/AttachmentViewerDialog.tsx");

    expect(orders).toContain('const openArtworkViewer = async');
    expect(orders).toContain('toAttachmentViewerAttachments(attachments)');
    expect(orders).toContain('setAttachmentViewerOpen(true)');
    expect(orders).toContain('resolveOrdersArtworkViewerIndex(viewerAttachments, target)');
    expect(orders).toContain('fileRecordId values intact');
    expect((orders.match(/<AttachmentViewerDialog/g) || []).length).toBe(1);
    expect(viewer).toContain('resolveArtworkDownloadUrl(currentAttachment?.fileRecordId');
  });

  test("contains a localized accessible thumbnail event boundary without changing row navigation", () => {
    const orders = source("client/src/pages/orders.tsx");

    expect(orders).toContain('e.preventDefault();\n                    e.stopPropagation();\n                    void openArtworkViewer');
    expect(orders).toContain('onPointerDown={(e) => e.stopPropagation()}');
    expect(orders).toContain('type="button"');
    expect(orders).toContain('aria-label="Open artwork viewer"');
    expect(orders).toContain('navigate(ROUTES.orders.detail(order.id)');
  });

  test("fails safely when no artwork rows remain", () => {
    const orders = source("client/src/pages/orders.tsx");
    expect(orders).toContain('This order no longer has a viewable artwork file.');
    expect(orders).toContain('That artwork is no longer available on this order.');
    expect(orders).toContain('Failed to open artwork viewer');
  });
});
