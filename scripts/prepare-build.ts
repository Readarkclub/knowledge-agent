import { spawn } from "node:child_process";
import path from "node:path";

function runReembed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", path.join(process.cwd(), "scripts", "reembed.ts")],
      {
        env: process.env,
        stdio: "inherit",
      }
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`远程向量重建失败，退出码：${code ?? "unknown"}`));
      }
    });
  });
}

async function main() {
  if (process.env.REEMBED_ON_BUILD !== "1") {
    return;
  }

  console.log("检测到 REEMBED_ON_BUILD=1，开始重建生产向量索引。");
  await runReembed();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
