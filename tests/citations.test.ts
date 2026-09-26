import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWeeklyReportCitations,
  findMatchingEvidenceLine,
  repairInlineCitations,
} from "../src/lib/citations";

test("citation preview selects the supporting line from a multi-item source", () => {
  const excerpt = [
    '- 每日分享"果比AI日报"，跟踪AI行业最新动态',
    "- 分享甲子光年2025 AI产品用户需求调研报告",
    "- 分享AI哲学应用等新兴AI产品的使用体验",
  ].join("\n");
  assert.equal(
    findMatchingEvidenceLine(excerpt, "AI哲学应用：作为新兴AI产品被提及"),
    "- 分享AI哲学应用等新兴AI产品的使用体验"
  );
  assert.equal(findMatchingEvidenceLine(excerpt, "未提及的完全无关事实"), null);
});

test("extracts cited weekly docx reports", () => {
  const markdown = [
    '<cite title="人人智学社报告2026-06-08\\~2026-06-14" file-type="docx" doc-id="latest"></cite>',
    '<cite doc-id="older" file-type="docx" title="人人智学社报告2026-06-01~2026-06-07"></cite>',
  ].join("\n");

  assert.deepEqual(extractWeeklyReportCitations(markdown), [
    {
      docId: "latest",
      title: "人人智学社报告2026-06-08~2026-06-14",
    },
    {
      docId: "older",
      title: "人人智学社报告2026-06-01~2026-06-07",
    },
  ]);
});

test("ignores non-weekly and non-docx citations", () => {
  const markdown = [
    '<cite doc-id="sheet" file-type="sheet" title="2026-06-08~2026-06-14"></cite>',
    '<cite doc-id="article" file-type="docx" title="RAG 技术文章"></cite>',
  ].join("\n");

  assert.deepEqual(extractWeeklyReportCitations(markdown), []);
});

test("repairInlineCitations links a bare [来源 N] marker missing its URL", () => {
  const text = "哲学话题为热潮提供了思考入口 [来源 1]。知识库讨论了Agent [来源 2]。";
  const urls = new Map([
    ["1", "https://renrenai.feishu.cn/wiki/aaa"],
    ["2", "https://renrenai.feishu.cn/wiki/bbb"],
  ]);

  assert.equal(
    repairInlineCitations(text, urls),
    "哲学话题为热潮提供了思考入口 [来源 1](https://renrenai.feishu.cn/wiki/aaa)。" +
      "知识库讨论了Agent [来源 2](https://renrenai.feishu.cn/wiki/bbb)。"
  );
});

test("repairInlineCitations overrides an already-linked marker with the authoritative URL", () => {
  const text = "参考 [来源 1](https://hallucinated.example/wrong)。";
  const urls = new Map([["1", "https://renrenai.feishu.cn/wiki/real"]]);

  assert.equal(
    repairInlineCitations(text, urls),
    "参考 [来源 1](https://renrenai.feishu.cn/wiki/real)。"
  );
});

test("repairInlineCitations leaves markers without a known source untouched", () => {
  const text = "没有证据支持的引用 [来源 9]。";
  const urls = new Map([["1", "https://renrenai.feishu.cn/wiki/real"]]);

  assert.equal(repairInlineCitations(text, urls), text);
});

test("repairInlineCitations is a no-op when no sources are supplied", () => {
  const text = "没有证据的回答，不含引用。";
  assert.equal(repairInlineCitations(text, new Map()), text);
});

test("repairInlineCitations links combined multi-source markers", () => {
  const text = "模型成本成为选型核心因素 [来源 1, 来源 8]。";
  const urls = new Map([
    ["1", "https://renrenai.feishu.cn/wiki/aaa"],
    ["8", "https://renrenai.feishu.cn/wiki/bbb"],
  ]);

  assert.equal(
    repairInlineCitations(text, urls),
    "模型成本成为选型核心因素 " +
      "[来源 1](https://renrenai.feishu.cn/wiki/aaa)、" +
      "[来源 8](https://renrenai.feishu.cn/wiki/bbb)。"
  );
});

test("repairInlineCitations handles fullwidth separators and missing ids", () => {
  const text = "参考 [来源 1，来源 9] 以及 [来源 3、4]。";
  const urls = new Map([
    ["1", "https://renrenai.feishu.cn/wiki/aaa"],
    ["3", "https://renrenai.feishu.cn/wiki/ccc"],
    ["4", "https://renrenai.feishu.cn/wiki/ddd"],
  ]);

  assert.equal(
    repairInlineCitations(text, urls),
    "参考 " +
      "[来源 1](https://renrenai.feishu.cn/wiki/aaa)、来源 9 以及 " +
      "[来源 3](https://renrenai.feishu.cn/wiki/ccc)、" +
      "[来源 4](https://renrenai.feishu.cn/wiki/ddd)。"
  );
});
