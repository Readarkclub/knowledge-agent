import { tokenize } from "@/lib/chunking";
import { RETRIEVAL } from "@/lib/config";
import {
  canUseQueryEmbeddings,
  embedTexts,
} from "@/lib/embeddings";
import type {
  KnowledgeChunk,
  KnowledgeIndex,
  SearchResult,
} from "@/lib/types";

const QUERY_NOISE =
  /(请问|请帮我|帮我|麻烦|能否|可以|一下|相关|关于|当前|目前|最近|近期|群里面|群里|群中|聊天中|讨论了|讨论|分享了什么|分享了|有哪些|有哪几|哪几个|哪一些|什么内容|什么|如何|怎么|怎样|为何|为什么|是否|有没有|告诉我|列出|整理|总结|查看)/g;
const MINIMUM_RERANK_SCORE = 0.6;
const DEFAULT_MINIMUM_SEMANTIC_SIMILARITY = 0.88;

export type RetrievalStrategy =
  | "hybrid"
  | "keyword"
  | "rewritten"
  | "metadata"
  | "empty";

export type KnowledgeSearchOutcome = {
  results: SearchResult[];
  strategy: RetrievalStrategy;
  effectiveQuery: string;
};

function queryTerms(query: string): string[] {
  const cleaned = query
    .normalize("NFKC")
    .toLowerCase()
    .replace(QUERY_NOISE, " ");

  return [
    ...new Set(
      tokenize(cleaned).filter(
        (term) =>
          /^[a-z0-9]/.test(term) ||
          (/^[\u3400-\u9fff]+$/.test(term) && term.length >= 2)
      )
    ),
  ];
}

function minimumMatchedTerms(termCount: number): number {
  if (termCount <= 2) {
    return 1;
  }
  if (termCount <= 7) {
    return 2;
  }
  return Math.max(3, Math.ceil(termCount * 0.25));
}

