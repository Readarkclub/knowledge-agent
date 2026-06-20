import { createHash } from "node:crypto";
import { RESOURCE_CATEGORIES } from "@/lib/types";
import type {
  ResourceCategory,
  ResourceLink,
  ResourceMention,
} from "@/lib/types";

type ResourceCandidate = Omit<ResourceLink, "mentions"> & {
  mention: ResourceMention;
};

type ExtractResourceInput = {
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  markdown: string;
};

const CATEGORY_KEYWORDS: Record<
  Exclude<ResourceCategory, "其他">,
  string[]
> = {
  "AI编程与智能体": [
    "ai编程",
    "编程",
    "代码",
    "开发",
    "程序员",
    "智能体",
    "agent",
    "codex",
    "claude code",
    "cursor",
    "windsurf",
    "github",
    "vscode",
    "opencode",
    "copilot",
    "代码生成",
  ],
  "Skill / 知识库 / 工作流": [
    "skill",
    "skills",
    "知识库",
    "工作流",
    "workflow",
    "rag",
    "mcp",
    "dify",
    "coze",
    "扣子",
    "n8n",
    "zapier",
    "make.com",
    "自动化",
    "prompt",
    "提示词",
    "检索增强",
  ],
  "教育与学习": [
    "教育",
    "学习",
    "课程",
    "教程",
    "培训",
    "训练营",
    "公开课",
    "讲座",
    "课堂",
    "学校",
    "学生",
    "老师",
    "study",
    "learn",
    "course",
    "tutorial",
    "edu",
  ],
  "模型与行业动态": [
    "模型",
    "大模型",
    "行业",
    "融资",
    "发布",
    "测评",
    "报告",
    "研究",
    "论文",
    "openai",
    "anthropic",
    "deepseek",
    "gemini",
    "gpt",
    "claude",
    "qwen",
    "通义",
    "豆包",
    "kimi",
    "llama",
    "huggingface",
    "modelscope",
    "arxiv",
    "benchmark",
  ],
  "内容创作与设计": [
    "内容创作",
    "创作",
    "设计",
    "写作",
    "公众号",
    "小红书",
    "视频",
    "剪辑",
    "生图",
    "图片",
    "海报",
    "ppt",
    "figma",
    "canva",
    "midjourney",
    "luma",
    "runway",
    "pika",
    "suno",
    "sora",
    "即梦",
    "剪映",
    "notion",
  ],
  "硬件与产品": [
    "硬件",
    "产品",
    "设备",
    "机器人",
    "眼镜",
    "手机",
    "电脑",
    "芯片",
    "算力",
    "显卡",
    "gpu",
    "nvidia",
    "英伟达",
    "apple",
    "meta quest",
    "ar眼镜",
    "vr",
    "无人机",
  ],
};

const GENERIC_TITLES = new Set([
  "链接",
  "资源链接",
  "原文",
  "查看",
  "详情",
  "点击查看",
  "点击阅读",
  "阅读原文",
  "网址",
  "地址",
  "link",
  "url",
]);

const TRACKING_PARAMETERS = new Set([
  "chksm",
  "from",
  "from_source",
  "mpshare",
  "scene",
  "share_token",
  "sharer_shareinfo",
  "sharer_shareinfo_first",
  "srcid",
]);

const SENSITIVE_PARAMETERS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "code",
  "credential",
  "key",
  "password",
  "refresh_token",
  "secret",
  "sig",
  "signature",
  "token",
]);

function isSensitiveParameter(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_PARAMETERS.has(normalized) ||
    normalized.startsWith("x-amz-") ||
    normalized.startsWith("x-goog-") ||
    normalized.endsWith("_token") ||
    normalized.endsWith("_signature")
  );
}

function cleanUrl(value: string): string {
  return value
    .trim()
    .replace(/&amp;/gi, "&")
    .replace(/[)）\]】}>》，。；;！!？?、]+$/g, "");
}

export function sanitizeResourceUrl(value: string): string | null {
  try {
    const url = new URL(cleanUrl(value));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_") ||
        TRACKING_PARAMETERS.has(normalizedKey) ||
        isSensitiveParameter(normalizedKey)
      ) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isResourceUrl(url: string, documentUrl: string): boolean {
  if (url === sanitizeResourceUrl(documentUrl)) {
    return false;
  }

  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (
    hostname === "file" ||
    hostname === "localhost" ||
    hostname.includes("internal-api-drive-stream.feishu.cn") ||
    hostname.includes("lf3-static.bytednsdoc.com") ||
    hostname.includes("p3-sign.douyinpic.com")
  ) {
    return false;
  }

  return !/\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|\?)/i.test(pathname);
}

