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

export type WeeklyReportQueryRoute =
  | { type: "recent-list"; limit: number }
  | { type: "monthly-count"; filter: MonthFilter }
  | { type: "monthly-list"; filter: MonthFilter }
  | { type: "total-count" }
  | { type: "latest"; identity: boolean };

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

export function isRecentPeriodContentQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");
  return /(最近一周|近一周|过去一周|最近7天|近7天|本周|上周)/.test(
    normalized
  );
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

function parseChineseNumber(value: string): number | null {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (!value.includes("十")) {
    return digits[value] || null;
  }

  const [tens, ones] = value.split("十");
  return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
}

export function parseRecentWeeklyReportLimit(
  query: string
): number | null {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");
  const match = normalized.match(
    /(?:最近|最新)(?:的)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:篇|份|期|条|个)(?:周报|报告)/
  );
  if (!match) {
    return null;
  }

  const limit = /^\d+$/.test(match[1])
    ? Number(match[1])
    : parseChineseNumber(match[1]);
  return limit && limit >= 2 && limit <= 50 ? limit : null;
}

export function isRecentWeeklyReportListQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");

  if (!parseRecentWeeklyReportLimit(query)) {
    return false;
  }

  return !/(内容|讲了什么|说了什么|总结|摘要|主题|资源|链接|讨论)/.test(
    normalized
  );
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

  const numeric = normalized.match(
    /(?:^|[^\d])(\d{4})[-/.](\d{1,2})(?![-/.]\d{1,2})/
  );
  if (numeric) {
    const year = Number(numeric[1]);
    const month = Number(numeric[2]);
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

export function isTotalWeeklyReportCountQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");

  if (
    parseMonthFilter(query) ||
    !/(周报|报告)/.test(normalized) ||
    /(内容|讲了什么|说了什么|总结|摘要|主题|资源|链接|讨论|提到|涉及|关于)/.test(
      normalized
    )
  ) {
    return false;
  }

  return /(一共|总共|总计|累计|全部)?(有)?(几份|多少份|有多少|有几份|几期|几条|数量|多少篇|有几篇|多少个|有几个)/.test(
    normalized
  );
}

export function isWeeklyReportListQuery(query: string): boolean {
  const normalized = query.normalize("NFKC").replace(/\s+/g, "");

  if (!parseMonthFilter(query) || !/(周报|报告)/.test(normalized)) {
    return false;
  }

  if (
    isWeeklyReportCountQuery(query) ||
    /(内容|讲了什么|说了什么|总结|摘要|主题|资源|链接|讨论)/.test(
      normalized
    )
  ) {
    return false;
  }

  return /(列出|列表|有哪些|哪几|所有|全部|汇总|整理|查看|给我)/.test(
    normalized
  );
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

export function findAllWeeklyReports(
  index: KnowledgeIndex,
  now = Date.now()
): LatestWeeklyReport[] {
  return index.documents
    .map((document) => ({
      document,
      range: parseWeeklyReportRange(document.title),
    }))
    .filter((item): item is LatestWeeklyReport => Boolean(item.range))
    .filter((item) => item.range.startTime <= now)
    .sort(
      (left, right) =>
        left.range.startTime - right.range.startTime ||
        left.range.endTime - right.range.endTime
    );
}

export function weeklyReportListSources(
  index: KnowledgeIndex,
  filter: MonthFilter
): SearchResult[] {
  return countWeeklyReports(index, filter).map(
    ({ document, range }, position) => ({
      id: `${document.id}:report-range`,
      documentId: document.id,
      title: document.title,
      parentTitle: document.parentTitle,
      heading: "周报日期",
      url: document.url,
      excerpt: `已收录周报，统计周期为${formatChineseDate(
        range.start
      )}至${formatChineseDate(range.end)}。`,
      score: Math.max(0.7, 0.99 - position * 0.04),
      lexicalScore: 1,
      semanticScore: 0,
    })
  );
}

export function findRecentWeeklyReports(
  index: KnowledgeIndex,
  limit: number,
  now = Date.now()
): LatestWeeklyReport[] {
  return findAllWeeklyReports(index, now)
    .sort(
      (left, right) =>
        right.range.endTime - left.range.endTime ||
        right.range.startTime - left.range.startTime
    )
    .slice(0, limit);
}

export function buildAllWeeklyReportCountAnswer(
  reports: LatestWeeklyReport[],
  today = new Date()
): string {
  const todayStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  if (!reports.length) {
    return `截至${todayStr}，知识库中还没有已收录的周报。`;
  }

  const countsByYear = new Map<number, number>();
  for (const report of reports) {
    const year = new Date(report.range.startTime).getUTCFullYear();
    countsByYear.set(year, (countsByYear.get(year) || 0) + 1);
  }
  const yearSummary = [...countsByYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, count]) => `${year}年 ${count} 份`)
    .join("，");
  const earliest = reports[0];
  const latest = reports[reports.length - 1];

  return `截至${todayStr}，知识库共收录 **${reports.length}** 份周报，覆盖 **${formatChineseDate(
    earliest.range.start
  )}至${formatChineseDate(latest.range.end)}**。按年份统计：${yearSummary}。`;
}

