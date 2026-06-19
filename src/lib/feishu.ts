import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { WikiNode } from "@/lib/types";

type LarkResponse<T> = {
  ok: boolean;
  data: T;
  error?: {
    message?: string;
  };
};

type RawNode = {
  space_id: string;
  node_token: string;
  obj_token: string;
  obj_type: string;
  node_type: string;
  parent_node_token: string;
  title: string;
  has_child: boolean;
  updated_at?: string;
};

function normalizeNode(node: RawNode): WikiNode {
  return {
    spaceId: node.space_id,
    nodeToken: node.node_token,
    objToken: node.obj_token,
    objType: node.obj_type,
    nodeType: node.node_type,
    parentNodeToken: node.parent_node_token || "",
    title: node.title,
    hasChild: Boolean(node.has_child),
    updatedAt: node.updated_at,
  };
}

async function runLark<T>(
  args: string[],
  timeoutMs = 120_000
): Promise<LarkResponse<T>> {
  const isWindows = process.platform === "win32";
  const larkScript =
    process.env.LARK_CLI_PATH ||
    path.join(os.homedir(), ".npm-global", "lark-cli.ps1");
  const command = isWindows ? "powershell.exe" : "lark-cli";
  const commandArgs = isWindows
    ? [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        larkScript,
        ...args,
      ]
    : args;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`lark-cli 超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `lark-cli 退出码 ${code}: ${(stderr || stdout).slice(0, 600)}`
          )
        );
        return;
      }

      const start = stdout.indexOf("{");
      const end = stdout.lastIndexOf("}");
      if (start < 0 || end < start) {
        reject(new Error(`lark-cli 未返回 JSON: ${stdout.slice(0, 400)}`));
        return;
      }

      try {
        const payload = JSON.parse(stdout.slice(start, end + 1)) as LarkResponse<T>;
        if (!payload.ok) {
          reject(new Error(payload.error?.message || "lark-cli 请求失败"));
          return;
        }
        resolve(payload);
      } catch (error) {
        reject(
          new Error(
            `无法解析 lark-cli JSON: ${(error as Error).message}; ${stdout.slice(
              0,
              300
            )}`
          )
        );
      }
    });
  });
}

export async function getWikiNode(nodeTokenOrUrl: string): Promise<WikiNode> {
  const response = await runLark<RawNode>([
    "wiki",
    "+node-get",
    "--node-token",
    nodeTokenOrUrl,
    "--as",
    "user",
    "--format",
    "json",
  ]);
  return normalizeNode(response.data);
}

export async function listWikiNodes(
  spaceId: string,
  parentNodeToken: string
): Promise<WikiNode[]> {
  const response = await runLark<{
    nodes: RawNode[];
  }>([
    "wiki",
    "+node-list",
    "--space-id",
    spaceId,
    "--parent-node-token",
    parentNodeToken,
    "--page-all",
    "--page-limit",
    "30",
    "--as",
    "user",
    "--format",
    "json",
  ]);
  return (response.data.nodes || []).map(normalizeNode);
}

export async function walkWikiTree(root: WikiNode): Promise<WikiNode[]> {
  const nodes: WikiNode[] = [root];
  const queue = root.hasChild ? [root] : [];

  while (queue.length) {
    const parent = queue.shift()!;
    const children = await listWikiNodes(parent.spaceId, parent.nodeToken);
    nodes.push(...children);
    queue.push(...children.filter((child) => child.hasChild));
  }

  return nodes;
}

export async function fetchWikiDocument(nodeToken: string): Promise<{
  revisionId: number;
  markdown: string;
}> {
  const response = await runLark<{
    document: {
      revision_id: number;
      content: string;
    };
  }>(
    [
      "docs",
      "+fetch",
      "--api-version",
      "v2",
      "--doc",
      nodeToken,
      "--as",
      "user",
      "--detail",
      "simple",
      "--doc-format",
      "markdown",
      "--format",
      "json",
    ],
    180_000
  );

  return {
    revisionId: response.data.document.revision_id,
    markdown: response.data.document.content || "",
  };
}

