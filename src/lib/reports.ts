import { searchIndex } from "@/lib/search";
import type {
  KnowledgeDocument,
  KnowledgeIndex,
  SearchResult,
} from "@/lib/types";

export type WeeklyReportRange = {
  start: string;
  end: string;
  startTime: number;
  endTime: number;
};

export type LatestWeeklyReport = {
  document: KnowledgeDocument;
  range: WeeklyReportRange;
};

function parseDate(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return time;
}

export function parseWeeklyReportRange(
  title: string
): WeeklyReportRange | null {
  const match = title
    .replace(/\\~/g, "~")
    .match(
      /(\d{4}-\d{2}-\d{2})\s*(?:~|～|至)\s*(\d{4}-\d{2}-\d{2})/
    );
  if (!match) {
    return null;
  }

  const startTime = parseDate(match[1]);
  const endTime = parseDate(match[2]);
  if (startTime === null || endTime === null || endTime < startTime) {
    return null;
  }

  return {
    start: match[1],
    end: match[2],
    startTime,
    endTime,
  };
}

export function isLatestWeeklyReportQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");
  return /(最新|最近)/.test(normalized) && /(周报|报告)/.test(normalized);
}

export function isLatestWeeklyReportIdentityQuery(query: string): boolean {
  if (!isLatestWeeklyReportQuery(query)) {
    return false;
  }

  const normalized = query.normalize("NFKC").replace(/\s+/g, "");
  if (/(内容|讲了什么|说了什么|总结|摘要|主题|资源|链接|讨论)/.test(normalized)) {
    return false;
  }

  return /(哪|哪个|哪期|日期|时间|什么时候|一期|是)/.test(normalized);
}

export type MonthFilter = {
  year: number;
  month: number;
};

export function parseMonthFilter(query: string): MonthFilter | null {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");

  const full = normalized.match(/(\d{4})年(\d{1,2})月/);
  if (full) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    if (month >= 1 && month <= 12) {
      return { year, month };
    }
  }

  const short = normalized.match(/(\d{1,2})月份?/);
  if (short) {
    const month = Number(short[1]);
    if (month >= 1 && month <= 12) {
      const year = new Date().getFullYear();
      return { year, month };
    }
  }

  return null;
}

export function isWeeklyReportCountQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");

  if (!parseMonthFilter(query)) {
    return false;
  }

  if (!/(周报|报告)/.test(normalized)) {
    return false;
  }

  return /(几份|多少份|有多少|有几份|几期|几条|数量|多少篇|有几篇|多少个|有几个)/.test(normalized);
}

export function countWeeklyReports(
  index: KnowledgeIndex,
  filter: MonthFilter
): LatestWeeklyReport[] {
  const today = Date.now();

  return index.documents
    .map((document) => ({
      document,
      range: parseWeeklyReportRange(document.title),
    }))
    .filter((item): item is LatestWeeklyReport => Boolean(item.range))
    .filter((item) => {
      const start = new Date(item.range.startTime);
      return (
        start.getUTCFullYear() === filter.year &&
        start.getUTCMonth() + 1 === filter.month &&
        item.range.startTime <= today
      );
    })
    .sort((left, right) => left.range.startTime - right.range.startTime);
}

export function buildWeeklyReportCountAnswer(
  reports: LatestWeeklyReport[],
  filter: MonthFilter,
  today = new Date()
): string {
  const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  if (reports.length === 0) {
    return `截至${todayStr}，知识库中${filter.year}年${filter.month}月还没有已收录的周报。`;
  }

  const lines = reports.map((item, index) => {
    const { document, range } = item;
    return `${index + 1}. [${document.title}](${document.url})（${formatChineseDate(range.start)}至${formatChineseDate(range.end)}）`;
  });

  return `截至${todayStr}，知识库中${filter.year}年${filter.month}月的周报共有 **${reports.length}** 份：

${lines.join("\n")}`;
}

export function findLatestWeeklyReport(
  index: KnowledgeIndex
): LatestWeeklyReport | null {
  const reports = index.documents
    .map((document) => ({
      document,
      range: parseWeeklyReportRange(document.title),
    }))
    .filter(
      (item): item is LatestWeeklyReport =>
        Boolean(item.range)
    )
    .sort(
      (left, right) =>
        right.range.endTime - left.range.endTime ||
        right.range.startTime - left.range.startTime
    );

  return reports[0] || null;
}

function fallbackResult(
  document: KnowledgeDocument,
  chunk: KnowledgeIndex["chunks"][number],
  position: number
): SearchResult {
  return {
    id: chunk.id,
    documentId: document.id,
    title: chunk.title,
    parentTitle: chunk.parentTitle,
    heading: chunk.heading,
    url: chunk.url,
    excerpt: chunk.content.replace(/\s+/g, " ").trim().slice(0, 280),
    score: Math.max(0.7, 1 - position * 0.08),
    lexicalScore: 0,
    semanticScore: 0,
  };
}

export function latestWeeklyReportSources(
  index: KnowledgeIndex,
  query: string,
  limit = 6
): SearchResult[] {
  const latest = findLatestWeeklyReport(index);
  if (!latest) {
    return [];
  }

  const reportChunks = index.chunks.filter(
    (chunk) => chunk.documentId === latest.document.id
  );
  const filteredIndex = {
    ...index,
    documents: [latest.document],
    chunks: reportChunks,
  };
  const results = searchIndex(filteredIndex, query, undefined, limit);

  if (results.length) {
    return results;
  }

  return reportChunks
    .slice(0, limit)
    .map((chunk, position) =>
      fallbackResult(latest.document, chunk, position)
    );
}

function formatChineseDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function buildLatestWeeklyReportAnswer(
  latest: LatestWeeklyReport
): string {
  const { document, range } = latest;
  return `最近一期周报是 **[${document.title}](${document.url})**，统计周期为 **${formatChineseDate(
    range.start
  )}至${formatChineseDate(range.end)}**。`;
}
