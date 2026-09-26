import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChunkAnchors,
  buildHeadingAnchors,
  chunkDocument,
} from "../src/lib/chunking";
import { parseOutlineHeadings } from "../src/lib/feishu";
import type { KnowledgeChunk } from "../src/lib/types";

test("parseOutlineHeadings extracts block ids in document order", () => {
  const fragment =
    '<fragment mode="outline"><outline>' +
    '<h2 id="blkH2">1. 主要讨论内容</h2>' +
    '<h3 id="blkH3a">1.1 OpenClaw 生态爆发</h3>' +
    '<h3 id="blkH3b">2.1 A &amp; B &lt;测试&gt;</h3>' +
    '<h2 id="blkEmpty">   </h2>' +
    "</outline></fragment>";

  assert.deepEqual(parseOutlineHeadings(fragment), [
    { level: 2, blockId: "blkH2", text: "1. 主要讨论内容" },
    { level: 3, blockId: "blkH3a", text: "1.1 OpenClaw 生态爆发" },
    { level: 3, blockId: "blkH3b", text: "2.1 A & B <测试>" },
  ]);
});

test("parseOutlineHeadings ignores headings without ids", () => {
  const fragment = '<outline><h2>无 ID 标题</h2><h3 id="blkOk">有 ID 标题</h3></outline>';

  assert.deepEqual(parseOutlineHeadings(fragment), [
    { level: 3, blockId: "blkOk", text: "有 ID 标题" },
  ]);
});

test("buildHeadingAnchors keeps the first occurrence of duplicate headings", () => {
  const anchors = buildHeadingAnchors([
    { blockId: "blkFirst", text: "每日消息分布" },
    { blockId: "blkSecond", text: "每日消息分布" },
    { blockId: "", text: "无锚点" },
  ]);

  assert.deepEqual([...anchors.entries()], [["每日消息分布", "blkFirst"]]);
});

function makeChunk(heading: string, url: string): KnowledgeChunk {
  return {
    id: "doc:0",
    documentId: "doc",
    nodeToken: "doc",
    title: "文档",
    parentTitle: "目录",
    heading,
    url,
    content: "内容",
    contextualText: "内容",
    tokens: [],
  };
}

test("applyChunkAnchors anchors chunks by heading, stripping the piece suffix", () => {
  const anchors = buildHeadingAnchors([
    { blockId: "blkH2", text: "1. 主要讨论内容" },
  ]);
  const chunks = [
    makeChunk("1. 主要讨论内容", "https://renrenai.feishu.cn/docx/doc"),
    makeChunk(
      "1. 主要讨论内容 · 2/3",
      "https://renrenai.feishu.cn/docx/doc"
    ),
    makeChunk("不相关的章节", "https://renrenai.feishu.cn/docx/doc"),
  ];

  applyChunkAnchors(chunks, anchors, "https://renrenai.feishu.cn/docx/doc");

  assert.equal(chunks[0].url, "https://renrenai.feishu.cn/docx/doc#blkH2");
  assert.equal(chunks[1].url, "https://renrenai.feishu.cn/docx/doc#blkH2");
  assert.equal(chunks[2].url, "https://renrenai.feishu.cn/docx/doc");
});

test("applyChunkAnchors matches markdown escapes against raw outline text", () => {
  const anchors = buildHeadingAnchors([
    { blockId: "blkTitle", text: "人人智学社报告 2026-03-09~2026-03-15" },
  ]);
  const chunks = [
    makeChunk(
      "人人智学社报告 2026-03-09\\~2026-03-15",
      "https://renrenai.feishu.cn/docx/doc"
    ),
  ];

  applyChunkAnchors(chunks, anchors, "https://renrenai.feishu.cn/docx/doc");

  assert.equal(chunks[0].url, "https://renrenai.feishu.cn/docx/doc#blkTitle");
});

test("applyChunkAnchors is idempotent for already anchored urls", () => {
  const anchors = buildHeadingAnchors([
    { blockId: "blkOther", text: "其他章节" },
  ]);
  const chunks = [
    makeChunk("其他章节", "https://renrenai.feishu.cn/docx/doc#blkOld"),
  ];

  applyChunkAnchors(chunks, anchors, "https://renrenai.feishu.cn/docx/doc");

  assert.equal(chunks[0].url, "https://renrenai.feishu.cn/docx/doc#blkOld");
});

test("applyChunkAnchors is a no-op without anchors", () => {
  const chunks = [
    makeChunk("任意章节", "https://renrenai.feishu.cn/docx/doc"),
  ];

  applyChunkAnchors(
    chunks,
    buildHeadingAnchors([]),
    "https://renrenai.feishu.cn/docx/doc"
  );

  assert.equal(chunks[0].url, "https://renrenai.feishu.cn/docx/doc");
});

test("chunkDocument output headings line up with outline anchors", () => {
  const markdown = [
    "# 人人智学社报告 2026-03-09\\~2026-03-15",
    "",
    "本期摘要引言，位于第一个章节标题之前。",
    "",
    "## 1. 主要讨论内容",
    "",
    "短章节。",
    "",
    "## 2. 分享的资源与技巧",
    "",
    "长章节内容。".repeat(120),
  ].join("\n");

  const chunks = chunkDocument({
    documentId: "doc",
    nodeToken: "doc",
    title: "人人智学社报告 2026-03-09~2026-03-15",
    parentTitle: "群聊摘要",
    url: "https://renrenai.feishu.cn/docx/doc",
    markdown,
  });

  const anchors = buildHeadingAnchors([
    { blockId: "blkMain", text: "1. 主要讨论内容" },
    { blockId: "blkShare", text: "2. 分享的资源与技巧" },
  ]);
  applyChunkAnchors(chunks, anchors, "https://renrenai.feishu.cn/docx/doc");

  const mainChunk = chunks.find((chunk) =>
    chunk.heading.startsWith("1. 主要讨论内容")
  );
  const shareChunks = chunks.filter((chunk) =>
    chunk.heading.startsWith("2. 分享的资源与技巧")
  );
  const unanchored = chunks.filter((chunk) => !chunk.url.includes("#"));

  assert.ok(mainChunk);
  assert.equal(mainChunk.url, "https://renrenai.feishu.cn/docx/doc#blkMain");
  assert.ok(shareChunks.length > 1);
  for (const chunk of shareChunks) {
    assert.equal(chunk.url, "https://renrenai.feishu.cn/docx/doc#blkShare");
  }
  // 文档标题段落没有对应的 outline 标题，保持文档级链接。
  assert.ok(unanchored.length >= 1);
});
