import assert from "node:assert/strict";
import test from "node:test";
import { KNOWLEDGE_QUESTION_SUGGESTIONS } from "../src/lib/suggestions";

test("首页展示五个经过知识库验证的默认问题", () => {
  assert.deepEqual(KNOWLEDGE_QUESTION_SUGGESTIONS, [
    "最近一周群里讨论了哪些 AI Agent 话题？",
    "最近人人智学社有哪些活动？",
    "整理近期关于 Claude、Codex 与飞书的实践分享",
    "从知识库总结学习 AI 的经验和教训",
    "最近有哪些值得关注的 AI 产品和行业动态？",
  ]);
});
