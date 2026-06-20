import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import type { GoogleLanguageModelOptions } from "@ai-sdk/google";
import { getKnowledgeModel } from "@/lib/ai";
import {
  guardApiRequest,
  rateLimitHeaders,
} from "@/lib/api-security";
import { RETRIEVAL } from "@/lib/config";
import { buildKnowledgeSystemPrompt } from "@/lib/prompt";
import {
  chatRequestSchema,
  parseJsonRequest,
} from "@/lib/request-validation";
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
} from "@/lib/reports";
import { searchKnowledge } from "@/lib/search";
import {
  internalErrorResponse,
  reportServerError,
} from "@/lib/server-errors";
import { readIndex } from "@/lib/store";
import { createTrace } from "@/lib/trace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 检索证据的置信度关卡（Stage Gate）。
 * 当证据完全缺失时，确定性返回"未找到"，不把空证据喂给 LLM
 * 靠提示词去"祈求"它承认不知道（这正是幻觉答错的根因模式）。
 * 用代码强制执行，而非提示词 —— 参见《状态机与 workflow》。
 */
const EVIDENCE_EMPTY_THRESHOLD = 0;

function streamTextAnswer(
  answer: string,
  id: string,
  headers: HeadersInit = {}
) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: answer });
      writer.write({ type: "text-end", id });
    },
  });
  const response = createUIMessageStreamResponse({ stream });
  const responseHeaders = new Headers(headers);
  responseHeaders.forEach((value, key) => response.headers.set(key, value));
  return response;
}

function getLatestUserText(messages: UIMessage[]): string {
  const message = [...messages]
    .reverse()
    .find((item) => item.role === "user");

  return (
    message?.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim() || ""
  );
}

export async function POST(request: Request) {
  let trace = createTrace("");
  const requestId = crypto.randomUUID();
  try {
    const guard = guardApiRequest(request, "chat", {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if ("response" in guard) {
      return guard.response;
    }
    const headers = rateLimitHeaders(guard.rateLimit);

    const parsed = await parseJsonRequest(request, chatRequestSchema);
    if ("response" in parsed) {
      return parsed.response;
    }
    const messages = parsed.data.messages as UIMessage[];
    const query = getLatestUserText(messages);
    if (!query) {
      return Response.json({ error: "没有可处理的问题" }, { status: 400 });
    }

    trace = createTrace(query);
    const index = await readIndex();
    const monthFilter = parseMonthFilter(query);
    const recentReportLimit = parseRecentWeeklyReportLimit(query);

    if (
      recentReportLimit &&
      isRecentWeeklyReportListQuery(query)
    ) {
      const reports = findRecentWeeklyReports(index, recentReportLimit);
      const answer = buildRecentWeeklyReportListAnswer(
        reports,
        recentReportLimit
      );
      trace.finish({
        route: "recent-weekly-report-list",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return streamTextAnswer(answer, "recent-weekly-report-list", headers);
    }

    if (monthFilter && isWeeklyReportCountQuery(query)) {
      const reports = countWeeklyReports(index, monthFilter);
      const answer = buildWeeklyReportCountAnswer(reports, monthFilter);
      trace.finish({
        route: "weekly-report-count",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return streamTextAnswer(answer, "weekly-report-count", headers);
    }

    if (monthFilter && isWeeklyReportListQuery(query)) {
      const reports = countWeeklyReports(index, monthFilter);
      const answer = buildWeeklyReportListAnswer(reports, monthFilter);
      trace.finish({
        route: "weekly-report-list",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return streamTextAnswer(answer, "weekly-report-list", headers);
    }

    const latestReportQuery = isLatestWeeklyReportQuery(query);
    const latestReport = latestReportQuery
      ? findLatestWeeklyReport(index)
      : null;
    const sources = latestReportQuery
      ? latestWeeklyReportSources(index, query, RETRIEVAL.contextResults)
      : await searchKnowledge(index, query, RETRIEVAL.contextResults);

    const topScore = sources[0]?.score ?? 0;
    const topTitles = sources.slice(0, 3).map((s) => s.title);

    if (latestReport && isLatestWeeklyReportIdentityQuery(query)) {
      const answer = buildLatestWeeklyReportAnswer(latestReport);
      trace.finish({
        route: "latest-weekly-report",
        evidenceCount: 1,
        topScore: 1,
        topTitles: [latestReport.document.title],
      });
      return streamTextAnswer(answer, "latest-weekly-report", headers);
    }

    // 低证据关卡：检索为空时直接返回"未找到"，不进 LLM。
    if (sources.length === 0 || topScore <= EVIDENCE_EMPTY_THRESHOLD) {
      const answer =
        "当前知识库没有找到与该问题相关的依据。建议缩小日期、人物或主题范围后重试。";
      trace.finish({
        route: "evidence-empty",
        evidenceCount: 0,
        topScore,
        topTitles,
      });
      return streamTextAnswer(answer, "evidence-empty", headers);
    }

    trace.finish({
      route: "llm",
      evidenceCount: sources.length,
      topScore,
      topTitles,
    });

    const result = streamText({
      model: getKnowledgeModel(),
      system: buildKnowledgeSystemPrompt(sources),
      messages: await convertToModelMessages(messages),
      maxOutputTokens: 4096,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        } satisfies GoogleLanguageModelOptions,
      },
      temperature: 0.2,
    });

    const response = result.toUIMessageStreamResponse();
    const responseHeaders = new Headers(headers);
    responseHeaders.forEach((value, key) => response.headers.set(key, value));
    return response;
  } catch (error) {
    trace.finish({
      route: "llm",
      evidenceCount: 0,
      topScore: 0,
      topTitles: [],
    });
    reportServerError("chat", error, requestId);
    return internalErrorResponse(requestId);
  }
}
