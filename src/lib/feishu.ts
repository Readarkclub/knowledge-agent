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
  timeoutMs = 120_000,
  context = "lark-cli"
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

  const isRetryable = (message: string) =>
    /EOF|transport|context deadline exceeded|timed out|connection reset/i.test(
      message
    );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
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
          reject(
            new Error(`lark-cli timeout (${Math.round(timeoutMs / 1000)}s)`)
          );
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
                `lark-cli exit ${code}: ${(stderr || stdout).slice(0, 600)}`
              )
            );
            return;
          }

          const start = stdout.indexOf("{");
          const end = stdout.lastIndexOf("}");
          if (start < 0 || end < start) {
            reject(new Error(`lark-cli did not return JSON: ${stdout.slice(0, 400)}`));
            return;
          }

          try {
            const payload = JSON.parse(stdout.slice(start, end + 1)) as LarkResponse<T>;
            if (!payload.ok) {
              reject(new Error(payload.error?.message || "lark-cli request failed"));
              return;
            }
            resolve(payload);
          } catch (error) {
            reject(
              new Error(
                `failed to parse lark-cli JSON: ${(error as Error).message}; ${stdout.slice(
                  0,
                  300
                )}`
              )
            );
          }
        });
      });
    } catch (error) {
      const message = (error as Error).message;
      if (attempt < 3 && isRetryable(message)) {
        console.error(
          `[${context}] retry ${attempt}/3 after transient error: ${message}`
        );
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      if (attempt > 1) {
        console.error(`[${context}] failed after ${attempt} attempts: ${message}`);
      }
      throw error;
    }
  }

  throw new Error("lark-cli request failed after retries");
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
  ], 120_000, `wiki node-get ${nodeTokenOrUrl}`);
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
  ], 120_000, `wiki node-list ${spaceId}/${parentNodeToken}`);
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

export type OutlineHeading = {
  level: number;
  blockId: string;
  text: string;
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number(dec))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// outline 模式返回 <fragment mode="outline"><outline><h2 id="...">标题</h2>…</outline></fragment>，
// 其中 id 即 docx block ID，可拼成 `文档URL#block_id` 直达链接。
export function parseOutlineHeadings(fragment: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const pattern = /<h([1-6])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(fragment))) {
    const text = decodeXmlEntities(match[3].replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      headings.push({
        level: Number(match[1]),
        blockId: match[2],
        text,
      });
    }
  }

  return headings;
}

export async function fetchWikiOutline(
  nodeToken: string
): Promise<OutlineHeading[]> {
  const response = await runLark<{
    document: {
      content: string;
    };
  }>(
    [
      "docs",
      "+fetch",
      "--doc",
      nodeToken,
      "--scope",
      "outline",
      "--detail",
      "with-ids",
      "--as",
      "user",
      "--format",
      "json",
    ],
    120_000,
    `docs outline ${nodeToken}`
  );

  return parseOutlineHeadings(response.data.document?.content || "");
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
    180_000,
    `docs fetch ${nodeToken}`
  );

  return {
    revisionId: response.data.document.revision_id,
    markdown: response.data.document.content || "",
  };
}
