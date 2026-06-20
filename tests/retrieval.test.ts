import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument, tokenize } from "../src/lib/chunking";
import { buildZhipuEmbeddingRequest } from "../src/lib/embeddings";
import { searchIndex } from "../src/lib/search";
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

test("无关键词依据时不返回仅靠向量相似度命中的证据", () => {
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
      embedding: [1, 0],
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

test("智谱 embedding-3 使用官方支持的向量维度", () => {
  assert.deepEqual(buildZhipuEmbeddingRequest(["知识库检索"]), {
    model: "embedding-3",
    input: ["知识库检索"],
    dimensions: 512,
  });
});
