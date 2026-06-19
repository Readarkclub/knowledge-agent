import assert from "node:assert/strict";
import test from "node:test";
import { extractWeeklyReportCitations } from "../src/lib/citations";

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
