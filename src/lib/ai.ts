import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { DEFAULT_MODEL, ZHIPU_BASE_URL } from "@/lib/config";
import { getServerEnv } from "@/lib/server-env";

export function getKnowledgeModel() {
  const apiKey = getServerEnv("ZHIPU_API_KEY");
  if (!apiKey) {
    throw new Error("ZHIPU_API_KEY 未配置，无法生成回答。");
  }

  const zhipu = createOpenAICompatible({
    name: "zhipu",
    apiKey,
    baseURL: getServerEnv("AI_BASE_URL") || ZHIPU_BASE_URL,
    includeUsage: true,
  });

  return zhipu(getServerEnv("AI_MODEL") || DEFAULT_MODEL);
}
