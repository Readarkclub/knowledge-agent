export type WeeklyReportCitation = {
  docId: string;
  title: string;
};

export function parseCitationAllowlist(value?: string): Set<string> {
  return new Set(
    (value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function isCitationAllowed(
  docId: string,
  wikiTokens: Set<string>,
  explicitAllowlist: Set<string>
): boolean {
  return wikiTokens.has(docId) || explicitAllowlist.has(docId);
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

// 匹配单个 [来源 N] 与模型偶尔写出的多引用合写形式：
// [来源 1, 来源 8]、[来源1，来源8]、[来源 1、8] 等；尾随的模型自写链接一并吞掉。
const INLINE_CITATION_PATTERN =
  /(\[来源\s*\d+(?:\s*[,，、]\s*(?:来源\s*)?\d+)*\])(?:\([^)]*\))?/g;

/**
 * 模型偶尔会漏写 [来源 N](url) 里的括号链接，导致引用渲染成不可点击的
 * 纯文本。证据链接本身是确定的（来自检索结果），所以按编号用权威链接
 * 改写，不依赖模型是否老实带上括号，也会纠正模型误写的链接。
 */
export function repairInlineCitations(
  text: string,
  sourceUrls: Map<string, string>
): string {
  if (sourceUrls.size === 0) {
    return text;
  }
  return text.replace(
    INLINE_CITATION_PATTERN,
    (match, bracket: string) => {
      const numbers = [...bracket.matchAll(/\d+/g)].map((item) => item[0]);
      if (!numbers.some((id) => sourceUrls.has(id))) {
        return match;
      }
      return numbers
        .map((id) => {
          const url = sourceUrls.get(id);
          return url ? `[来源 ${id}](${url})` : `来源 ${id}`;
        })
        .join("、");
    }
  );
}

/** Pick the original line that best supports the sentence preceding a citation. */
export function findMatchingEvidenceLine(
  excerpt: string,
  context: string
): string | null {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const needle = normalize(context.slice(-160));
  if (needle.length < 4) {
    return null;
  }

  let bestLine: string | null = null;
  let bestLength = 3;
  for (const rawLine of excerpt.split(/\r?\n/)) {
    const line = rawLine.trim();
    const haystack = normalize(line);
    if (!haystack) {
      continue;
    }
    for (let start = 0; start < needle.length; start += 1) {
      for (let end = start + bestLength + 1; end <= needle.length; end += 1) {
        if (haystack.includes(needle.slice(start, end))) {
          bestLength = end - start;
          bestLine = line;
        } else {
          break;
        }
      }
    }
  }
  return bestLine;
}

export function extractWeeklyReportCitations(
  markdown: string
): WeeklyReportCitation[] {
  const citations: WeeklyReportCitation[] = [];
  const seen = new Set<string>();
  const pattern = /<cite\b([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(markdown))) {
    const attributes = parseAttributes(match[1]);
    const docId = attributes["doc-id"]?.trim();
    const title = attributes.title?.replace(/\\~/g, "~").trim();
    const fileType = attributes["file-type"]?.toLowerCase();

    if (
      !docId ||
      !title ||
      fileType !== "docx" ||
      !/\d{4}-\d{2}-\d{2}\s*(?:~|～|至)\s*\d{4}-\d{2}-\d{2}/.test(
        title
      ) ||
      seen.has(docId)
    ) {
      continue;
    }

    seen.add(docId);
    citations.push({ docId, title });
  }

  return citations;
}
