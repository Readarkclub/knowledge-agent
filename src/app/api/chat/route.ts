import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type UIMessage,
} from "ai";
import { getKnowledgeModel } from "@/lib/ai";
import { RETRIEVAL } from "@/lib/config";
import { buildKnowledgeSystemPrompt } from "@/lib/prompt";
import {
  buildLatestWeeklyReportAnswer,
  buildWeeklyReportCountAnswer,
  countWeeklyReports,
  findLatestWeeklyReport,
  isLatestWeeklyReportIdentityQuery,
  isLatestWeeklyReportQuery,
  isWeeklyReportCountQuery,
  latestWeeklyReportSources,
  parseMonthFilter,
} from "@/lib/reports";
import { searchKnowledge } from "@/lib/search";
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

function streamTextAnswer(answer: string, id: string) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: answer });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
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
  try {
    const { messages }: { messages: UIMessage[] } = await request.json();
    const query = getLatestUserText(messages);
    if (!query) {
      return Response.json({ error: "没有可处理的问题" }, { status: 400 });
    }

    trace = createTrace(query);
    const index = await readIndex();
    const latestReportQuery = isLatestWeeklyReportQuery(query);
    const latestReport = latestReportQuery
      ? findLatestWeeklyReport(index)
      : null;
    const sources = latestReportQuery
      ? latestWeeklyReportSources(index, query, RETRIEVAL.contextResults)
      : await searchKnowledge(index, query, RETRIEVAL.contextResults);

    const topScore = sources[0]?.score ?? 0;
    const topTitles = sources.slice(0, 3).map((s) => s.title);

    if (isWeeklyReportCountQuery(query)) {
      const filter = parseMonthFilter(query);
      if (filter) {
        const reports = countWeeklyReports(index, filter);
        const answer = buildWeeklyReportCountAnswer(reports, filter);
        trace.finish({
          route: "weekly-report-count",
          evidenceCount: reports.length,
          topScore: 0,
          topTitles: reports.map((r) => r.document.title).slice(0, 3),
        });
        return streamTextAnswer(answer, "weekly-report-count");
      }
    }

    if (latestReport && isLatestWeeklyReportIdentityQuery(query)) {
      const answer = buildLatestWeeklyReportAnswer(latestReport);
      trace.finish({
        route: "latest-weekly-report",
        evidenceCount: 1,
        topScore: 1,
        topTitles: [latestReport.document.title],
      });
      return streamTextAnswer(answer, "latest-weekly-report");
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
      return streamTextAnswer(answer, "evidence-empty");
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
        zhipu: {
          thinking: {
            type: "disabled",
          },
        },
      },
      temperature: 0.2,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    trace.finish({
      route: "llm",
      evidenceCount: 0,
      topScore: 0,
      topTitles: [],
    });
    return Response.json(
      {
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
