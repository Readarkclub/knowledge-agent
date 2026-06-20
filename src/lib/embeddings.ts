import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  GEMINI_BASE_URL,
  RETRIEVAL,
  ZHIPU_BASE_URL,
} from "@/lib/config";
import { getServerEnv } from "@/lib/server-env";
import type { KnowledgeIndex } from "@/lib/types";
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

type GeminiSingleEmbeddingResponse = {
  embedding: {
    values: number[];
  };
};

type LocalExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{
  tolist(): number[][];
}>;

let localExtractorPromise: Promise<LocalExtractor> | null = null;

export const ZHIPU_EMBEDDING_DIMENSIONS = 512;

export function buildZhipuEmbeddingRequest(texts: string[]) {
  return {
    model:
      getServerEnv("EMBEDDING_MODEL") || DEFAULT_EMBEDDING_MODEL,
    input: texts,
    dimensions: ZHIPU_EMBEDDING_DIMENSIONS,
  };
}

function selectedProvider(): "local" | "gemini" | "zhipu" {
  const requested = getServerEnv("EMBEDDING_PROVIDER")?.toLowerCase();
  if (requested === "gemini" || requested === "zhipu") {
    return requested;
  }
  return "local";
}

function geminiConnection(): {
  apiKey: string;
  baseUrl: string;
  supportsBatch: boolean;
} | null {
  const officialKey = getServerEnv("GEMINI_KEY");
  if (officialKey) {
    return {
      apiKey: officialKey,
      baseUrl: GEMINI_BASE_URL,
      supportsBatch: true,
    };
  }

  const gatewayKey = getServerEnv("API_SECRET_KEY");
  const gatewayUrl = getServerEnv("GEMINI_GATEWAY_URL")?.replace(/\/+$/, "");
  if (!gatewayKey || !gatewayUrl) {
    return null;
  }
  return {
    apiKey: gatewayKey,
    baseUrl: gatewayUrl.endsWith("/v1beta1")
      ? gatewayUrl
      : `${gatewayUrl}/v1beta1`,
    supportsBatch: false,
  };
}

export function getEmbeddingProviderName(): string | undefined {
  const provider = selectedProvider();
  if (provider === "local") {
    return (
      getServerEnv("LOCAL_EMBEDDING_MODEL") ||
      DEFAULT_LOCAL_EMBEDDING_MODEL
    );
  }
  if (provider === "gemini" && geminiConnection()) {
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithEmbeddingRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      await delay(800 * 2 ** attempt);
      continue;
    }
    if (
      response.ok ||
      (response.status !== 429 && response.status < 500)
    ) {
      return response;
    }
    if (attempt < 3) {
      await response.text();
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const retryDelay =
        response.status === 429
          ? Math.max(
              Number.isFinite(retryAfterSeconds)
                ? retryAfterSeconds * 1000
                : 0,
              15_000 * (attempt + 1)
            )
          : 800 * 2 ** attempt;
      await delay(retryDelay);
    }
  }
  return response as Response;
}

/**
 * 查询向量只能与同一模型生成的文档向量比较。
 * Vercel 不加载本地 Transformer；线上 Hybrid 需使用远程向量模型重建索引。
 */
export function canUseQueryEmbeddings(index: KnowledgeIndex): boolean {
  if (
    process.env.DISABLE_QUERY_EMBEDDINGS === "1" ||
    index.sync.embeddedChunkCount === 0
  ) {
    return false;
  }

  const provider = selectedProvider();
  const providerName = getEmbeddingProviderName();
  if (!providerName || index.sync.embeddingProvider !== providerName) {
    return false;
  }

  return !(process.env.VERCEL === "1" && provider === "local");
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
  const connection = geminiConnection();
  if (!connection) {
    throw new Error(
      "Gemini Embedding 未配置：需要 GEMINI_KEY，或 API_SECRET_KEY + GEMINI_GATEWAY_URL"
    );
  }

  const model =
    getServerEnv("GEMINI_EMBEDDING_MODEL") ||
    DEFAULT_GEMINI_EMBEDDING_MODEL;
  const taskType =
    purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
  const headers = {
    Authorization: `Bearer ${connection.apiKey}`,
    "Content-Type": "application/json",
    "x-goog-api-key": connection.apiKey,
  };

  if (!connection.supportsBatch) {
    return Promise.all(
      texts.map(async (text) => {
        const response = await fetchWithEmbeddingRetry(
          `${connection.baseUrl}/models/${model}:embedContent`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              taskType,
              content: {
                parts: [{ text }],
              },
              outputDimensionality: RETRIEVAL.embeddingDimensions,
            }),
          }
        );
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(
            `Gemini Embedding API ${response.status}: ${detail.slice(0, 300)}`
          );
        }
        const payload =
          (await response.json()) as GeminiSingleEmbeddingResponse;
        return payload.embedding.values;
      })
    );
  }

  const response = await fetchWithEmbeddingRetry(
    `${connection.baseUrl}/models/${model}:batchEmbedContents`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: {
            parts: [{ text }],
          },
          taskType,
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
    body: JSON.stringify(buildZhipuEmbeddingRequest(texts)),
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
  const connection =
    selectedProvider() === "gemini" ? geminiConnection() : null;
  const effectiveBatchSize =
    connection && !connection.supportsBatch
      ? Math.min(batchSize, 8)
      : batchSize;

  for (let start = 0; start < texts.length; start += effectiveBatchSize) {
    const batch = texts.slice(start, start + effectiveBatchSize);
    result.push(...(await embedTexts(batch, purpose)));
  }

  return result;
}
