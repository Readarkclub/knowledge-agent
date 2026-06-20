import assert from "node:assert/strict";
import test from "node:test";
import { chunkDocument } from "../src/lib/chunking";
import {
  buildLatestWeeklyReportAnswer,
  buildRecentWeeklyReportListAnswer,
  buildWeeklyReportCountAnswer,
  buildWeeklyReportListAnswer,
  countWeeklyReports,
  findLatestWeeklyReport,
  findRecentWeeklyReports,
  isLatestWeeklyReportIdentityQuery,
  isLatestWeeklyReportQuery,
  isRecentWeeklyReportListQuery,
  isWeeklyReportCountQuery,
  isWeeklyReportListQuery,
  latestWeeklyReportSources,
  parseMonthFilter,
  parseRecentWeeklyReportLimit,
  parseWeeklyReportRange,
  recentWeeklyReportListSources,
  weeklyReportListSources,
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

test("detects recent N weekly-report list queries", () => {
  assert.equal(parseRecentWeeklyReportLimit("列出最近的10篇周报"), 10);
  assert.equal(parseRecentWeeklyReportLimit("查看最新十期报告"), 10);
  assert.equal(isRecentWeeklyReportListQuery("列出最近的10篇周报"), true);
  assert.equal(isRecentWeeklyReportListQuery("最近10篇周报"), true);
  assert.equal(
    isRecentWeeklyReportListQuery("总结最近10篇周报的内容"),
    false
  );
  assert.equal(parseRecentWeeklyReportLimit("最近一期周报是哪个"), null);
});

test("lists the most recent reports across documents", () => {
  const index = emptyIndex();
  const old = report("old", "人人智学社报告2026-05-25~2026-05-31");
  const middle = report(
    "middle",
    "人人智学社报告2026-06-01~2026-06-07"
  );
  const latest = report(
    "latest",
    "人人智学社报告2026-06-08~2026-06-14"
  );
  index.documents = [middle, old, latest];

  const reports = findRecentWeeklyReports(index, 2);
  const answer = buildRecentWeeklyReportListAnswer(reports, 2);
  const sources = recentWeeklyReportListSources(index, 2);

  assert.deepEqual(
    reports.map((item) => item.document.id),
    ["latest", "middle"]
  );
  assert.match(answer, /最近的 \*\*2\*\* 份周报/);
  assert.deepEqual(
    sources.map((source) => source.documentId),
    ["latest", "middle"]
  );
});


test("detects monthly weekly-report count queries", () => {
  assert.equal(isWeeklyReportCountQuery("6月份周报有几份"), true);
  assert.equal(isWeeklyReportCountQuery("6月有多少份周报"), true);
  assert.equal(isWeeklyReportCountQuery("2026年6月有几期报告"), true);
  assert.equal(isWeeklyReportCountQuery("6月周报数量"), true);
  // 不应误触发：最新周报身份查询、内容查询
  assert.equal(isWeeklyReportCountQuery("最新一期周报是哪期"), false);
  assert.equal(isWeeklyReportCountQuery("6月周报讲了什么内容"), false);
});

test("parses month filter with default current year", () => {
  assert.deepEqual(parseMonthFilter("6月份周报"), { year: new Date().getFullYear(), month: 6 });
  assert.deepEqual(parseMonthFilter("2025年4月周报"), { year: 2025, month: 4 });
  assert.deepEqual(parseMonthFilter("列出2026-06周报"), { year: 2026, month: 6 });
  assert.deepEqual(parseMonthFilter("列出2026/06周报"), { year: 2026, month: 6 });
  assert.equal(parseMonthFilter("查询2026-06-08周报"), null);
  assert.equal(parseMonthFilter("最近一期周报"), null);
});

test("detects monthly weekly-report list queries", () => {
  assert.equal(isWeeklyReportListQuery("列出2026-06周报"), true);
  assert.equal(isWeeklyReportListQuery("2026年6月有哪些周报"), true);
  assert.equal(isWeeklyReportListQuery("查看6月份周报"), true);
  assert.equal(isWeeklyReportListQuery("6月份周报有几份"), false);
  assert.equal(isWeeklyReportListQuery("2026年6月周报讲了什么"), false);
});

test("counts weekly reports in a given month", () => {
  const index = emptyIndex();
  index.documents = [
    report("a", "人人智学社报告2026-06-01~2026-06-07"),
    report("b", "人人智学社报告2026-06-08~2026-06-14"),
    report("c", "人人智学社报告2026-05-25~2026-05-31"),
    report("d", "人人智学社报告2026年6月"),
  ];

  const june = countWeeklyReports(index, { year: 2026, month: 6 });
  assert.equal(june.length, 2);
  assert.deepEqual(june.map((r) => r.document.id), ["a", "b"]);

  const may = countWeeklyReports(index, { year: 2026, month: 5 });
  assert.equal(may.length, 1);
  assert.equal(may[0].document.id, "c");
});

test("builds count answer listing each report", () => {
  const index = emptyIndex();
  index.documents = [
    report("a", "人人智学社报告2026-06-01~2026-06-07"),
    report("b", "人人智学社报告2026-06-08~2026-06-14"),
  ];
  const reports = countWeeklyReports(index, { year: 2026, month: 6 });
  const answer = buildWeeklyReportCountAnswer(reports, { year: 2026, month: 6 });
  assert.match(answer, /共有 \*\*2\*\*/);
  assert.match(answer, /2026年6月1日至2026年6月7日/);
  assert.match(answer, /2026年6月8日至2026年6月14日/);
});

test("builds empty count answer when no reports", () => {
  const answer = buildWeeklyReportCountAnswer([], { year: 2026, month: 7 });
  assert.match(answer, /还没有已收录的周报/);
});

test("builds monthly report list and evidence from matching documents only", () => {
  const index = emptyIndex();
  const june1 = report("a", "人人智学社报告2026-06-01~2026-06-07");
  const june2 = report("b", "人人智学社报告2026-06-08~2026-06-14");
  const may = report("c", "人人智学社报告2026-05-25~2026-05-31");
  index.documents = [may, june1, june2];

  const reports = countWeeklyReports(index, { year: 2026, month: 6 });
  const answer = buildWeeklyReportListAnswer(
    reports,
    { year: 2026, month: 6 }
  );
  const sources = weeklyReportListSources(
    index,
    { year: 2026, month: 6 }
  );

  assert.match(answer, /2026年6月的周报共 \*\*2\*\* 份/);
  assert.match(answer, /2026-06-01~2026-06-07/);
  assert.match(answer, /2026-06-08~2026-06-14/);
  assert.deepEqual(
    sources.map((source) => source.documentId),
    ["a", "b"]
  );
  assert(sources.every((source) => source.excerpt.includes("统计周期")));
});
