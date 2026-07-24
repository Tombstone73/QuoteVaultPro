import "dotenv/config";
import path from "node:path";
import { DrizzleAssistantKnowledgeRepository } from "../server/storage/assistantKnowledge.repo";
import { chunkKnowledgeDocument, discoverKnowledgeDocuments } from "../server/services/assistant/knowledgeCorpus";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const root = path.resolve(process.cwd(), "docs", "knowledge");
  // A dry run deliberately has no database dependency: it validates exactly
  // what would be eligible for sync and makes no schema/data mutation. This
  // keeps CI and a newly checked-out branch safe before migration 0134 is
  // applied to its local development database.
  if (dryRun) {
    const documents = await discoverKnowledgeDocuments(root);
    const chunks = documents.reduce((total, document) => total + chunkKnowledgeDocument(document).length, 0);
    console.log(`[knowledge:sync] Dry run: ${JSON.stringify({ discovered: documents.length, chunks, dryRun: true, databaseRead: false })}`);
    return;
  }
  const result = await new DrizzleAssistantKnowledgeRepository().syncCuratedCorpus(root, { dryRun });
  console.log(`[knowledge:sync] ${dryRun ? "Dry run: " : ""}${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error("[knowledge:sync] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
