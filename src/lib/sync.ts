import { createHash } from "node:crypto";
import { KNOWLEDGE_SOURCE } from "@/lib/config";
import { chunkDocument } from "@/lib/chunking";
import {
  embedInBatches,
  getEmbeddingProviderName,
  hasEmbeddingProvider,
} from "@/lib/embeddings";
import {
  fetchWikiDocument,
  getWikiNode,
  walkWikiTree,
} from "@/lib/feishu";
import {
  extractResourceLinks,
  mergeResourceLinks,
} from "@/lib/resources";
import { readIndex, writeIndex } from "@/lib/store";
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeIndex,
} from "@/lib/types";

let activeSync: Promise<KnowledgeIndex> | null = null;

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

async function performSync(): Promise<KnowledgeIndex> {
  const startedAt = new Date().toISOString();
  const previous = await readIndex();
  const previousDocuments = new Map(
    previous.documents.map((document) => [document.id, document])
  );
  const forceRebuild = previous.version < 2;
  const embeddingProvider = getEmbeddingProviderName();
  const providerChanged =
    Boolean(previous.sync.embeddingProvider) &&
    previous.sync.embeddingProvider !== embeddingProvider;
  const previousChunks = new Map<string, KnowledgeChunk[]>();
  for (const chunk of previous.chunks) {
    const chunks = previousChunks.get(chunk.documentId) || [];
    chunks.push(chunk);
    previousChunks.set(chunk.documentId, chunks);
  }

  const root = await getWikiNode(KNOWLEDGE_SOURCE.rootUrl);
  const allNodes = await walkWikiTree(root);
  const documentNodes = allNodes.filter((node) => node.objType === "docx");
  const titleByNodeToken = new Map(
    allNodes.map((node) => [node.nodeToken, node.title])
  );
  const warnings: string[] = [];

  const fetched = await mapLimit(documentNodes, 3, async (node) => {
    try {
      const document = await fetchWikiDocument(node.nodeToken);
      return { node, document };
    } catch (error) {
      warnings.push(`${node.title}: ${(error as Error).message}`);
      return { node, document: null };
    }
  });

  const documents: KnowledgeDocument[] = [];
  const chunks: KnowledgeChunk[] = [];
  const chunksNeedingEmbeddings: KnowledgeChunk[] = [];
  const resourceCandidates = [];

  for (const item of fetched) {
    const { node, document } = item;
    const existingDocument = previousDocuments.get(node.nodeToken);

    if (!document) {
      if (existingDocument) {
        documents.push(existingDocument);
        chunks.push(...(previousChunks.get(node.nodeToken) || []));
        for (const resource of previous.resources) {
          for (const mention of resource.mentions) {
            if (mention.documentId === node.nodeToken) {
              resourceCandidates.push({
                ...resource,
                mention,
              });
            }
          }
        }
      }
      continue;
    }

    const url = `${KNOWLEDGE_SOURCE.domain}/wiki/${node.nodeToken}`;
    resourceCandidates.push(
      ...extractResourceLinks({
        documentId: node.nodeToken,
        documentTitle: node.title,
        documentUrl: url,
        markdown: document.markdown,
      })
    );

    const contentHash = hashContent(document.markdown);
    const existingDocumentChunks =
      previousChunks.get(node.nodeToken) || [];

    if (
      !forceRebuild &&
      existingDocument &&
      existingDocument.contentHash === contentHash &&
      existingDocumentChunks.length
    ) {
      documents.push({
        ...existingDocument,
        revisionId: document.revisionId,
        syncedAt: startedAt,
      });
      const reusableChunks = existingDocumentChunks.map((chunk) =>
        providerChanged ? { ...chunk, embedding: undefined } : chunk
      );
      chunks.push(...reusableChunks);
      chunksNeedingEmbeddings.push(
        ...reusableChunks.filter((chunk) => !chunk.embedding?.length)
      );
      continue;
    }

    const parentTitle =
      titleByNodeToken.get(node.parentNodeToken) || KNOWLEDGE_SOURCE.name;
    const documentChunks = chunkDocument({
      documentId: node.nodeToken,
      nodeToken: node.nodeToken,
      title: node.title,
      parentTitle,
      url,
      markdown: document.markdown,
    });

    documents.push({
      id: node.nodeToken,
      nodeToken: node.nodeToken,
      objToken: node.objToken,
      title: node.title,
      parentTitle,
      url,
      revisionId: document.revisionId,
      contentHash,
      updatedAt: node.updatedAt,
      syncedAt: startedAt,
      chunkCount: documentChunks.length,
    });
    chunks.push(...documentChunks);
    chunksNeedingEmbeddings.push(...documentChunks);
  }

  if (chunksNeedingEmbeddings.length && hasEmbeddingProvider()) {
    try {
      const vectors = await embedInBatches(
        chunksNeedingEmbeddings.map((chunk) => chunk.contextualText),
        "document"
      );
      chunksNeedingEmbeddings.forEach((chunk, index) => {
        chunk.embedding = vectors[index];
      });
    } catch (error) {
      warnings.push(`语义向量生成失败，已降级为关键词检索：${(error as Error).message}`);
    }
  } else if (chunksNeedingEmbeddings.length) {
    warnings.push("未配置可用的向量模型密钥，当前仅启用关键词检索。");
  }

  const embeddedChunkCount = chunks.filter(
    (chunk) => chunk.embedding?.length
  ).length;
  const completedAt = new Date().toISOString();
  const index: KnowledgeIndex = {
    version: 3,
    source: {
      name: KNOWLEDGE_SOURCE.name,
      rootUrl: KNOWLEDGE_SOURCE.rootUrl,
      spaceId: KNOWLEDGE_SOURCE.spaceId,
      rootNodeToken: KNOWLEDGE_SOURCE.rootNodeToken,
    },
    sync: {
      status: warnings.length ? "partial" : "ready",
      startedAt,
      completedAt,
      documentCount: documents.length,
      chunkCount: chunks.length,
      embeddedChunkCount,
      embeddingProvider:
        embeddedChunkCount > 0 ? embeddingProvider : undefined,
      warnings,
    },
    documents: documents.sort((left, right) =>
      right.title.localeCompare(left.title, "zh-CN")
    ),
    chunks,
    resources: mergeResourceLinks(resourceCandidates),
  };

  await writeIndex(index);
  return index;
}

export async function syncKnowledgeBase(): Promise<KnowledgeIndex> {
  if (!activeSync) {
    activeSync = performSync().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}
