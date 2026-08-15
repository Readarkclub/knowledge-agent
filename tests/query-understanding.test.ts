import assert from "node:assert/strict";
import test from "node:test";
import { tokenize } from "../src/lib/chunking";
import {
  buildKnowledgeSearchQueries,
  buildRetrievalQuery,
  normalizeKnowledgeQuery,
} from "../src/lib/query";
import { buildKnowledgeSystemPrompt } from "../src/lib/prompt";
import { searchKnowledgeForQuestion } from "../src/lib/search";
import { emptyIndex } from "../src/lib/store";
import type { KnowledgeDocument } from "../src/lib/types";

function document(
  id: string,
  title: string
): KnowledgeDocument {
  return {
    id,
    nodeToken: id,
    objToken: id,
    title,
    parentTitle: "群聊摘要",
    url: `https://example.com/${id}`,
    revisionId: 1,
    contentHash: id,
    syncedAt: "2026-08-15T00:00:00.000Z",
    chunkCount: 1,
  };
}

test("知识库名称口误会归一为人人智学社", () => {
  assert.equal(
    normalizeKnowledgeQuery("最近人人知识社在聊哪些话题？"),
    "最近人人智学社在聊哪些话题?"
  );
});

test("省略主题的追问会继承上一轮用户问题", () => {
  const query = buildRetrievalQuery([
    "从这个知识库总结学习AI的经验教训",
    "你可以自己从知识库中提炼经验吗？",
  ]);

  assert.match(query, /学习AI的经验教训/);
  assert.match(query, /提炼经验/);
});

test("概括型学习问题会生成多个互补检索方向", () => {
  const queries = buildKnowledgeSearchQueries(
    "从这个知识库总结学习AI的经验教训"
  );

  assert(queries.length >= 4);
  assert(queries.some((query) => /知识管理/.test(query)));
  assert(queries.some((query) => /实践.*经验/.test(query)));
  assert(queries.some((query) => /问题.*局限/.test(query)));
});

test("概括型问题可以从多篇文档聚合学习经验", async () => {
  const index = emptyIndex();
  index.documents = [
    document("method", "人人智学社报告2026-01-01~2026-01-07"),
    document("practice", "人人智学社报告2026-01-08~2026-01-14"),
    document("limits", "人人智学社报告2026-01-15~2026-01-21"),
  ];
  index.chunks = [
    {
      id: "method:0",
      documentId: "method",
      nodeToken: "method",
      title: index.documents[0].title,
      parentTitle: "群聊摘要",
      heading: "AI学习与知识管理",
      url: "https://example.com/method",
      content: "AI学习方法包括建立知识库，并持续整理知识管理流程。",
      contextualText: "AI学习方法包括建立知识库，并持续整理知识管理流程。",
      tokens: tokenize("AI学习方法包括建立知识库，并持续整理知识管理流程。"),
    },
    {
      id: "practice:0",
      documentId: "practice",
      nodeToken: "practice",
      title: index.documents[1].title,
      parentTitle: "群聊摘要",
      heading: "AI实践经验",
      url: "https://example.com/practice",
      content: "AI工具要放进真实项目反复实践，积累使用经验。",
      contextualText: "AI工具要放进真实项目反复实践，积累使用经验。",
      tokens: tokenize("AI工具要放进真实项目反复实践，积累使用经验。"),
    },
    {
      id: "limits:0",
      documentId: "limits",
      nodeToken: "limits",
      title: index.documents[2].title,
      parentTitle: "群聊摘要",
      heading: "问题与局限",
      url: "https://example.com/limits",
      content: "AI学习中的常见问题是只看演示、不做练习，也要理解模型局限。",
      contextualText: "AI学习中的常见问题是只看演示、不做练习，也要理解模型局限。",
      tokens: tokenize("AI学习中的常见问题是只看演示、不做练习，也要理解模型局限。"),
    },
  ];

  const outcome = await searchKnowledgeForQuestion(
    index,
    "从这个知识库总结学习AI的经验教训",
    6
  );

  assert.equal(new Set(outcome.results.map((result) => result.documentId)).size, 3);
});

