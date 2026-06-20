import fs from "node:fs/promises";
import path from "node:path";
import {
  embedTexts,
  getEmbeddingProviderName,
} from "../src/lib/embeddings";
import { readIndex, writeIndex } from "../src/lib/store";

const PROGRESS_PATH = path.join(
  process.cwd(),
  "data",
  "reembed-progress.jsonl"
);
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 5_000;

type ProgressHeader = {
  type: "header";
  provider: string;
  sourceCompletedAt?: string;
  chunkCount: number;
};

type ProgressEmbedding = {
  type: "embedding";
  id: string;
  embedding: number[];
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadProgress(
  header: ProgressHeader
): Promise<Map<string, number[]>> {
  try {
    const lines = (await fs.readFile(PROGRESS_PATH, "utf8"))
      .split("\n")
      .filter(Boolean);
    const existingHeader = JSON.parse(lines[0]) as ProgressHeader;
    if (
      existingHeader.type !== "header" ||
      existingHeader.provider !== header.provider ||
      existingHeader.sourceCompletedAt !== header.sourceCompletedAt ||
      existingHeader.chunkCount !== header.chunkCount
    ) {
      throw new Error("stale progress");
    }

    const embeddings = new Map<string, number[]>();
    for (const line of lines.slice(1)) {
      const record = JSON.parse(line) as ProgressEmbedding;
      if (
        record.type === "embedding" &&
        record.id &&
        record.embedding.length
      ) {
        embeddings.set(record.id, record.embedding);
      }
    }
    return embeddings;
  } catch {
    await fs.mkdir(path.dirname(PROGRESS_PATH), { recursive: true });
    await fs.writeFile(PROGRESS_PATH, `${JSON.stringify(header)}\n`, "utf8");
    return new Map();
  }
}

async function main() {
  const index = await readIndex();
  const provider = getEmbeddingProviderName();
  if (!provider) {
    throw new Error("当前未配置可用的向量模型。");
  }

  const startedAt = new Date().toISOString();
  const header: ProgressHeader = {
    type: "header",
    provider,
    sourceCompletedAt: index.sync.completedAt,
    chunkCount: index.chunks.length,
  };
  const embeddings = await loadProgress(header);
  const pending = index.chunks.filter((chunk) => !embeddings.has(chunk.id));

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    const vectors = await embedTexts(
      batch.map((chunk) => chunk.contextualText),
      "document"
    );
    const records = batch.map((chunk, position) => {
      const embedding = vectors[position];
      embeddings.set(chunk.id, embedding);
      return JSON.stringify({
        type: "embedding",
        id: chunk.id,
        embedding,
      } satisfies ProgressEmbedding);
    });
    await fs.appendFile(PROGRESS_PATH, `${records.join("\n")}\n`, "utf8");

    const completed = embeddings.size;
    console.log(
      `向量重建进度：${completed}/${index.chunks.length}（${Math.round(
        (completed / index.chunks.length) * 100
      )}%）`
    );
    if (start + BATCH_SIZE < pending.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  index.chunks = index.chunks.map((chunk) => ({
    ...chunk,
    embedding: embeddings.get(chunk.id),
  }));
  const completedAt = new Date().toISOString();
  index.sync = {
    ...index.sync,
    status: index.sync.warnings.length ? "partial" : "ready",
    startedAt,
    completedAt,
    embeddedChunkCount: index.chunks.length,
    embeddingProvider: provider,
  };
  await writeIndex(index);
  await fs.rm(PROGRESS_PATH, { force: true });

  console.log(
    JSON.stringify(
      {
        status: index.sync.status,
        documents: index.documents.length,
        chunks: index.chunks.length,
        embeddedChunks: index.sync.embeddedChunkCount,
        embeddingProvider: index.sync.embeddingProvider,
        completedAt,
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
