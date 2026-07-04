import assert from "node:assert/strict";
import test from "node:test";
import { embedTexts } from "../src/lib/embeddings";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function withZhipuEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalProvider = process.env.EMBEDDING_PROVIDER;
  const originalKey = process.env.ZHIPU_API_KEY;
  process.env.EMBEDDING_PROVIDER = "zhipu";
  process.env.ZHIPU_API_KEY = "test-key";
  return run().finally(() => {
    if (originalProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = originalProvider;
    }
    if (originalKey === undefined) {
      delete process.env.ZHIPU_API_KEY;
    } else {
      process.env.ZHIPU_API_KEY = originalKey;
    }
  });
}

async function withStubbedFetch<T>(
  handler: (input: FetchInput, init?: FetchInit) => Response,
  run: () => Promise<T>
): Promise<{ result: T; calls: number }> {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    calls += 1;
    return handler(input, init);
  }) as typeof fetch;
  try {
    const result = await run();
    return { result, calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function vectorFor(text: string): number[] {
  return [text.codePointAt(text.length - 1) || 0, text.length];
}

function zhipuResponse(texts: string[]): Response {
  return new Response(
    JSON.stringify({
      data: texts.map((text, index) => ({
        index,
        embedding: vectorFor(text),
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function requestTexts(init?: FetchInit): string[] {
  const body = JSON.parse(String(init?.body)) as { input: string[] };
  return body.input;
}

test("重复查询向量命中缓存，不再发起远程请求", async () => {
  await withZhipuEnv(async () => {
    const { result, calls } = await withStubbedFetch(
      (_input, init) => zhipuResponse(requestTexts(init)),
      async () => {
        const first = await embedTexts(["查询缓存测试"], "query");
        const second = await embedTexts(["查询缓存测试"], "query");
        return { first, second };
      }
    );

    assert.equal(calls, 1);
    assert.deepEqual(result.first, result.second);
  });
});

test("一次调用内只补齐未缓存的查询", async () => {
  await withZhipuEnv(async () => {
    const { result, calls } = await withStubbedFetch(
      (_input, init) => zhipuResponse(requestTexts(init)),
      async () => {
        await embedTexts(["部分命中甲"], "query");
        return embedTexts(["部分命中甲", "部分命中乙"], "query");
      }
    );

    // 第一次调用一次远程；第二次只为“部分命中乙”发起一次。
    assert.equal(calls, 2);
    assert.deepEqual(result, [
      vectorFor("部分命中甲"),
      vectorFor("部分命中乙"),
    ]);
  });
});

test("文档向量不写入查询缓存", async () => {
  await withZhipuEnv(async () => {
    const { calls } = await withStubbedFetch(
      (_input, init) => zhipuResponse(requestTexts(init)),
      async () => {
        await embedTexts(["文档语料"], "document");
        await embedTexts(["文档语料"], "document");
      }
    );

    assert.equal(calls, 2);
  });
});

test("查询向量请求失败不会污染缓存", async () => {
  await withZhipuEnv(async () => {
    let shouldFail = true;
    const { result, calls } = await withStubbedFetch(
      (_input, init) => {
        if (shouldFail) {
          return new Response("boom", { status: 400 });
        }
        return zhipuResponse(requestTexts(init));
      },
      async () => {
        await assert.rejects(embedTexts(["失败后重试"], "query"));
        shouldFail = false;
        return embedTexts(["失败后重试"], "query");
      }
    );

    assert.equal(calls, 2);
    assert.deepEqual(result, [vectorFor("失败后重试")]);
  });
});
