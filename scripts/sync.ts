import { syncKnowledgeBase } from "../src/lib/sync";
import { RESOURCE_CATEGORIES } from "../src/lib/types";

async function main() {
  const index = await syncKnowledgeBase();
  const resourceCategories = Object.fromEntries(
    RESOURCE_CATEGORIES.map((category) => [
      category,
      index.resources.filter((resource) => resource.category === category)
        .length,
    ])
  );

  console.log(
    JSON.stringify(
      {
        status: index.sync.status,
        documents: index.sync.documentCount,
        chunks: index.sync.chunkCount,
        embeddedChunks: index.sync.embeddedChunkCount,
        resources: index.resources.length,
        resourceCategories,
        warnings: index.sync.warnings,
        completedAt: index.sync.completedAt,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
