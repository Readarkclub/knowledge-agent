export type WeeklyReportCitation = {
  docId: string;
  title: string;
};

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    attributes[match[1]] = match[2];
  }

  return attributes;
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
