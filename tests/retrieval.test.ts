import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument, tokenize } from "../src/lib/chunking";
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

