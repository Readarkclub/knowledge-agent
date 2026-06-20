import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  verifyCredentials,
  verifySessionToken,
} from "../src/lib/auth";
import { guardApiRequest } from "../src/lib/api-security";
import {
  isCitationAllowed,
  parseCitationAllowlist,
} from "../src/lib/citations";
import {
  chatRequestSchema,
  parseJsonRequest,
  searchRequestSchema,
} from "../src/lib/request-validation";
import { sanitizeResourceUrl } from "../src/lib/resources";
import { redactSensitiveText } from "../src/lib/server-errors";

function withAuthEnvironment(run: () => void) {
  const previous = {
    username: process.env.AUTH_USERNAME,
    password: process.env.AUTH_PASSWORD,
    secret: process.env.AUTH_SESSION_SECRET,
  };
  process.env.AUTH_USERNAME = "admin";
  process.env.AUTH_PASSWORD = "correct-password";
  process.env.AUTH_SESSION_SECRET =
    "test-session-secret-that-is-longer-than-32-characters";

  try {
    run();
  } finally {
    if (previous.username === undefined) delete process.env.AUTH_USERNAME;
    else process.env.AUTH_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.AUTH_PASSWORD;
    else process.env.AUTH_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previous.secret;
  }
}

test("creates and verifies signed authentication sessions", () => {
  withAuthEnvironment(() => {
    assert.equal(verifyCredentials("admin", "correct-password"), true);
    assert.equal(verifyCredentials("admin", "wrong-password"), false);

    const token = createSessionToken("admin");
    assert.equal(verifySessionToken(token)?.sub, "admin");
    assert.equal(verifySessionToken(`${token}tampered`), null);
  });
});

test("API guard rejects missing sessions and cross-origin requests", () => {
  withAuthEnvironment(() => {
    const unauthenticated = guardApiRequest(
      new Request("https://knowledge.example/api/search"),
      "test-unauthenticated",
      { limit: 10, windowMs: 60_000 }
    );
    assert.equal(
      "response" in unauthenticated
        ? unauthenticated.response.status
        : 200,
      401
    );

    const token = createSessionToken("admin");
    const crossOrigin = guardApiRequest(
      new Request("https://knowledge.example/api/search", {
        method: "POST",
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
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

test("accepts the AI SDK chat transport request envelope", () => {
  assert.equal(
    chatRequestSchema.safeParse({
      id: "chat-1",
      messages: [
        {
          id: "message-1",
          role: "user",
          parts: [{ type: "text", text: "最近一周讨论了哪些 AI Agent 话题？" }],
        },
      ],
      trigger: "submit-user-message",
      messageId: "message-1",
    }).success,
    true
  );
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