export function recentWeeklyReportListSources(
  index: KnowledgeIndex,
  limit: number
): SearchResult[] {
  return findRecentWeeklyReports(index, limit).map(
    ({ document, range }, position) => ({
      id: `${document.id}:recent-report-range`,
      documentId: document.id,
      title: document.title,
      parentTitle: document.parentTitle,
      heading: "周报日期",
      url: document.url,
      excerpt: `已收录周报，统计周期为${formatChineseDate(
        range.start
      )}至${formatChineseDate(range.end)}。`,
      score: Math.max(0.7, 0.99 - position * 0.025),
      lexicalScore: 1,
      semanticScore: 0,
    })
  );
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

export function buildWeeklyReportListAnswer(
  reports: LatestWeeklyReport[],
  filter: MonthFilter
): string {
  if (reports.length === 0) {
    return `知识库中${filter.year}年${filter.month}月还没有已收录的周报。`;
  }

  const lines = reports.map(({ document, range }, index) => {
    return `${index + 1}. [${document.title}](${document.url})（${formatChineseDate(
      range.start
    )}至${formatChineseDate(range.end)}）`;
  });

  return `知识库中${filter.year}年${filter.month}月的周报共 **${reports.length}** 份：

${lines.join("\n")}`;
}

export function buildRecentWeeklyReportListAnswer(
  reports: LatestWeeklyReport[],
  requestedLimit: number
): string {
  if (reports.length === 0) {
    return "当前知识库还没有已收录的周报。";
  }

  const lines = reports.map(({ document, range }, index) => {
    return `${index + 1}. [${document.title}](${document.url})（${formatChineseDate(
      range.start
    )}至${formatChineseDate(range.end)}）`;
  });
  const limitNote =
    reports.length < requestedLimit
      ? `（请求 ${requestedLimit} 份，当前共找到 ${reports.length} 份）`
      : "";

  return `知识库中最近的 **${reports.length}** 份周报如下${limitNote}：

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

export function routeWeeklyReportQuery(
  query: string
): WeeklyReportQueryRoute | null {
  const recentLimit = parseRecentWeeklyReportLimit(query);
  if (recentLimit && isRecentWeeklyReportListQuery(query)) {
    return { type: "recent-list", limit: recentLimit };
  }

  const monthFilter = parseMonthFilter(query);
  if (monthFilter && isWeeklyReportCountQuery(query)) {
    return { type: "monthly-count", filter: monthFilter };
  }
  if (monthFilter && isWeeklyReportListQuery(query)) {
    return { type: "monthly-list", filter: monthFilter };
  }
  if (isTotalWeeklyReportCountQuery(query)) {
    return { type: "total-count" };
  }
  if (isLatestWeeklyReportQuery(query)) {
    return {
      type: "latest",
      identity: isLatestWeeklyReportIdentityQuery(query),
    };
  }
  if (isRecentPeriodContentQuery(query)) {
    return { type: "latest", identity: false };
  }

  return null;
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
