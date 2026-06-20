import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument, tokenize } from "../src/lib/chunking";
import {
  buildZhipuEmbeddingRequest,
  canUseQueryEmbeddings,
} from "../src/lib/embeddings";
import {
  rewriteKnowledgeQuery,
  searchDocumentMetadata,
  searchIndex,
} from "../src/lib/search";
import { emptyIndex } from "../src/lib/store";

test("中文检索同时生成单字和双字词元", () => {
  const tokens = tokenize("知识库如何同步飞书文档");
  assert(tokens.includes("知识"));
  assert(tokens.includes("飞书"));
  assert(tokens.includes("同步"));
});

test("分块保留文档与章节语境", () => {
  const chunks = chunkDocument({
    documentId: "doc-1",
    nodeToken: "node-1",
    title: "周报",
    parentTitle: "2026年6月",
    url: "https://example.com/wiki/node-1",
    markdown: "# Agent\n\n讨论了知识库同步与引用。",
  });

  assert.equal(chunks.length, 1);
  assert.match(chunks[0].contextualText, /文档：周报/);
  assert.match(chunks[0].contextualText, /章节：Agent/);
});

test("关键词检索优先返回精确主题", () => {
  const index = emptyIndex();
  index.chunks = [
    {
      id: "a",
      documentId: "doc-a",
      nodeToken: "a",
      title: "Agent 讨论",
      parentTitle: "六月",
      heading: "RAG",
      url: "https://example.com/a",
      content: "群里讨论了 Hybrid RAG、引用和飞书文档同步。",
      contextualText: "群里讨论了 Hybrid RAG、引用和飞书文档同步。",
      tokens: tokenize("群里讨论了 Hybrid RAG、引用和飞书文档同步。"),
    },
    {
      id: "b",
      documentId: "doc-b",
      nodeToken: "b",
      title: "生活讨论",
      parentTitle: "六月",
      heading: "活动",
      url: "https://example.com/b",
      content: "群里讨论了周末活动和天气。",
      contextualText: "群里讨论了周末活动和天气。",
      tokens: tokenize("群里讨论了周末活动和天气。"),
    },
  ];

  const results = searchIndex(index, "飞书文档怎么同步", undefined, 2);
  assert.equal(results[0].id, "a");
});

test("弱向量相似度不会绕过证据门槛", () => {
  const index = emptyIndex();
  index.chunks = [
    {
      id: "a",
      documentId: "doc-a",
      nodeToken: "a",
      title: "Agent 讨论",
      parentTitle: "六月",
      heading: "RAG",
      url: "https://example.com/a",
      content: "法国团队关注 AI 产业，行业正在经历技术革命。",
      contextualText: "法国团队关注 AI 产业，行业正在经历技术革命。",
      tokens: tokenize("法国团队关注 AI 产业，行业正在经历技术革命。"),
      embedding: [0.6, 0.8],
    },
  ];

  const results = searchIndex(
    index,
    "法国大革命在群里有哪些讨论",
    [1, 0],
    2
  );
  assert.deepEqual(results, []);
});

test("高置信语义候选可以补足关键词未命中", () => {
  const index = emptyIndex();
  index.chunks = [
    {
      id: "a",
      documentId: "doc-a",
      nodeToken: "a",
      title: "Agent 工程实践",
      parentTitle: "六月",
      heading: "工作流",
      url: "https://example.com/a",
      content: "分享了自主执行程序的任务拆解、工具调用和失败恢复。",
      contextualText: "分享了自主执行程序的任务拆解、工具调用和失败恢复。",
      tokens: tokenize("分享了自主执行程序的任务拆解、工具调用和失败恢复。"),
      embedding: [0.9, 0.435889894],
    },
  ];

  const results = searchIndex(
    index,
    "智能体如何规划任务",
    [1, 0],
    2
  );
  assert.deepEqual(results.map((result) => result.id), ["a"]);
});

test("检索意图词不会掩盖真正主题词", () => {
  const index = emptyIndex();
  index.chunks = [
    {
      id: "a",
      documentId: "doc-a",
      nodeToken: "a",
      title: "RAG 落地",
      parentTitle: "六月",
      heading: "知识库",
      url: "https://example.com/a",
      content: "分享了 RAG 知识库落地、引用和检索经验。",
      contextualText: "分享了 RAG 知识库落地、引用和检索经验。",
      tokens: tokenize("分享了 RAG 知识库落地、引用和检索经验。"),
    },
    {
      id: "b",
      documentId: "doc-b",
      nodeToken: "b",
      title: "群聊活动",
      parentTitle: "六月",
      heading: "讨论",
      url: "https://example.com/b",
      content: "群里讨论了周末活动。",
      contextualText: "群里讨论了周末活动。",
      tokens: tokenize("群里讨论了周末活动。"),
    },
  ];

  const results = searchIndex(
    index,
    "群里讨论了哪些 RAG 知识库落地经验",
    undefined,
    2
  );
  assert.deepEqual(results.map((result) => result.id), ["a"]);
});

