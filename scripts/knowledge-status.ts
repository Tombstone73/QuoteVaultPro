import "dotenv/config";
import { DrizzleAssistantKnowledgeRepository } from "../server/storage/assistantKnowledge.repo";

async function main() {
  const organizationId = process.argv.find((argument) => argument.startsWith("--organization="))?.slice("--organization=".length);
  const result = await new DrizzleAssistantKnowledgeRepository().status(organizationId);
  console.log(`[knowledge:status] ${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error("[knowledge:status] Failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
