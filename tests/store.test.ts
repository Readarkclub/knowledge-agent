import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(
  path.join(os.tmpdir(), "knowledge-store-test-")
);
process.env.KNOWLEDGE_DATA_DIR = dataDir;

// KNOWLEDGE_DATA_DIR 在模块加载时读取，必须先设环境变量再动态导入。
const storeModule = import("../src/lib/store");

test.after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

test("索引文件缺失时返回空索引", async () => {
  const { readIndex } = await storeModule;
  const index = await readIndex();
  assert.equal(index.sync.status, "empty");
  assert.equal(index.chunks.length, 0);
});

test("重复读取复用同一个解析结果对象", async () => {
  const { emptyIndex, readIndex, writeIndex } = await storeModule;
  const index = emptyIndex();
  index.sync.status = "ready";
  index.sync.documentCount = 1;
  await writeIndex(index);

  const first = await readIndex();
  const second = await readIndex();
  assert.equal(first.sync.documentCount, 1);
  assert.equal(first, second);
});

test("writeIndex 之后读取到新内容", async () => {
  const { emptyIndex, readIndex, writeIndex } = await storeModule;
  const before = await readIndex();
  const index = emptyIndex();
  index.sync.status = "ready";
  index.sync.documentCount = 7;
  await writeIndex(index);

  const after = await readIndex();
  assert.equal(after.sync.documentCount, 7);
  assert.notEqual(after, before);
});

test("外部直接改写索引文件后缓存失效", async () => {
  const { emptyIndex, readIndex } = await storeModule;
  const cached = await readIndex();
  const replacement = emptyIndex();
  replacement.sync.status = "ready";
  replacement.sync.documentCount = 42;
  await fs.writeFile(
    path.join(dataDir, "index.json"),
    JSON.stringify(replacement),
    "utf8"
  );

  const reloaded = await readIndex();
  assert.equal(reloaded.sync.documentCount, 42);
  assert.notEqual(reloaded, cached);
});

test("缓存返回的索引经过资源清洗", async () => {
  const { emptyIndex, readIndex, writeIndex } = await storeModule;
  const index = emptyIndex();
  index.resources = [
    {
      id: "javascript-resource",
      url: "javascript:alert(1)",
      normalizedUrl: "javascript:alert(1)",
      title: "恶意链接",
      domain: "example.com",
      category: "其他",
      mentions: [],
    },
    {
      id: "safe-resource",
      url: "https://example.com/article",
      normalizedUrl: "https://example.com/article",
      title: "正常链接",
      domain: "example.com",
      category: "其他",
      mentions: [],
    },
  ];
  await writeIndex(index);

  const fromCache = await readIndex();
  assert.deepEqual(
    fromCache.resources.map((resource) => resource.id),
    ["safe-resource"]
  );
});
