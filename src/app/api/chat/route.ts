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
  findLatestWeeklyReport,
  isLatestWeeklyReportIdentityQuery,
  isLatestWeeklyReportQuery,
  latestWeeklyReportSources,
} from "@/lib/reports";
import { searchKnowledge } from "@/lib/search";
import { readIndex } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  try {
    const { messages }: { messages: UIMessage[] } = await request.json();
    const query = getLatestUserText(messages);
    if (!query) {
      return Response.json({ error: "没有可处理的问题" }, { status: 400 });
    }

    const index = await readIndex();
    const latestReportQuery = isLatestWeeklyReportQuery(query);
    const latestReport = latestReportQuery
      ? findLatestWeeklyReport(index)
      : null;
    const sources = latestReportQuery
      ? latestWeeklyReportSources(index, query, RETRIEVAL.contextResults)
      : await searchKnowledge(index, query, RETRIEVAL.contextResults);

    if (
      latestReport &&
      isLatestWeeklyReportIdentityQuery(query)
    ) {
      const answer = buildLatestWeeklyReportAnswer(latestReport);
      const stream = createUIMessageStream({
        execute({ writer }) {
          const id = "latest-weekly-report";
          writer.write({ type: "text-start", id });
          writer.write({ type: "text-delta", id, delta: answer });
          writer.write({ type: "text-end", id });
        },
      });

      return createUIMessageStreamResponse({ stream });
    }

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
    return Response.json(
      {
        error: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
