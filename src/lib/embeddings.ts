import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  GEMINI_BASE_URL,
  RETRIEVAL,
  ZHIPU_BASE_URL,
} from "@/lib/config";
import { getServerEnv } from "@/lib/server-env";
import path from "node:path";

type EmbeddingPurpose = "document" | "query";

type ZhipuEmbeddingResponse = {
  data: Array<{
    index: number;
    embedding: number[];
  }>;
};

type GeminiEmbeddingResponse = {
  embeddings: Array<{
    values: number[];
  }>;
};

type LocalExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{
  tolist(): number[][];
}>;

let localExtractorPromise: Promise<LocalExtractor> | null = null;

function selectedProvider(): "local" | "gemini" | "zhipu" {
  const requested = getServerEnv("EMBEDDING_PROVIDER")?.toLowerCase();
  if (requested === "gemini" || requested === "zhipu") {
    return requested;
  }
  return "local";
}

export function getEmbeddingProviderName(): string | undefined {
  const provider = selectedProvider();
  if (provider === "local") {
    return (
      getServerEnv("LOCAL_EMBEDDING_MODEL") ||
      DEFAULT_LOCAL_EMBEDDING_MODEL
    );
  }
  if (provider === "gemini" && getServerEnv("GEMINI_KEY")) {
    return getServerEnv("GEMINI_EMBEDDING_MODEL") ||
      DEFAULT_GEMINI_EMBEDDING_MODEL;
  }
  if (provider === "zhipu" && getServerEnv("ZHIPU_API_KEY")) {
    return getServerEnv("EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL;
  }
  return undefined;
}

export function hasEmbeddingProvider(): boolean {
  return Boolean(getEmbeddingProviderName());
}

function geminiText(text: string, purpose: EmbeddingPurpose): string {
  return purpose === "query"
    ? `task: search result | query: ${text}`
    : `title: knowledge chunk | text: ${text}`;
}

function localText(text: string, purpose: EmbeddingPurpose): string {
  return purpose === "query" ? `query: ${text}` : `passage: ${text}`;
}

async function getLocalExtractor(): Promise<LocalExtractor> {
  if (!localExtractorPromise) {
    localExtractorPromise = (async () => {
      const { env, pipeline } = await import("@huggingface/transformers");
      env.cacheDir = path.join(process.cwd(), ".cache", "transformers");
      const model =
        getServerEnv("LOCAL_EMBEDDING_MODEL") ||
        DEFAULT_LOCAL_EMBEDDING_MODEL;
      return (await pipeline("feature-extraction", model, {
        dtype: "q8",
      })) as unknown as LocalExtractor;
    })();
  }
  return localExtractorPromise;
}

async function embedLocally(texts: string[]): Promise<number[][]> {
  const extractor = await getLocalExtractor();
  const output = await extractor(
    texts.map((text) => localText(text, "document")),
    {
      pooling: "mean",
      normalize: true,
    }
  );
  return output.tolist();
}

async function embedLocallyForPurpose(
  texts: string[],
  purpose: EmbeddingPurpose
): Promise<number[][]> {
  const extractor = await getLocalExtractor();
  const output = await extractor(
    texts.map((text) => localText(text, purpose)),
    {
      pooling: "mean",
      normalize: true,
    }
  );
  return output.tolist();
}

async function embedWithGemini(
  texts: string[],
  purpose: EmbeddingPurpose
): Promise<number[][]> {
  const apiKey = getServerEnv("GEMINI_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_KEY 未配置");
  }

  const model =
    getServerEnv("GEMINI_EMBEDDING_MODEL") ||
    DEFAULT_GEMINI_EMBEDDING_MODEL;
  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: {
            parts: [{ text: geminiText(text, purpose) }],
          },
          outputDimensionality: RETRIEVAL.embeddingDimensions,
        })),
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini Embedding API ${response.status}: ${detail.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as GeminiEmbeddingResponse;
  return payload.embeddings.map((item) => item.values);
}

async function embedWithZhipu(texts: string[]): Promise<number[][]> {
  const apiKey = getServerEnv("ZHIPU_API_KEY");
  if (!apiKey) {
    throw new Error("ZHIPU_API_KEY 未配置");
  }

  const response = await fetch(`${ZHIPU_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:
        getServerEnv("EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL,
      input: texts,
      dimensions: RETRIEVAL.embeddingDimensions,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Embedding API ${response.status}: ${detail.slice(0, 300)}`);
  }

  const payload = (await response.json()) as ZhipuEmbeddingResponse;
  return payload.data
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);
}

export async function embedTexts(
  texts: string[],
  purpose: EmbeddingPurpose
): Promise<number[][]> {
  if (!texts.length) {
    return [];
  }

  const provider = selectedProvider();
  if (provider === "local") {
    return purpose === "document"
      ? embedLocally(texts)
      : embedLocallyForPurpose(texts, purpose);
  }
  if (provider === "gemini") {
    return embedWithGemini(texts, purpose);
  }
  return embedWithZhipu(texts);
}

export async function embedInBatches(
  texts: string[],
  purpose: EmbeddingPurpose,
  batchSize = 16
): Promise<number[][]> {
  const result: number[][] = [];

  for (let start = 0; start < texts.length; start += batchSize) {
    const batch = texts.slice(start, start + batchSize);
    result.push(...(await embedTexts(batch, purpose)));
  }

  return result;
}
