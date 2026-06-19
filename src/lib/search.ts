import { tokenize } from "@/lib/chunking";
import { embedTexts } from "@/lib/embeddings";
import type {
  KnowledgeChunk,
  KnowledgeIndex,
  SearchResult,
} from "@/lib/types";

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

  if (position < 0 || compact.length <= 260) {
    return compact.slice(0, 280);
  }

  const start = Math.max(0, position - 90);
  const end = Math.min(compact.length, start + 280);
  return `${start > 0 ? "…" : ""}${compact.slice(start, end)}${
    end < compact.length ? "…" : ""
  }`;
}

export function searchIndex(
  index: KnowledgeIndex,
  query: string,
  queryEmbedding?: number[],
  limit = 8
): SearchResult[] {
  const queryTokens = tokenize(query);
  const lexicalRaw = bm25Scores(index.chunks, queryTokens);
  const semanticRaw = index.chunks.map((chunk) =>
    chunk.embedding && queryEmbedding
      ? cosineSimilarity(chunk.embedding, queryEmbedding)
      : 0
  );
  const lexical = normalizeScores(lexicalRaw);
  const semantic = normalizeScores(semanticRaw);
  const loweredQuery = query.normalize("NFKC").toLowerCase();

  const ranked = index.chunks
    .map((chunk, position) => {
      const exactTitle = loweredQuery
        .split(/\s+/)
        .some(
          (term) =>
            term.length >= 2 &&
            chunk.title.normalize("NFKC").toLowerCase().includes(term)
        );
      const exactContent = loweredQuery.length >= 3 &&
        chunk.contextualText
          .normalize("NFKC")
          .toLowerCase()
          .includes(loweredQuery);
      const exactBoost = (exactTitle ? 0.1 : 0) + (exactContent ? 0.14 : 0);
      const hasSemantic = Boolean(queryEmbedding && chunk.embedding);
      const score =
        (hasSemantic ? lexical[position] * 0.42 : lexical[position]) +
        (hasSemantic ? semantic[position] * 0.58 : 0) +
        exactBoost;

      return {
        chunk,
        score,
        lexicalScore: lexical[position],
        semanticScore: semantic[position],
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected: typeof ranked = [];
  const perDocument = new Map<string, number>();
  for (const item of ranked) {
    const count = perDocument.get(item.chunk.documentId) || 0;
    if (count >= 2) {
      continue;
    }
    selected.push(item);
    perDocument.set(item.chunk.documentId, count + 1);
    if (selected.length >= limit) {
      break;
    }
  }

  const topScore = selected[0]?.score || 1;
  return selected.map(({ chunk, score, lexicalScore, semanticScore }) => ({
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
  }));
}

export async function searchKnowledge(
  index: KnowledgeIndex,
  query: string,
  limit = 8
): Promise<SearchResult[]> {
  let queryEmbedding: number[] | undefined;
  const queryEmbeddingsEnabled =
    process.env.DISABLE_QUERY_EMBEDDINGS !== "1" &&
    process.env.VERCEL !== "1";
  if (queryEmbeddingsEnabled && index.sync.embeddedChunkCount > 0) {
    try {
      [queryEmbedding] = await embedTexts([query], "query");
    } catch {
      queryEmbedding = undefined;
    }
  }
  return searchIndex(index, query, queryEmbedding, limit);
}
