/**
 * 结构化追踪日志 —— 知识库 Agent 的"完整工作录像"。
 *
 * 解决的问题：路由是否命中、检索召回质量、最终走了哪条回答路径，
 * 过去全无线索，答错时只能盲调（参见 6 月周报计数 bug）。
 * 输出到 stderr，Vercel / Next.js 会自动采集。
 */

export type TraceRoute =
  | "weekly-report-count"
  | "latest-weekly-report"
  | "evidence-empty"
  | "llm";

export type TraceEntry = {
  /** ISO 时间戳 */
  at: string;
  /** 用户原始问题（截断，避免日志膨胀） */
  query: string;
  /** 命中的回答路径 */
  route: TraceRoute;
  /** 检索命中的证据条数（确定性路径可能为 0） */
  evidenceCount: number;
  /** 最高检索分（归一化后 0~1，无证据时为 0） */
  topScore: number;
  /** 命中的证据标题（最多 3 条，便于人工核对） */
  topTitles: string[];
  /** 耗时（毫秒） */
  durationMs: number;
};

let enabled: boolean | null = null;

function isTraceEnabled(): boolean {
  if (enabled === null) {
    enabled = process.env.KNOWLEDGE_TRACE !== "0";
  }
  return enabled;
}

export function createTrace(query: string): {
  finish: (entry: Omit<TraceEntry, "at" | "query" | "durationMs">) => void;
} {
  const start = Date.now();
  return {
    finish(entry) {
      if (!isTraceEnabled()) {
        return;
      }
      const record: TraceEntry = {
        at: new Date(start).toISOString(),
        query: query.slice(0, 120),
        durationMs: Date.now() - start,
        ...entry,
      };
      process.stderr.write(`[knowledge-trace] ${JSON.stringify(record)}\n`);
    },
  };
}
