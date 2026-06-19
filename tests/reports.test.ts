import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument } from "../src/lib/chunking";
import {
  buildLatestWeeklyReportAnswer,
  findLatestWeeklyReport,
  isLatestWeeklyReportIdentityQuery,
  isLatestWeeklyReportQuery,
  latestWeeklyReportSources,
  parseWeeklyReportRange,
} from "../src/lib/reports";
import { emptyIndex } from "../src/lib/store";
import type { KnowledgeDocument } from "../src/lib/types";

function report(
  id: string,
  title: string
): KnowledgeDocument {
  return {
    id,
    nodeToken: id,
    objToken: id,
    title,
    parentTitle: "群聊摘要",
    url: `https://renrenai.feishu.cn/docx/${id}`,
    revisionId: 1,
    contentHash: id,
    syncedAt: "2026-06-19T00:00:00.000Z",
    chunkCount: 1,
  };
}

test("parses weekly report date ranges", () => {
  assert.deepEqual(
    parseWeeklyReportRange("人人智学社报告2026-06-08\\~2026-06-14"),
    {
      start: "2026-06-08",
      end: "2026-06-14",
      startTime: Date.UTC(2026, 5, 8),
      endTime: Date.UTC(2026, 5, 14),
    }
  );
  assert.equal(parseWeeklyReportRange("人人智学社报告2026年6月"), null);
});

test("selects the report with the latest end date", () => {
  const index = emptyIndex();
  index.documents = [
    report(
      "old",
      "人人智学社报告2026-02-23~2026-03-01"
    ),
    report(
      "latest",
      "人人智学社报告2026-06-08~2026-06-14"
    ),
  ];

  assert.equal(findLatestWeeklyReport(index)?.document.id, "latest");
});

test("routes latest weekly report questions to the latest document", () => {
  const index = emptyIndex();
  const old = report(
    "old",
    "人人智学社报告2026-02-23~2026-03-01"
  );
  const latest = report(
    "latest",
    "人人智学社报告2026-06-08~2026-06-14"
  );
  index.documents = [old, latest];
  index.chunks = [
    ...chunkDocument({
      documentId: old.id,
      nodeToken: old.nodeToken,
      title: old.title,
      parentTitle: old.parentTitle,
      url: old.url,
      markdown: "旧周报讨论了其他内容。",
    }),
    ...chunkDocument({
      documentId: latest.id,
      nodeToken: latest.nodeToken,
      title: latest.title,
      parentTitle: latest.parentTitle,
      url: latest.url,
      markdown: "最新周报讨论了 Agent 与 RAG。",
    }),
  ];

  const query = "最近的一期周报是哪个？";
  assert.equal(isLatestWeeklyReportQuery(query), true);
  assert.equal(isLatestWeeklyReportIdentityQuery(query), true);
  assert.equal(
    isLatestWeeklyReportIdentityQuery("最近一期周报有哪些内容？"),
    false
  );
  assert.deepEqual(
    latestWeeklyReportSources(index, query).map(
      (source) => source.documentId
    ),
    ["latest"]
  );

  const selected = findLatestWeeklyReport(index);
  assert(selected);
  assert.match(
    buildLatestWeeklyReportAnswer(selected),
    /2026年6月8日至2026年6月14日/
  );
});
