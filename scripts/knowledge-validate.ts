import path from "node:path";
import { discoverKnowledgeDocuments, chunkKnowledgeDocument } from "../server/services/assistant/knowledgeCorpus";

async function main() {
  const root = path.resolve(process.cwd(), "docs", "knowledge");
  const documents = await discoverKnowledgeDocuments(root);
  const chunks = documents.flatMap(chunkKnowledgeDocument);
  if (!documents.length) throw new Error("No approved Markdown files found under docs/knowledge");
  console.log(`[knowledge:validate] Validated ${documents.length} approved documents and ${chunks.length} deterministic chunks.`);
}

main().catch((error) => {
  console.error("[knowledge:validate] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
