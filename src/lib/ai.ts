import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { DEFAULT_MODEL } from "@/lib/config";
import { getServerEnv } from "@/lib/server-env";

export function getGeminiBaseURL(): string {
  const gateway = (
    getServerEnv("GEMINI_GATEWAY_URL") ||
    "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");

  return gateway.endsWith("/v1beta1")
    ? gateway
    : `${gateway}/v1beta1`;
}

export function getKnowledgeModel() {
  const apiKey = getServerEnv("API_SECRET_KEY");
  if (!apiKey) {
    throw new Error("API_SECRET_KEY 未配置，无法生成回答。");
  }

  const google = createGoogleGenerativeAI({
    apiKey,
    baseURL: getGeminiBaseURL(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  return google(getServerEnv("AI_MODEL") || DEFAULT_MODEL);
}
