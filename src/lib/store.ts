import fs from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_SOURCE } from "@/lib/config";
import { sanitizeResourceUrl } from "@/lib/resources";
import type { KnowledgeIndex } from "@/lib/types";

const DATA_DIR =
  process.env.KNOWLEDGE_DATA_DIR || path.join(process.cwd(), "data");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

type IndexCacheEntry = {
  fingerprint: string;
  index: KnowledgeIndex;
};

/**
 * index.json 含全部向量，可达几十 MB；每个请求重新 readFile + JSON.parse
 * 会把几百毫秒花在解析上。按文件指纹缓存解析结果，跨请求复用同一对象。
 * 返回的索引是共享只读对象，调用方不得原地修改。
 */
const indexCacheSlot = ((
  globalThis as typeof globalThis & {
    __knowledgeIndexCache?: { entry: IndexCacheEntry | null };
  }
).__knowledgeIndexCache ||= { entry: null });

function fileFingerprint(stat: {
  mtimeMs: number;
  size: number;
  ino: number | bigint;
}): string {
  return `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
}

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

function sanitizeIndex(parsed: KnowledgeIndex): KnowledgeIndex {
  const resources = new Map<
    string,
    KnowledgeIndex["resources"][number]
  >();
  for (const resource of parsed.resources || []) {
    const sanitizedUrl = sanitizeResourceUrl(resource.url);
    if (!sanitizedUrl) {
      continue;
    }

    const sanitized = {
      ...resource,
      url: sanitizedUrl,
      normalizedUrl: sanitizedUrl,
      mentions: resource.mentions.map((mention) => ({
        ...mention,
        documentUrl:
          sanitizeResourceUrl(mention.documentUrl) ||
          KNOWLEDGE_SOURCE.rootUrl,
      })),
    };
    const existing = resources.get(sanitizedUrl);
    if (existing) {
      existing.mentions.push(
        ...sanitized.mentions.filter(
          (mention) =>
            !existing.mentions.some(
              (current) =>
                current.documentId === mention.documentId &&
                current.context === mention.context
            )
        )
      );
    } else {
      resources.set(sanitizedUrl, sanitized);
    }
  }

  return {
    ...parsed,
    resources: [...resources.values()],
  };
}

export async function readIndex(): Promise<KnowledgeIndex> {
  let fingerprint: string;
  try {
    fingerprint = fileFingerprint(await fs.stat(INDEX_PATH));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      indexCacheSlot.entry = null;
      return emptyIndex();
    }
    throw error;
  }

  const cached = indexCacheSlot.entry;
  if (cached && cached.fingerprint === fingerprint) {
    return cached.index;
  }

  try {
    const raw = await fs.readFile(INDEX_PATH, "utf8");
    const index = sanitizeIndex(JSON.parse(raw) as KnowledgeIndex);
    indexCacheSlot.entry = { fingerprint, index };
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      indexCacheSlot.entry = null;
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
  indexCacheSlot.entry = {
    fingerprint: fileFingerprint(await fs.stat(INDEX_PATH)),
    index: sanitizeIndex(index),
  };
}
