import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_SOURCE } from "@/lib/config";
import type { KnowledgeIndex } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

export function emptyIndex(): KnowledgeIndex {
  return {
    version: 3,
    source: {
      name: KNOWLEDGE_SOURCE.name,
      rootUrl: KNOWLEDGE_SOURCE.rootUrl,
      spaceId: KNOWLEDGE_SOURCE.spaceId,
      rootNodeToken: KNOWLEDGE_SOURCE.rootNodeToken,
    },
    sync: {
      status: "empty",
      documentCount: 0,
      chunkCount: 0,
      embeddedChunkCount: 0,
      warnings: [],
    },
    documents: [],
    chunks: [],
    resources: [],
  };
}

export async function readIndex(): Promise<KnowledgeIndex> {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as KnowledgeIndex;
    return {
      ...parsed,
      resources: parsed.resources || [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyIndex();
    }
    throw error;
  }
}

export async function writeIndex(index: KnowledgeIndex): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryPath = `${INDEX_PATH}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(index), "utf8");
  await fs.rename(temporaryPath, INDEX_PATH);
}
