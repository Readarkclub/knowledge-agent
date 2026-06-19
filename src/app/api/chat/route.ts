import {
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";
import { getKnowledgeModel } from "@/lib/ai";
import { RETRIEVAL } from "@/lib/config";
import { buildKnowledgeSystemPrompt } from "@/lib/prompt";
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
    const sources = await searchKnowledge(
      index,
      query,
      RETRIEVAL.contextResults
    );

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
