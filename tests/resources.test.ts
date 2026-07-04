import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeResource,
  extractResourceLinks,
  mergeResourceLinks,
  sortResourceLinksByLatestMention,
} from "../src/lib/resources";

const input = {
  documentId: "weekly-1",
  documentTitle: "人人智学社周报",
  documentUrl: "https://renrenai.feishu.cn/wiki/weekly-1",
};

test("提取 Markdown 链接并清理常见追踪参数", () => {
  const resources = extractResourceLinks({
    ...input,
    markdown:
      "| 工具 | [Claude Code 实战](https://example.com/claude-code?utm_source=weekly&from=share) |",
  });

  assert.equal(resources.length, 1);
  assert.equal(resources[0].title, "Claude Code 实战");
  assert.equal(resources[0].url, "https://example.com/claude-code");
  assert.equal(resources[0].category, "AI编程与智能体");
});

test("忽略图片和当前周报自身链接", () => {
  const resources = extractResourceLinks({
    ...input,
    markdown: [
      "![封面](https://example.com/cover.png)",
      "[本周周报](https://renrenai.feishu.cn/wiki/weekly-1)",
    ].join("\n"),
  });

  assert.equal(resources.length, 0);
});

test("清理飞书 Markdown 的转义括号和全角闭合符号", () => {
  const resources = extractResourceLinks({
    ...input,
    markdown:
      "- \\[[开源] Obsidian Skills for Claude Code\\](https://example.com/skills）",
  });

  assert.equal(resources.length, 1);
  assert.equal(resources[0].title, "开源 Obsidian Skills for Claude Code");
  assert.equal(resources[0].url, "https://example.com/skills");
});

test("忽略飞书附件内部 file 链接，并用域名替代裸网址标题", () => {
  const resources = extractResourceLinks({
    ...input,
    markdown: [
      "http://file/f9ed14162bad0ebd9a0f9d3e75289214",
      "https://tools.example.com/",
    ].join("\n"),
  });

  assert.equal(resources.length, 1);
  assert.equal(resources[0].title, "tools.example.com");
});

test("相同链接跨周报合并并保留提及来源", () => {
  const first = extractResourceLinks({
    ...input,
    markdown: "[RAG 工作流](https://example.com/rag?utm_source=one)",
  });
  const second = extractResourceLinks({
    ...input,
    documentId: "weekly-2",
    documentTitle: "下一期周报",
    documentUrl: "https://renrenai.feishu.cn/wiki/weekly-2",
    markdown: "[企业知识库](https://example.com/rag?utm_source=two)",
  });
  const resources = mergeResourceLinks([...first, ...second]);

  assert.equal(resources.length, 1);
  assert.equal(resources[0].mentions.length, 2);
  assert.equal(resources[0].category, "Skill / 知识库 / 工作流");
});

test("资源按最近一次周报提及日期倒序排列", () => {
  const repeatedOld = extractResourceLinks({
    ...input,
    documentTitle: "人人智学社报告2025-01-01~2025-01-05",
    markdown: "[重复资源](https://example.com/repeated)",
  });
  const repeatedLatest = extractResourceLinks({
    ...input,
    documentId: "weekly-latest",
    documentTitle: "人人智学社报告2026-06-08~2026-06-14",
    markdown: "[重复资源](https://example.com/repeated)",
  });
  const newer = extractResourceLinks({
    ...input,
    documentId: "weekly-newer",
    documentTitle: "人人智学社报告2026-06-01~2026-06-07",
    markdown: "[较新资源](https://example.com/newer)",
  });
  const older = extractResourceLinks({
    ...input,
    documentId: "weekly-older",
    documentTitle: "人人智学社报告2025-12-01~2025-12-07",
    markdown: "[较旧资源](https://example.com/older)",
  });

  const resources = sortResourceLinksByLatestMention(
    mergeResourceLinks([
      ...repeatedOld,
      ...repeatedLatest,
      ...newer,
      ...older,
    ])
  );

  assert.deepEqual(
    resources.map((resource) => resource.url),
    [
      "https://example.com/repeated",
      "https://example.com/newer",
      "https://example.com/older",
    ]
  );
});

test("分类覆盖参考图中的主要主题", () => {
  assert.equal(
    categorizeResource("Figma 设计工作流", "海报与图片创作", "figma.com"),
    "内容创作与设计"
  );
  assert.equal(
    categorizeResource("AI 眼镜新品", "硬件产品发布", "example.com"),
    "硬件与产品"
  );
  assert.equal(
    categorizeResource("大模型行业报告", "OpenAI 新模型发布", "arxiv.org"),
    "模型与行业动态"
  );
});
