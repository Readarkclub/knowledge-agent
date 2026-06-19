export const KNOWLEDGE_SOURCE = {
  name: "人人智学社群聊摘要",
  rootUrl:
    "https://renrenai.feishu.cn/wiki/S09jwCbqli5GtIkdLWIcwCyhneX",
  domain: "https://renrenai.feishu.cn",
  spaceId: "7488625163303403524",
  rootNodeToken: "S09jwCbqli5GtIkdLWIcwCyhneX",
} as const;

export const RETRIEVAL = {
  maxResults: 8,
  maxResultsPerDocument: 2,
  contextResults: 6,
  chunkSize: 430,
  chunkOverlap: 70,
  embeddingDimensions: 384,
} as const;

export const DEFAULT_MODEL = "glm-4.7-flash";
export const DEFAULT_EMBEDDING_MODEL = "embedding-3";
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const DEFAULT_LOCAL_EMBEDDING_MODEL =
  "Xenova/multilingual-e5-small";
export const ZHIPU_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
