import { RETRIEVAL } from "@/lib/config";
import type { KnowledgeChunk } from "@/lib/types";

const STOP_WORDS = new Set([
  "的",
  "了",
  "和",
  "是",
  "在",
  "有",
  "与",
  "及",
  "或",
  "一个",
  "我们",
  "这个",
  "什么",
  "怎么",
  "如何",
  "哪些",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
]);

export function tokenize(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9._+-]*/g)) {
    if (!STOP_WORDS.has(match[0])) {
      tokens.push(match[0]);
    }
  }

  for (const match of normalized.matchAll(/[㐀-鿿]+/g)) {
    const run = match[0];
    for (const char of run) {
      if (!STOP_WORDS.has(char)) {
        tokens.push(char);
      }
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!STOP_WORDS.has(bigram)) {
        tokens.push(bigram);
      }
    }
  }

  return tokens;
}

export function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/<cite\b[^>]*title="([^"]+)"[^>]*><\/cite>/gi, "$1")
    .replace(/<synced_reference\b[^>]*><\/synced_reference>/gi, "")
    .replace(/<\/?(?:callout|grid|column)\b[^>]*>/gi, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/https:\/\/internal-api-drive-stream\.feishu\.cn\/\S+/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type Section = {
  heading: string;
  content: string;
};

function splitSections(markdown: string): Section[] {
  const lines = cleanMarkdown(markdown).split(/\r?\n/);
  const sections: Section[] = [];
  let heading = "正文";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) {
      sections.push({ heading, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
}

function splitWithOverlap(content: string): string[] {
  if (content.length <= RETRIEVAL.chunkSize) {
    return [content];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    const idealEnd = Math.min(start + RETRIEVAL.chunkSize, content.length);
    let end = idealEnd;

    if (idealEnd < content.length) {
      // 边界窗口：块至少填充 60%，且回退不超过 240 字符。
      // 旧实现固定 start + 400，在 430 的块大小下只剩 30 字符窗口，
      // 绝大多数超长章节都会被硬切在句子中间。
      const searchStart = Math.max(
        start + Math.floor(RETRIEVAL.chunkSize * 0.6),
        idealEnd - 240
      );
      const boundary = Math.max(
        content.lastIndexOf("\n", idealEnd),
        content.lastIndexOf("。", idealEnd),
        content.lastIndexOf("；", idealEnd),
        content.lastIndexOf("！", idealEnd),
        content.lastIndexOf("？", idealEnd)
      );
      if (boundary >= searchStart) {
        end = boundary + 1;
      }
    }

    const chunk = content.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= content.length) {
      break;
    }
    start = Math.max(end - RETRIEVAL.chunkOverlap, start + 1);
  }

  return chunks;
}

export function chunkDocument(input: {
  documentId: string;
  nodeToken: string;
  title: string;
  parentTitle: string;
  url: string;
  markdown: string;
}): KnowledgeChunk[] {
  const result: KnowledgeChunk[] = [];

  for (const section of splitSections(input.markdown)) {
    const pieces = splitWithOverlap(section.content);
    pieces.forEach((content, index) => {
      const contextualText = [
        `文档：${input.title}`,
        input.parentTitle ? `目录：${input.parentTitle}` : "",
        `章节：${section.heading}`,
        content,
      ]
        .filter(Boolean)
        .join("\n");

      result.push({
        id: `${input.documentId}:${result.length}`,
        documentId: input.documentId,
        nodeToken: input.nodeToken,
        title: input.title,
        parentTitle: input.parentTitle,
        heading:
          pieces.length > 1
            ? `${section.heading} · ${index + 1}/${pieces.length}`
            : section.heading,
        url: input.url,
        content,
        contextualText,
        tokens: tokenize(contextualText),
      });
    });
  }

  return result;
}

export type HeadingAnchor = {
  blockId: string;
  text: string;
};

// markdown 标题可能带 \~ 等转义，outline XML 标题是原文；
// 双方都归一到无转义、折叠空白的小写形式后再对齐。
function normalizeHeadingKey(text: string): string {
  return text
    .replace(/\\(\S)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const MULTI_PIECE_SUFFIX_PATTERN = /\s*·\s*\d+\/\d+$/;

export function buildHeadingAnchors(
  headings: HeadingAnchor[]
): Map<string, string> {
  const anchors = new Map<string, string>();
  for (const heading of headings) {
    if (!heading.blockId) {
      continue;
    }
    const key = normalizeHeadingKey(heading.text);
    if (key && !anchors.has(key)) {
      anchors.set(key, heading.blockId);
    }
  }
  return anchors;
}

/**
 * 飞书文档支持 `文档URL?block=block_id` 直达定位到具体块，这也是客户端
 * 「复制块链接」的原生格式。不能用 `#block_id` 片段：外部协作者打开链接时
 * 飞书会跨租户重写域名（如 renrenai → 个人租户域），URL 片段在重定向与
 * SPA 路由中会丢失，查询参数则全程保留。
 * 把章节锚点写进 chunk.url 后，检索来源、聊天引用等下游链接无需改动
 * 即可跳到原文对应章节。已带 ?block= 锚点的 url 不再追加，重复应用
 * （增量同步复用旧块）幂等；旧索引的 #block 片段会被改写为新格式。
 */
export function applyChunkAnchors(
  chunks: KnowledgeChunk[],
  anchors: Map<string, string>,
  baseUrl: string
): void {
  if (!anchors.size) {
    return;
  }
  for (const chunk of chunks) {
    if (chunk.url.includes("?block=")) {
      continue;
    }
    const blockId = anchors.get(
      normalizeHeadingKey(chunk.heading.replace(MULTI_PIECE_SUFFIX_PATTERN, ""))
    );
    if (blockId) {
      chunk.url = `${baseUrl}?block=${blockId}`;
    }
  }
}

