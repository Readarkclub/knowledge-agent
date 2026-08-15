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
  applyUsageAccess,
  guardUsageRequest,
} from "@/lib/usage-limits";
import { RETRIEVAL } from "@/lib/config";
import { buildKnowledgeSystemPrompt } from "@/lib/prompt";
import {
  buildRetrievalQuery,
  isSynthesisKnowledgeQuery,
} from "@/lib/query";
import {
  chatRequestSchema,
  parseJsonRequest,
} from "@/lib/request-validation";
import {
  buildAllWeeklyReportCountAnswer,
  buildLatestWeeklyReportAnswer,
  buildRecentWeeklyReportListAnswer,
  buildWeeklyReportCountAnswer,
  buildWeeklyReportListAnswer,
  countWeeklyReports,
  findAllWeeklyReports,
  findLatestWeeklyReport,
  findRecentWeeklyReports,
  latestWeeklyReportSources,
  routeWeeklyReportQuery,
} from "@/lib/reports";
import { searchKnowledgeForQuestion } from "@/lib/search";
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

function getUserTexts(messages: UIMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) =>
      message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

export async function POST(request: Request) {
  let trace = createTrace("");
  const requestId = crypto.randomUUID();
  try {
    const guard = await guardUsageRequest(request, "chat");
    if ("response" in guard) {
      return guard.response;
    }
    const parsed = await parseJsonRequest(request, chatRequestSchema);
    if ("response" in parsed) {
      return parsed.response;
    }
    const messages = parsed.data.messages as UIMessage[];
    const userQueries = getUserTexts(messages);
    const query = userQueries.at(-1) || "";
    if (!query) {
      return Response.json({ error: "没有可处理的问题" }, { status: 400 });
    }
    const retrievalQuery = buildRetrievalQuery(userQueries);

    trace = createTrace(query);
    const index = await readIndex();
    const reportRoute = routeWeeklyReportQuery(retrievalQuery);

    if (reportRoute?.type === "recent-list") {
      const reports = findRecentWeeklyReports(index, reportRoute.limit);
      const answer = buildRecentWeeklyReportListAnswer(
        reports,
        reportRoute.limit
      );
      trace.finish({
        route: "recent-weekly-report-list",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "recent-weekly-report-list"),
        guard.access
      );
    }

    if (reportRoute?.type === "monthly-count") {
      const reports = countWeeklyReports(index, reportRoute.filter);
      const answer = buildWeeklyReportCountAnswer(
        reports,
        reportRoute.filter
      );
      trace.finish({
        route: "weekly-report-count",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "weekly-report-count"),
        guard.access
      );
    }

    if (reportRoute?.type === "monthly-list") {
      const reports = countWeeklyReports(index, reportRoute.filter);
      const answer = buildWeeklyReportListAnswer(
        reports,
        reportRoute.filter
      );
      trace.finish({
        route: "weekly-report-list",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(0, 3),
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "weekly-report-list"),
        guard.access
      );
    }

    if (reportRoute?.type === "total-count") {
      const reports = findAllWeeklyReports(index);
      const answer = buildAllWeeklyReportCountAnswer(reports);
      trace.finish({
        route: "weekly-report-total-count",
        evidenceCount: reports.length,
        topScore: reports.length ? 1 : 0,
        topTitles: reports.map((r) => r.document.title).slice(-3),
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "weekly-report-total-count"),
        guard.access
      );
    }

    const latestKnowledgeReport = findLatestWeeklyReport(index);
    const latestReport =
      reportRoute?.type === "latest" ? latestKnowledgeReport : null;

    if (
      latestReport &&
      reportRoute?.type === "latest" &&
      reportRoute.identity
    ) {
      const answer = buildLatestWeeklyReportAnswer(latestReport);
      trace.finish({
        route: "latest-weekly-report",
        evidenceCount: 1,
        topScore: 1,
        topTitles: [latestReport.document.title],
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "latest-weekly-report"),
        guard.access
      );
    }

    const filteredIndex = latestReport
      ? {
          ...index,
          documents: [latestReport.document],
          chunks: index.chunks.filter(
            (chunk) => chunk.documentId === latestReport.document.id
          ),
        }
      : index;
    const searchOutcome = await searchKnowledgeForQuestion(
      filteredIndex,
      retrievalQuery,
      RETRIEVAL.contextResults
    );
    const sources =
      searchOutcome.results.length || !latestReport
        ? searchOutcome.results
        : latestWeeklyReportSources(
            index,
            retrievalQuery,
            RETRIEVAL.contextResults
          );
    const topScore = sources[0]?.score ?? 0;
    const topTitles = sources.slice(0, 3).map((s) => s.title);

    // 低证据关卡：检索为空时直接返回"未找到"，不进 LLM。
    if (sources.length === 0 || topScore <= EVIDENCE_EMPTY_THRESHOLD) {
      const answer =
        "当前知识库没有找到与该问题相关的依据。建议缩小日期、人物或主题范围后重试。";
      trace.finish({
        route: "evidence-empty",
        evidenceCount: 0,
        topScore,
        topTitles,
        retrievalStrategy: searchOutcome?.strategy,
      });
      return applyUsageAccess(
        streamTextAnswer(answer, "evidence-empty"),
        guard.access
      );
    }

    trace.finish({
      route: "llm",
      evidenceCount: sources.length,
      topScore,
      topTitles,
      retrievalStrategy:
        reportRoute?.type === "latest"
          ? "latest-report"
          : searchOutcome?.strategy,
    });

    const result = streamText({
      model: getKnowledgeModel(),
      system: buildKnowledgeSystemPrompt(sources, {
        synthesis: isSynthesisKnowledgeQuery(retrievalQuery),
        knowledgeCutoff: latestKnowledgeReport?.range.end,
      }),
      messages: await convertToModelMessages(messages),
      maxOutputTokens: 2048,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 0,
          },
        } satisfies GoogleLanguageModelOptions,
      },
      temperature: 0.2,
    });

    // 把证据链接作为 source-url part 随消息下发，而不是只靠模型在正文里
    // 拼出 [来源 N](url)——模型偶尔会漏掉括号里的链接，导致引用文字不可点击。
    // 客户端据此可以在展示前用权威 URL 修补引用标记。
    const stream = createUIMessageStream({
      execute({ writer }) {
        for (const [index, source] of sources.entries()) {
          writer.write({
            type: "source-url",
            sourceId: String(index + 1),
            url: source.url,
            title: source.title,
          });
        }
        writer.merge(result.toUIMessageStream());
      },
    });

    return applyUsageAccess(
      createUIMessageStreamResponse({ stream }),
      guard.access
    );
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