test("内容问答优先主题段落而不是链接清单", () => {
  const index = emptyIndex();
  index.chunks = [
    {
      id: "topic",
      documentId: "doc-a",
      nodeToken: "a",
      title: "本周周报",
      parentTitle: "六月",
      heading: "1.1 Agent 工程实践",
      url: "https://example.com/a",
      content: "Agent 工程实践包括任务拆解、工具调用与失败恢复。",
      contextualText: "Agent 工程实践包括任务拆解、工具调用与失败恢复。",
      tokens: tokenize("Agent 工程实践包括任务拆解、工具调用与失败恢复。"),
    },
    {
      id: "links",
      documentId: "doc-b",
      nodeToken: "b",
      title: "本周周报",
      parentTitle: "六月",
      heading: "2.2 公众号文章与资源链接",
      url: "https://example.com/b",
      content: "Agent 工程实践包括任务拆解、工具调用与失败恢复。",
      contextualText: "Agent 工程实践包括任务拆解、工具调用与失败恢复。",
      tokens: tokenize("Agent 工程实践包括任务拆解、工具调用与失败恢复。"),
    },
  ];

  const results = searchIndex(index, "Agent 工程实践有哪些经验", undefined, 2);
  assert.deepEqual(results.map((result) => result.id), ["topic", "links"]);
});

test("智谱 embedding-3 使用官方支持的向量维度", () => {
  assert.deepEqual(buildZhipuEmbeddingRequest(["知识库检索"]), {
    model: "embedding-3",
    input: ["知识库检索"],
    dimensions: 512,
  });
});

test("查询改写只替换一次常见中英文术语", () => {
  assert.equal(
    rewriteKnowledgeQuery("智能体如何规划任务"),
    "Agent如何规划任务"
  );
  assert.equal(
    rewriteKnowledgeQuery("RAG 有哪些落地经验"),
    "检索增强生成 有哪些落地经验"
  );
  assert.equal(rewriteKnowledgeQuery("周报有哪些内容"), null);
});

test("正文检索为空时可以通过标题元数据召回文档", () => {
  const index = emptyIndex();
  index.documents = [
    {
      id: "doc-a",
      nodeToken: "doc-a",
      objToken: "doc-a",
      title: "GraphRAG 工程实践",
      parentTitle: "知识库专题",
      url: "https://example.com/a",
      revisionId: 1,
      contentHash: "a",
      syncedAt: "2026-06-20T00:00:00.000Z",
      chunkCount: 1,
    },
  ];
  index.chunks = [
    {
      id: "a",
      documentId: "doc-a",
      nodeToken: "doc-a",
      title: "GraphRAG 工程实践",
      parentTitle: "知识库专题",
      heading: "开篇",
      url: "https://example.com/a",
      content: "这篇文章分析实体关系网络的适用场景。",
      contextualText: "这篇文章分析实体关系网络的适用场景。",
      tokens: tokenize("这篇文章分析实体关系网络的适用场景。"),
    },
  ];

  const results = searchDocumentMetadata(index, "GraphRAG", 2);
  assert.deepEqual(results.map((result) => result.id), ["a"]);
});

test("Vercel 仅在远程模型与索引模型一致时启用查询向量", () => {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalKey = process.env.ZHIPU_API_KEY;
  const originalVercel = process.env.VERCEL;
  try {
    const index = emptyIndex();
    index.sync.embeddedChunkCount = 1;
    index.sync.embeddingProvider = "embedding-3";

    process.env.EMBEDDING_PROVIDER = "zhipu";
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.VERCEL = "1";
    assert.equal(canUseQueryEmbeddings(index), true);

    process.env.EMBEDDING_PROVIDER = "local";
    index.sync.embeddingProvider = "Xenova/multilingual-e5-small";
    assert.equal(canUseQueryEmbeddings(index), false);
  } finally {
    if (originalProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = originalProvider;
    }
    if (originalKey === undefined) {
      delete process.env.ZHIPU_API_KEY;
    } else {
      process.env.ZHIPU_API_KEY = originalKey;
    }
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
  }
});