function cleanText(value: string): string {
  return value
    .replace(/\\([\[\]()（）])/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`~]/g, "")
    .replace(/^\s*(?:[-+•·]+|\d+[.)、])\s*/, "")
    .replace(/[\[\]]/g, "")
    .replace(/^[（(]+|[）)]+$/g, "")
    .replace(/[（(]+$/g, "")
    .replace(/[\\·\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lineContext(line: string): string {
  return cleanText(
    line
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/[^\s<>"']+/g, "")
      .replace(/\|/g, " · ")
  ).slice(0, 220);
}

function titleQuality(value: string, domain: string): number {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === domain || GENERIC_TITLES.has(normalized)) {
    return 0;
  }
  if (/^https?:\/\//.test(normalized)) {
    return 0;
  }
  if (/^\d{4}[-./年]\d{1,2}(?:[-./月]\d{1,2}日?)?$/.test(normalized)) {
    return 1;
  }
  return Math.min(100, value.length + 20);
}

function chooseTitle(label: string, context: string, domain: string): string {
  const cleanedLabel = cleanText(label).slice(0, 120);
  if (titleQuality(cleanedLabel, domain) > 1) {
    return cleanedLabel;
  }

  const cleanedContext = cleanText(context).slice(0, 120);
  if (titleQuality(cleanedContext, domain) > 1) {
    return cleanedContext;
  }

  return domain;
}

export function categorizeResource(
  title: string,
  context: string,
  domain: string
): ResourceCategory {
  const haystack = `${title} ${context} ${domain}`.toLowerCase();
  let bestCategory: ResourceCategory = "其他";
  let bestScore = 0;

  for (const category of RESOURCE_CATEGORIES) {
    if (category === "其他") {
      continue;
    }

    const score = CATEGORY_KEYWORDS[category].reduce((total, keyword) => {
      if (!haystack.includes(keyword.toLowerCase())) {
        return total;
      }
      return total + (title.toLowerCase().includes(keyword.toLowerCase()) ? 3 : 1);
    }, 0);

    if (score > bestScore) {
      bestCategory = category;
      bestScore = score;
    }
  }

  return bestCategory;
}

function candidateFromMatch({
  label,
  rawUrl,
  context,
  input,
}: {
  label: string;
  rawUrl: string;
  context: string;
  input: ExtractResourceInput;
}): ResourceCandidate | null {
  const normalizedUrl = sanitizeResourceUrl(rawUrl);
  if (!normalizedUrl || !isResourceUrl(normalizedUrl, input.documentUrl)) {
    return null;
  }

  const domain = new URL(normalizedUrl).hostname.replace(/^www\./, "");
  const title = chooseTitle(label, context, domain);
  return {
    id: createHash("sha1").update(normalizedUrl).digest("hex").slice(0, 16),
    url: normalizedUrl,
    normalizedUrl,
    title,
    domain,
    category: categorizeResource(title, context, domain),
    mention: {
      documentId: input.documentId,
      documentTitle: input.documentTitle,
      documentUrl: input.documentUrl,
      context,
    },
  };
}

export function extractResourceLinks(
  input: ExtractResourceInput
): ResourceCandidate[] {
  const candidates: ResourceCandidate[] = [];
  const seen = new Set<string>();

  for (const line of input.markdown.split(/\r?\n/)) {
    if (!line.includes("http")) {
      continue;
    }

    const context = lineContext(line);
    const coveredRanges: Array<[number, number]> = [];
    const markdownLinkPattern = /(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    for (const match of line.matchAll(markdownLinkPattern)) {
      coveredRanges.push([match.index, match.index + match[0].length]);
      if (match[1] === "!") {
        continue;
      }
      const candidate = candidateFromMatch({
        label: match[2],
        rawUrl: match[3],
        context,
        input,
      });
      if (candidate && !seen.has(candidate.normalizedUrl)) {
        seen.add(candidate.normalizedUrl);
        candidates.push(candidate);
      }
    }

    const htmlLinkPattern =
      /<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
    for (const match of line.matchAll(htmlLinkPattern)) {
      coveredRanges.push([match.index, match.index + match[0].length]);
      const candidate = candidateFromMatch({
        label: match[2],
        rawUrl: match[1],
        context,
        input,
      });
      if (candidate && !seen.has(candidate.normalizedUrl)) {
        seen.add(candidate.normalizedUrl);
        candidates.push(candidate);
      }
    }

    const bareUrlPattern = /https?:\/\/[^\s<>"']+/g;
    for (const match of line.matchAll(bareUrlPattern)) {
      const matchStart = match.index;
      const isCovered = coveredRanges.some(
        ([start, end]) => matchStart >= start && matchStart < end
      );
      if (isCovered) {
        continue;
      }

      const candidate = candidateFromMatch({
        label: "",
        rawUrl: match[0],
        context,
        input,
      });
      if (candidate && !seen.has(candidate.normalizedUrl)) {
        seen.add(candidate.normalizedUrl);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

export function mergeResourceLinks(
  candidates: ResourceCandidate[]
): ResourceLink[] {
  const resources = new Map<
    string,
    ResourceLink & { categoryVotes: Map<ResourceCategory, number> }
  >();

  for (const candidate of candidates) {
    const existing = resources.get(candidate.normalizedUrl);
    if (!existing) {
      resources.set(candidate.normalizedUrl, {
        id: candidate.id,
        url: candidate.url,
        normalizedUrl: candidate.normalizedUrl,
        title: candidate.title,
        domain: candidate.domain,
        category: candidate.category,
        mentions: [candidate.mention],
        categoryVotes: new Map([[candidate.category, 1]]),
      });
      continue;
    }

    if (
      titleQuality(candidate.title, candidate.domain) >
      titleQuality(existing.title, existing.domain)
    ) {
      existing.title = candidate.title;
    }

    if (
      !existing.mentions.some(
        (mention) =>
          mention.documentId === candidate.mention.documentId &&
          mention.context === candidate.mention.context
      )
    ) {
      existing.mentions.push(candidate.mention);
    }

    existing.categoryVotes.set(
      candidate.category,
      (existing.categoryVotes.get(candidate.category) || 0) + 1
    );
    existing.category = [...existing.categoryVotes.entries()].sort(
      (left, right) => right[1] - left[1]
    )[0][0];
  }

  return [...resources.values()]
    .map((resource) => ({
      id: resource.id,
      url: resource.url,
      normalizedUrl: resource.normalizedUrl,
      title: resource.title,
      domain: resource.domain,
      category: resource.category,
      mentions: resource.mentions,
    }))
    .sort((left, right) => {
      const categoryDifference =
        RESOURCE_CATEGORIES.indexOf(left.category) -
        RESOURCE_CATEGORIES.indexOf(right.category);
      return (
        categoryDifference ||
        left.title.localeCompare(right.title, "zh-CN", { numeric: true })
      );
    });
}
