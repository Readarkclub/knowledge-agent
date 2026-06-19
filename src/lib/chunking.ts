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

  for (const match of normalized.matchAll(/[\u3400-\u9fff]+/g)) {
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
      const searchStart = Math.max(start + 400, idealEnd - 240);
      const boundary = Math.max(
        content.lastIndexOf("\n\n", idealEnd),
        content.lastIndexOf("。", idealEnd),
        content.lastIndexOf("；", idealEnd)
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

