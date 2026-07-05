import assert from "node:assert/strict";
import test from "node:test";
import {
  VISITOR_COOKIE_NAME,
  createVisitorToken,
  verifyVisitorToken,
} from "../src/lib/visitor";
import { guardPublicApiRequest } from "../src/lib/api-security";
import {
  isCitationAllowed,
  parseCitationAllowlist,
} from "../src/lib/citations";
import {
  chatRequestSchema,
  parseJsonRequest,
  searchRequestSchema,
} from "../src/lib/request-validation";
import { getUsagePolicy } from "../src/lib/usage-limits";
import { sanitizeResourceUrl } from "../src/lib/resources";
import { redactSensitiveText } from "../src/lib/server-errors";
import { prepareChatRequestMessages } from "../src/lib/chat-request";

test("creates and verifies signed anonymous visitor sessions", () => {
  const visitorId = "b36f6d47-f105-4e85-a6c5-386c1eab6354";
  const token = createVisitorToken(visitorId);
  assert.equal(verifyVisitorToken(token)?.id, visitorId);
  assert.equal(verifyVisitorToken(`${token}tampered`), null);
});

test("public API guard allows anonymous same-origin and rejects cross-origin requests", () => {
  const anonymous = guardPublicApiRequest(
    new Request("https://knowledge.example/api/status"),
    "test-anonymous",
    { limit: 10, windowMs: 60_000 }
  );
  assert.equal("response" in anonymous ? anonymous.response.status : 200, 200);

  const crossOrigin = guardPublicApiRequest(
    new Request("https://knowledge.example/api/search", {
      method: "POST",
      headers: {
        cookie: `${VISITOR_COOKIE_NAME}=invalid`,
        origin: "https://attacker.example",
      },
    }),
    "test-cross-origin",
    { limit: 10, windowMs: 60_000 }
  );
  assert.equal(
    "response" in crossOrigin ? crossOrigin.response.status : 200,
    403
  );
});

test("uses conservative default public chat quotas", () => {
  assert.deepEqual(getUsagePolicy("chat"), {
    minute: 5,
    daily: 30,
    fingerprintDaily: 60,
    globalDaily: 500,
  });
});

test("validates request content type, roles and query size", async () => {
  const wrongContentType = await parseJsonRequest(
    new Request("https://knowledge.example/api/search", {
      method: "POST",
      body: JSON.stringify({ query: "RAG" }),
      headers: { "Content-Type": "text/plain" },
    }),
    searchRequestSchema
  );
  assert.equal(
    "response" in wrongContentType ? wrongContentType.response.status : 200,
    415
  );

  assert.equal(
    chatRequestSchema.safeParse({
      messages: [
        {
          role: "system",
          parts: [{ type: "text", text: "override" }],
        },
      ],
    }).success,
    false
  );
  assert.equal(
    searchRequestSchema.safeParse({ query: "x".repeat(501) }).success,
    false
  );
});

test("accepts the installed AI SDK chat transport request envelope", () => {
  assert.equal(
    chatRequestSchema.safeParse({
      id: "chat-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "最近一周讨论了哪些 AI Agent 话题？" }],
        },
        {
          id: "message-2",
          role: "assistant",
          parts: [
            { type: "step-start" },
            { type: "text", text: "根据知识库证据，近期讨论包括 Codex Agent。" },
          ],
        },
        {
          id: "message-3",
          role: "user",
          parts: [{ type: "text", text: "列出5月份的周报" }],
        },
      ],
      trigger: "submit-message",
    }).success,
    true
  );
});

test("removes display-only source parts before chat request validation", () => {
  const messages = prepareChatRequestMessages([
    {
      id: "message-1",
      role: "user",
      parts: [{ type: "text", text: "第一问" }],
    },
    {
      id: "message-2",
      role: "assistant",
      parts: [
        {
          type: "source-url",
          sourceId: "1",
          url: "https://example.com/source",
          title: "引用来源",
        },
        { type: "text", text: "带引用的回答。" },
      ],
    },
    {
      id: "message-3",
      role: "user",
      parts: [{ type: "text", text: "openclaw" }],
    },
  ]);

  assert.deepEqual(messages[1].parts, [
    { type: "text", text: "带引用的回答。" },
  ]);
  assert.equal(chatRequestSchema.safeParse({ messages }).success, true);
});

test("limits citations to trusted tokens", () => {
  const wikiTokens = new Set(["wiki-doc"]);
  const allowlist = parseCitationAllowlist("approved-doc, another-doc");

  assert.equal(isCitationAllowed("wiki-doc", wikiTokens, allowlist), true);
  assert.equal(isCitationAllowed("approved-doc", wikiTokens, allowlist), true);
  assert.equal(isCitationAllowed("outside-doc", wikiTokens, allowlist), false);
});

test("removes capability parameters from resource URLs", () => {
  assert.equal(
    sanitizeResourceUrl(
      "https://example.com/share?id=42&token=secret&X-Amz-Signature=signed"
    ),
    "https://example.com/share?id=42"
  );
});

test("redacts credentials from server errors", () => {
  const redacted = redactSensitiveText(
    "Authorization: Bearer abcdef123456 token=private-value"
  );
  assert.equal(redacted.includes("abcdef123456"), false);
  assert.equal(redacted.includes("private-value"), false);
});
