import { createHash } from "node:crypto";

export type TraceRoute =
  | "weekly-report-count"
  | "weekly-report-total-count"
  | "weekly-report-list"
  | "recent-weekly-report-list"
  | "latest-weekly-report"
  | "evidence-empty"
  | "llm";

export type TraceEntry = {
  at: string;
  queryHash: string;
  queryLength: number;
  route: TraceRoute;
  evidenceCount: number;
  topScore: number;
  topTitleHashes: string[];
  durationMs: number;
  retrievalStrategy?: string;
};

type TraceInput = {
  route: TraceRoute;
  evidenceCount: number;
  topScore: number;
  topTitles: string[];
  retrievalStrategy?: string;
};

let enabled: boolean | null = null;

function shortHash(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function isTraceEnabled(): boolean {
  if (enabled === null) {
    enabled = process.env.KNOWLEDGE_TRACE === "1";
  }
  return enabled;
}

export function createTrace(query: string): {
  finish: (entry: TraceInput) => void;
} {
  const start = Date.now();
  return {
    finish(entry) {
      if (!isTraceEnabled()) {
        return;
      }

      const record: TraceEntry = {
        at: new Date(start).toISOString(),
        queryHash: shortHash(query, 16),
        queryLength: query.length,
        route: entry.route,
        evidenceCount: entry.evidenceCount,
        topScore: entry.topScore,
        topTitleHashes: entry.topTitles.map((title) => shortHash(title, 12)),
        durationMs: Date.now() - start,
        retrievalStrategy: entry.retrievalStrategy,
      };
      process.stderr.write(`[knowledge-trace] ${JSON.stringify(record)}\n`);
    },
  };
}
