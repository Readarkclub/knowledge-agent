import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("Git 推送不会用缺少私有索引的构建覆盖生产环境", async () => {
  const config = JSON.parse(
    await fs.readFile(new URL("../vercel.json", import.meta.url), "utf8")
  ) as {
    git?: { deploymentEnabled?: boolean };
  };

  assert.equal(config.git?.deploymentEnabled, false);
});
