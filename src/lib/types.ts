export type WikiNode = {
  spaceId: string;
  nodeToken: string;
  objToken: string;
  objType: string;
  nodeType: string;
  parentNodeToken: string;
  title: string;
  hasChild: boolean;
  updatedAt?: string;
};

export type KnowledgeDocument = {
  id: string;
  nodeToken: string;
  objToken: string;
  title: string;
  parentTitle: string;
  url: string;
  revisionId: number;
  contentHash: string;
  updatedAt?: string;
  syncedAt: string;
  chunkCount: number;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  nodeToken: string;
  title: string;
  parentTitle: string;
  heading: string;
  url: string;
  content: string;
  contextualText: string;
  tokens: string[];
  embedding?: number[];
};

export type SyncState = {
  status: "empty" | "ready" | "partial" | "error";
  startedAt?: string;
  completedAt?: string;
  documentCount: number;
  chunkCount: number;
  embeddedChunkCount: number;
  embeddingProvider?: string;
  warnings: string[];
};

export const RESOURCE_CATEGORIES = [
  "AI编程与智能体",
  "Skill / 知识库 / 工作流",
  "教育与学习",
  "模型与行业动态",
  "内容创作与设计",
  "其他",
  "硬件与产品",
] as const;

export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

export type ResourceMention = {
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  context: string;
};

export type ResourceLink = {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  domain: string;
  category: ResourceCategory;
  mentions: ResourceMention[];
};

export type KnowledgeIndex = {
  version: 2 | 3;
  source: {
    name: string;
    rootUrl: string;
    spaceId: string;
    rootNodeToken: string;
  };
  sync: SyncState;
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
  resources: ResourceLink[];
};

export type SearchResult = {
  id: string;
  documentId: string;
  title: string;
  parentTitle: string;
  heading: string;
  url: string;
  excerpt: string;
  score: number;
  lexicalScore: number;
  semanticScore: number;
};
