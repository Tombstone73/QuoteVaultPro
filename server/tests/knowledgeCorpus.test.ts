import { chunkKnowledgeDocument, parseKnowledgeDocument } from "../services/assistant/knowledgeCorpus";

const validDocument = `---
slug: order-lifecycle
title: Order lifecycle
category: orders
version: 2026-07
status: active
audience: staff
permission_tags: [orders.view]
route_patterns: [/orders]
entity_types: [order]
feature_tags: [production]
---
# Start
Create an order with a customer and line items.

## Production
Routing determines the required production work.`;

describe("knowledge corpus parsing", () => {
  it("parses approved declarative frontmatter and produces stable chunks", () => {
    const document = parseKnowledgeDocument(validDocument, "docs/knowledge/order-lifecycle.md");
    const first = chunkKnowledgeDocument(document, 80);
    const second = chunkKnowledgeDocument(document, 80);

    expect(document.metadata.slug).toBe("order-lifecycle");
    expect(document.metadata.permission_tags).toEqual(["orders.view"]);
    expect(first).toEqual(second);
    expect(first.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
    expect(first[1].headingPath).toBe("Start > Production");
  });

  it("rejects executable content and unsupported frontmatter", () => {
    expect(() => parseKnowledgeDocument(validDocument.replace("# Start", "<script>alert(1)</script>\n# Start"), "unsafe.md"))
      .toThrow("disallowed executable");
    expect(() => parseKnowledgeDocument(validDocument.replace("title: Order lifecycle", "title: Order lifecycle\nunknown: no"), "unknown.md"))
      .toThrow("invalid knowledge metadata");
  });

  it("rejects frontmatter without a stable slug/version", () => {
    expect(() => parseKnowledgeDocument(validDocument.replace("slug: order-lifecycle\n", ""), "missing.md"))
      .toThrow("invalid knowledge metadata");
  });
});
