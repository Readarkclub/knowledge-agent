const KNOWLEDGE_NAME_ALIASES: Array<[RegExp, string]> = [
  [/人人知识社/g, "人人智学社"],
  [/人人AI社/gi, "人人智学社"],
  [/人人智学社区/g, "人人智学社"],
];

const CONTEXT_DEPENDENT_FOLLOW_UP =
  /^(?:你)?(?:可以|能否|能不能|能|请)?(?:自己)?(?:从(?:这个|本)?知识库(?:中|里)?)?(?:继续|再|进一步|详细|具体|展开|提炼|总结|归纳|分析|说明)/;

export function normalizeKnowledgeQuery(query: string): string {
  let normalized = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of KNOWLEDGE_NAME_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function isContextDependentFollowUp(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  return (
    CONTEXT_DEPENDENT_FOLLOW_UP.test(compact) ||
    /(?:这个|这些|上述|上面|刚才|前面)(?:问题|内容|经验|话题|活动|观点|结论)?/.test(
      compact
    )
  );
}

export function buildRetrievalQuery(userQueries: string[]): string {
  const normalized = userQueries
    .map(normalizeKnowledgeQuery)
    .filter(Boolean);
  const latest = normalized.at(-1) || "";
  const previous = normalized.at(-2);

  if (!previous || !isContextDependentFollowUp(latest)) {
    return latest;
  }

  return `${previous}；${latest}`;
}

function stripKnowledgeCorpusFraming(query: string): string {
  return query
    .replace(/人人智学社(?:知识库|群聊|社群)?/g, " ")
    .replace(/(?:从|在)?(?:这个|本)?知识库(?:中|里|内)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isRecentKnowledgeQuery(query: string): boolean {
  return /(?:最近|近期|最新|近来|本周|上周|近[一二三四五六七八九十\d]+(?:天|周|月))/.test(
    normalizeKnowledgeQuery(query)
  );
}

export function isSynthesisKnowledgeQuery(query: string): boolean {
  return /(?:总结|归纳|提炼|经验|教训|启示|趋势|共同点|话题|聊了什么|在聊什么|讨论内容|主要内容)/.test(
    normalizeKnowledgeQuery(query)
  );
}

export function buildKnowledgeSearchQueries(query: string): string[] {
  const normalized = normalizeKnowledgeQuery(query);
  const base = stripKnowledgeCorpusFraming(normalized) || normalized;
  const queries = [base];

  if (
    /(?:ai|人工智能)/i.test(base) &&
    /(?:学习|经验|教训|知识管理|提炼|总结)/.test(base)
  ) {
    queries.push(
      "AI 学习 方法",
      "AI 知识管理",
      "AI 实践 经验",
      "AI 使用 技巧",
      "AI 问题 局限",
      "AI 复盘 教训"
    );
  }

  if (/(?:活动|沙龙|交流会|分享会|会议)/.test(base)) {
    queries.push("活动", "线下 沙龙", "分享 交流会");
  }

  if (/(?:话题|在聊|聊了什么|讨论|主题)/.test(base)) {
    queries.push("主要 讨论 内容", "TOP 话题", "本周 亮点");
  }

  return [...new Set(queries.map((item) => item.trim()).filter(Boolean))];
}