function longestMatchedRun(
  terms: string[],
  chunkTokenSet: Set<string>
): number {
  let longest = 0;
  let current = 0;

  for (const term of terms) {
    if (chunkTokenSet.has(term)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function bm25Scores(chunks: KnowledgeChunk[], queryTokens: string[]): number[] {
  if (!queryTokens.length || !chunks.length) {
    return chunks.map(() => 0);
  }

  const averageLength =
    chunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0) /
    chunks.length;
  const documentFrequency = new Map<string, number>();
  const uniqueQueryTokens = [...new Set(queryTokens)];

  for (const token of uniqueQueryTokens) {
    let count = 0;
    for (const chunk of chunks) {
      if (chunk.tokens.includes(token)) {
        count += 1;
      }
    }
    documentFrequency.set(token, count);
  }

  const k1 = 1.5;
  const b = 0.75;
  return chunks.map((chunk) => {
    const frequencies = new Map<string, number>();
    for (const token of chunk.tokens) {
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
    }

    let score = 0;
    for (const token of queryTokens) {
      const frequency = frequencies.get(token) || 0;
      if (!frequency) {
        continue;
      }

      const df = documentFrequency.get(token) || 0;
      const idf = Math.log(
        1 + (chunks.length - df + 0.5) / (df + 0.5)
      );
      const denominator =
        frequency +
        k1 *
          (1 -
            b +
            b * (chunk.tokens.length / Math.max(averageLength, 1)));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }
    return score;
  });
}

function normalizeScores(values: number[]): number[] {
  if (!values.length) {
    return [];
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (maximum === minimum) {
    return values.map((value) => (value > 0 ? 1 : 0));
  }
  return values.map((value) => (value - minimum) / (maximum - minimum));
}

function excerpt(content: string, query: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  const terms = tokenize(query).filter((term) => term.length >= 2);
  let position = -1;
  for (const term of terms) {
    position = compact.toLowerCase().indexOf(term.toLowerCase());
    if (position >= 0) {
      break;
    }
  }

  if (position < 0 || compact.length <= 500) {
    return compact.slice(0, 520);
  }

  const start = Math.max(0, position - 160);
  const end = Math.min(compact.length, start + 520);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}

function lexicalCandidate(
  item: {
    exactContent: boolean;
    matchedTerms: number;
    termCoverage: number;
    matchedRun: number;
    titleMatches: number;
  },
  termCount: number
): boolean {
  return (
    item.exactContent ||
    (item.matchedTerms >= minimumMatchedTerms(termCount) &&
      (termCount < 4 ||
        (item.termCoverage >= 0.45 &&
          (item.matchedRun >= 2 || item.titleMatches >= 2))))
  );
}

function minimumSemanticSimilarity(index: KnowledgeIndex): number {
  const provider = index.sync.embeddingProvider || "";
  if (
    provider.startsWith("gemini-embedding-") ||
    provider === "embedding-3"
  ) {
    return 0.72;
  }
  return DEFAULT_MINIMUM_SEMANTIC_SIMILARITY;
}

export function searchIndex(
  index: KnowledgeIndex,
  query: string,
  queryEmbedding?: number[],
  limit: number = RETRIEVAL.maxResults
): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) {
    return [];
  }

  const lexicalRaw = bm25Scores(index.chunks, terms);
  const semanticRaw = index.chunks.map((chunk) =>
    chunk.embedding && queryEmbedding
      ? cosineSimilarity(chunk.embedding, queryEmbedding)
      : 0
  );
  const lexical = normalizeScores(lexicalRaw);
  const semantic = normalizeScores(semanticRaw);
  const semanticThreshold = minimumSemanticSimilarity(index);
  const loweredQuery = query.normalize("NFKC").toLowerCase();
  const asksForResources = /(资源|链接|文章|网址|清单)/.test(query);
  const asksForStatistics = /(统计|数量|多少|几条|活跃|消息数)/.test(
    query
  );

  const ranked = index.chunks
    .map((chunk, position) => {
      const chunkTokenSet = new Set(chunk.tokens);
      const matchedTerms = terms.filter((term) =>
        chunkTokenSet.has(term)
      ).length;
      const title = chunk.title.normalize("NFKC").toLowerCase();
      const titleMatches = terms.filter((term) =>
        title.includes(term)
      ).length;
      const matchedRun = longestMatchedRun(terms, chunkTokenSet);
      const exactContent = loweredQuery.length >= 3 &&
        chunk.contextualText
          .normalize("NFKC")
          .toLowerCase()
          .includes(loweredQuery);
      const termCoverage = matchedTerms / terms.length;
      const titleCoverage = titleMatches / terms.length;
      const requiredLatinTerms = terms.filter((term) =>
        /^[a-z0-9]/.test(term)
      );
      const matchedLatinTerms = requiredLatinTerms.filter((term) =>
        chunk.contextualText
          .normalize("NFKC")
          .toLowerCase()
          .includes(term)
      ).length;
      const exactBoost =
        Math.min(0.2, termCoverage * 0.2) +
        Math.min(0.12, titleCoverage * 0.12) +
        (exactContent ? 0.14 : 0);
      const hasSemantic = Boolean(queryEmbedding && chunk.embedding);
      const semanticSimilarity = semanticRaw[position];
      const semanticCandidate =
        hasSemantic &&
        semanticSimilarity >= semanticThreshold &&
        matchedLatinTerms === requiredLatinTerms.length;
      const sectionMultiplier =
        !asksForResources &&
        /(链接|资源|公众号文章)/.test(chunk.heading)
          ? 0.72
          : !asksForStatistics &&
              /(统计信息|每日分布|最活跃发言者)/.test(chunk.heading)
            ? 0.78
            : /(可复用技巧|本周亮点|TOP 话题)/i.test(chunk.heading)
              ? 1.08
              : 1;
      const score = (
        (hasSemantic ? lexical[position] * 0.48 : lexical[position]) +
        (semanticCandidate
          ? semantic[position] * 0.32 + semanticSimilarity * 0.2
          : 0) +
        exactBoost
      ) * sectionMultiplier;

      return {
        chunk,
        score,
        lexicalScore: lexical[position],
        semanticScore: semantic[position],
        matchedTerms,
        matchedRun,
        termCoverage,
        titleMatches,
        exactContent,
        semanticSimilarity,
        semanticCandidate,
      };
    })
    .filter(
      (item) =>
        lexicalCandidate(item, terms.length) ||
        item.semanticCandidate
    )
    .sort((left, right) => right.score - left.score);

  const selected: typeof ranked = [];
  const perDocument = new Map<string, number>();
  for (const item of ranked) {
    const count = perDocument.get(item.chunk.documentId) || 0;
    if (count >= RETRIEVAL.maxResultsPerDocument) {
      continue;
    }
    selected.push(item);
    perDocument.set(item.chunk.documentId, count + 1);
    if (selected.length >= limit) {
      break;
    }
  }

  const topScore = selected[0]?.score || 1;
  return selected
    .map(({ chunk, score, lexicalScore, semanticScore }) => ({
      id: chunk.id,
      documentId: chunk.documentId,
      title: chunk.title,
      parentTitle: chunk.parentTitle,
      heading: chunk.heading,
      url: chunk.url,
      excerpt: excerpt(chunk.content, query),
      score: Math.min(0.99, score / topScore),
      lexicalScore,
      semanticScore,
    }))
    .filter((item) => item.score >= MINIMUM_RERANK_SCORE);
}

const QUERY_REWRITES: Array<{
  pattern: RegExp;
  replacement: string;
}> = [
  { pattern: /智能体/gi, replacement: "Agent" },
  { pattern: /\bAgent\b/gi, replacement: "智能体" },
  { pattern: /大语言模型|大模型/gi, replacement: "LLM" },
  { pattern: /\bLLM\b/gi, replacement: "大模型" },
  { pattern: /检索增强生成|检索增强/gi, replacement: "RAG" },
  { pattern: /\bRAG\b/gi, replacement: "检索增强生成" },
  { pattern: /模型上下文协议|上下文协议/gi, replacement: "MCP" },
  { pattern: /\bMCP\b/gi, replacement: "模型上下文协议" },
  { pattern: /飞书/gi, replacement: "Lark" },
  { pattern: /\bLark\b/gi, replacement: "飞书" },
];

export function rewriteKnowledgeQuery(query: string): string | null {
  const normalized = query.normalize("NFKC").trim();
  for (const { pattern, replacement } of QUERY_REWRITES) {
    pattern.lastIndex = 0;
    if (pattern.test(normalized)) {
      pattern.lastIndex = 0;
      const rewritten = normalized.replace(pattern, replacement).trim();
      return rewritten === normalized ? null : rewritten;
    }
  }
  return null;
}

export function searchDocumentMetadata(
  index: KnowledgeIndex,
  query: string,
  limit: number = RETRIEVAL.maxResults
): SearchResult[] {
  const terms = queryTerms(query);
  if (!terms.length) {
    return [];
  }

  const ranked = index.documents
    .map((document) => {
      const metadata = `${document.title} ${document.parentTitle}`
        .normalize("NFKC")
        .toLowerCase();
      const metadataTokens = new Set(tokenize(metadata));
      const matchedTerms = terms.filter(
        (term) => metadataTokens.has(term) || metadata.includes(term)
      ).length;
      const exactTitle = document.title
        .normalize("NFKC")
        .toLowerCase()
        .includes(query.normalize("NFKC").toLowerCase());
      return {
        document,
        matchedTerms,
        exactTitle,
        score: matchedTerms / terms.length + (exactTitle ? 0.5 : 0),
      };
    })
    .filter(
      (item) =>
        item.exactTitle ||
        item.matchedTerms >= minimumMatchedTerms(terms.length)
    )
    .sort((left, right) => right.score - left.score);

  const topScore = ranked[0]?.score || 1;
  const results: SearchResult[] = [];
  for (const item of ranked) {
    const chunk = index.chunks.find(
      (candidate) => candidate.documentId === item.document.id
    );
    if (!chunk) {
      continue;
    }
    results.push({
      id: chunk.id,
      documentId: chunk.documentId,
      title: chunk.title,
      parentTitle: chunk.parentTitle,
      heading: chunk.heading,
      url: chunk.url,
      excerpt: excerpt(chunk.content, query),
      score: Math.min(0.99, item.score / topScore),
      lexicalScore: Math.min(1, item.matchedTerms / terms.length),
      semanticScore: 0,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

async function queryEmbeddingFor(
  index: KnowledgeIndex,
  query: string
): Promise<number[] | undefined> {
  if (!canUseQueryEmbeddings(index)) {
    return undefined;
  }

  const [embedding] = await embedTexts([query], "query");
  const indexedDimensions = index.chunks.find(
    (chunk) => chunk.embedding?.length
  )?.embedding?.length;
  return indexedDimensions && embedding.length === indexedDimensions
    ? embedding
    : undefined;
}

export async function searchKnowledgeDetailed(
  index: KnowledgeIndex,
  query: string,
  limit: number = RETRIEVAL.maxResults
): Promise<KnowledgeSearchOutcome> {
  let queryEmbedding: number[] | undefined;
  let embeddingFailed = false;
  try {
    queryEmbedding = await queryEmbeddingFor(index, query);
  } catch {
    embeddingFailed = true;
  }

  const primaryResults = searchIndex(index, query, queryEmbedding, limit);
  if (primaryResults.length) {
    return {
      results: primaryResults,
      strategy: queryEmbedding ? "hybrid" : "keyword",
      effectiveQuery: query,
    };
  }

  const rewrittenQuery = rewriteKnowledgeQuery(query);
  if (rewrittenQuery) {
    let rewrittenEmbedding: number[] | undefined;
    if (!embeddingFailed) {
      try {
        rewrittenEmbedding = await queryEmbeddingFor(index, rewrittenQuery);
      } catch {
        embeddingFailed = true;
      }
    }
    const rewrittenResults = searchIndex(
      index,
      rewrittenQuery,
      rewrittenEmbedding,
      limit
    );
    if (rewrittenResults.length) {
      return {
        results: rewrittenResults,
        strategy: "rewritten",
        effectiveQuery: rewrittenQuery,
      };
    }
  }

  const metadataQuery = rewrittenQuery || query;
  const metadataResults = searchDocumentMetadata(
    index,
    metadataQuery,
    limit
  );
  if (metadataResults.length) {
    return {
      results: metadataResults,
      strategy: "metadata",
      effectiveQuery: metadataQuery,
    };
  }

  return {
    results: [],
    strategy: "empty",
    effectiveQuery: metadataQuery,
  };
}

export async function searchKnowledge(
  index: KnowledgeIndex,
  query: string,
  limit: number = RETRIEVAL.maxResults
): Promise<SearchResult[]> {
  return (await searchKnowledgeDetailed(index, query, limit)).results;
}