test("包含多个条件的长句也能拆分为可召回的学习主题", async () => {
  const index = emptyIndex();
  index.documents = [
    document("method", "人人智学社报告2026-01-01~2026-01-07"),
    document("practice", "人人智学社报告2026-01-08~2026-01-14"),
    document("limits", "人人智学社报告2026-01-15~2026-01-21"),
  ];
  index.chunks = [
    {
      id: "method:0",
      documentId: "method",
      nodeToken: "method",
      title: index.documents[0].title,
      parentTitle: "群聊摘要",
      heading: "学习方法",
      url: "https://example.com/method",
      content: "AI学习需要建立自己的知识管理方法。",
      contextualText: "AI学习需要建立自己的知识管理方法。",
      tokens: tokenize("AI学习需要建立自己的知识管理方法。"),
    },
    {
      id: "practice:0",
      documentId: "practice",
      nodeToken: "practice",
      title: index.documents[1].title,
      parentTitle: "群聊摘要",
      heading: "实践经验",
      url: "https://example.com/practice",
      content: "AI工具要通过真实项目实践来积累经验。",
      contextualText: "AI工具要通过真实项目实践来积累经验。",
      tokens: tokenize("AI工具要通过真实项目实践来积累经验。"),
    },
    {
      id: "limits:0",
      documentId: "limits",
      nodeToken: "limits",
      title: index.documents[2].title,
      parentTitle: "群聊摘要",
      heading: "问题与局限",
      url: "https://example.com/limits",
      content: "常见问题是只看演示却不练习，也忽略模型局限。",
      contextualText: "常见问题是只看演示却不练习，也忽略模型局限。",
      tokens: tokenize("常见问题是只看演示却不练习，也忽略模型局限。"),
    },
  ];

  const outcome = await searchKnowledgeForQuestion(
    index,
    "请你结合知识库里大家前后几次讨论，详细总结普通人学习人工智能工具时，怎样通过真实项目积累经验，并避免只看不练的问题？",
    6
  );

  assert.equal(new Set(outcome.results.map((result) => result.documentId)).size, 3);
});

test("最近活动优先返回日期更新的周报证据", async () => {
  const index = emptyIndex();
  index.documents = [
    document("older", "人人智学社报告2025-11-24~2025-11-30"),
    document("newer", "人人智学社报告2025-12-22~2025-12-28"),
  ];
  index.chunks = [
    {
      id: "older:0",
      documentId: "older",
      nodeToken: "older",
      title: index.documents[0].title,
      parentTitle: "群聊摘要",
      heading: "线下活动",
      url: "https://example.com/older",
      content: "组织了一次AI线下活动。",
      contextualText: "组织了一次AI线下活动。",
      tokens: tokenize("组织了一次AI线下活动。"),
    },
    {
      id: "newer:0",
      documentId: "newer",
      nodeToken: "newer",
      title: index.documents[1].title,
      parentTitle: "群聊摘要",
      heading: "个人AI使用经验交流会",
      url: "https://example.com/newer",
      content: "举办个人AI使用经验交流活动。",
      contextualText: "举办个人AI使用经验交流活动。",
      tokens: tokenize("举办个人AI使用经验交流活动。"),
    },
  ];

  const outcome = await searchKnowledgeForQuestion(
    index,
    "最近人人知识社有哪些活动？",
    4
  );

  assert.equal(outcome.results[0]?.documentId, "newer");
});

test("概括回答提示词允许有依据的提炼并声明数据截止日期", () => {
  const prompt = buildKnowledgeSystemPrompt([], {
    synthesis: true,
    knowledgeCutoff: "2026-04-12",
  });

  assert.match(prompt, /综合多条证据/);
  assert.match(prompt, /不要求原文直接出现/);
  assert.match(prompt, /2026-04-12/);
});
