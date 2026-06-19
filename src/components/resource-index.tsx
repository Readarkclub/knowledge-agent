"use client";

import {
  ArrowUpRight,
  BookOpenText,
  Bot,
  ExternalLink,
  FileText,
  FolderOpen,
  LibraryBig,
  Link2,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  RESOURCE_CATEGORIES,
  type ResourceCategory,
  type ResourceLink,
  type SyncState,
} from "@/lib/types";

const CATEGORY_DESCRIPTIONS: Record<ResourceCategory, string> = {
  "AI编程与智能体": "代码助手、Agent 工程与开发实践",
  "Skill / 知识库 / 工作流": "Skill、RAG、MCP 与自动化流程",
  "教育与学习": "课程、教程、训练营与学习资料",
  "模型与行业动态": "模型发布、研究报告与行业观察",
  "内容创作与设计": "写作、图像、视频与设计工具",
  "其他": "暂未归入明确主题的资源",
  "硬件与产品": "设备、芯片、机器人与产品发布",
};

type ResourceIndexProps = {
  resources: ResourceLink[];
  sourceUrl: string;
  sync: SyncState;
};

function formatDate(value?: string): string {
  if (!value) {
    return "尚未同步";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ResourceIndex({
  resources,
  sourceUrl,
  sync,
}: ResourceIndexProps) {
  const defaultCategory =
    RESOURCE_CATEGORIES.find((category) =>
      resources.some((resource) => resource.category === category)
    ) || RESOURCE_CATEGORIES[0];
  const [activeCategory, setActiveCategory] =
    useState<ResourceCategory>(defaultCategory);
  const [query, setQuery] = useState("");

  const categoryCounts = useMemo(() => {
    const counts = new Map<ResourceCategory, number>();
    for (const category of RESOURCE_CATEGORIES) {
      counts.set(category, 0);
    }
    for (const resource of resources) {
      counts.set(resource.category, (counts.get(resource.category) || 0) + 1);
    }
    return counts;
  }, [resources]);

  const filteredResources = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources.filter((resource) => {
      if (resource.category !== activeCategory) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return [
        resource.title,
        resource.domain,
        resource.category,
        ...resource.mentions.flatMap((mention) => [
          mention.documentTitle,
          mention.context,
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [activeCategory, query, resources]);

  const domainCount = useMemo(
    () => new Set(resources.map((resource) => resource.domain)).size,
    [resources]
  );

  return (
    <main className="resource-shell">
      <aside className="resource-navigation flex min-h-0 flex-col border-r border-white/[0.07] bg-black/15 px-4 py-5">
        <div className="flex items-center gap-3 px-1">
          <div className="grid size-10 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/[0.08] text-amber-200">
            <BookOpenText className="size-5" />
          </div>
          <div>
            <p className="text-[11px] tracking-[0.22em] text-amber-200/65 uppercase">
              Renren AI Club
            </p>
            <h1 className="mt-0.5 text-[15px] font-semibold tracking-tight">
              知识库 Agent
            </h1>
          </div>
        </div>

        <nav className="mt-7 space-y-1" aria-label="工作区导航">
          <Link
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-white/48 transition hover:bg-white/[0.045] hover:text-white/88"
            href="/"
          >
            <Bot className="size-4" />
            知识问答
          </Link>
          <div className="flex items-center gap-3 rounded-lg bg-amber-200/[0.09] px-3 py-2.5 text-[13px] font-medium text-amber-100">
            <LibraryBig className="size-4" />
            资源索引
          </div>
        </nav>

        <div className="mt-8 border-t border-white/[0.07] px-1 pt-6">
          <p className="text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Index coverage
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5">
            <div>
              <dt className="text-[10px] text-white/30">资源链接</dt>
              <dd className="mt-1 font-mono text-xl text-white/82">
                {resources.length}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/30">来源域名</dt>
              <dd className="mt-1 font-mono text-xl text-white/82">
                {domainCount}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/30">分类</dt>
              <dd className="mt-1 font-mono text-xl text-white/82">
                {RESOURCE_CATEGORIES.length}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] text-white/30">周报文档</dt>
              <dd className="mt-1 font-mono text-xl text-white/82">
                {sync.documentCount}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-auto border-t border-white/[0.07] px-1 pt-5">
          <p className="status-pulse text-[11px] font-medium text-emerald-300">
            每周五自动同步
          </p>
          <p className="mt-3 text-[11px] leading-5 text-white/36">
            上次同步 {formatDate(sync.completedAt)}
          </p>
          <a
            className="mt-3 flex items-center gap-2 text-[11px] text-white/42 transition hover:text-amber-100"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            查看飞书知识库
            <ExternalLink className="size-3" />
          </a>
        </div>
      </aside>

      <section className="resource-main relative flex min-h-0 min-w-0 flex-col">
        <div className="fine-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-35" />

        <header className="relative z-10 flex min-h-16 shrink-0 items-center justify-between border-b border-white/[0.065] px-5 py-3 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-200 text-stone-950 sm:hidden">
              <LibraryBig className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/90">
                周报资源索引
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/38">
                <Sparkles className="size-3 text-amber-200/75" />
                分类浏览 · 链接可追溯 · 新窗口打开
              </p>
            </div>
          </div>
          <Link
            className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/52 transition hover:bg-white/[0.05] hover:text-white sm:hidden"
            href="/"
          >
            <Bot className="size-3.5" />
            问答
          </Link>
        </header>

        <div className="resource-workspace relative z-[1] min-h-0 flex-1">
          <section className="resource-categories min-h-0 overflow-y-auto border-r border-white/[0.07] px-5 py-7 sm:px-7 sm:py-9">
            <div className="max-w-xl">
              <div className="mb-7 flex items-center gap-3">
                <div className="h-px w-9 bg-amber-200/45" />
                <span className="font-mono text-[10px] tracking-[0.22em] text-amber-200/60 uppercase">
                  Resource directory
                </span>
              </div>
              <h2 className="text-3xl font-medium tracking-[-0.035em] text-white sm:text-4xl">
                从周报里，直接找到
                <span className="block text-white/36">值得再次打开的资源。</span>
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-white/42">
                链接按主题自动归类；同一资源跨周重复出现时合并展示，并保留原始周报入口。
              </p>

              <div className="mt-9 border border-white/[0.085]">
                <div className="grid grid-cols-[minmax(0,1fr)_72px] border-b border-white/[0.085] bg-white/[0.025] px-4 py-3 text-[11px] font-medium text-white/38">
                  <span>分类</span>
                  <span className="text-right">链接数</span>
                </div>
                {RESOURCE_CATEGORIES.map((category) => {
                  const isActive = category === activeCategory;
                  return (
                    <button
                      className={`group grid w-full grid-cols-[minmax(0,1fr)_72px] items-center border-b border-white/[0.065] px-4 py-4 text-left transition last:border-b-0 ${
                        isActive
                          ? "bg-amber-200/[0.085]"
                          : "hover:bg-white/[0.035]"
                      }`}
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      type="button"
                    >
                      <span
                        className={`truncate text-sm ${
                          isActive
                            ? "font-medium text-amber-100"
                            : "text-white/66 group-hover:text-white/88"
                        }`}
                      >
                        {category}
                      </span>
                      <span
                        className={`text-right font-mono text-sm ${
                          isActive ? "text-amber-200" : "text-white/38"
                        }`}
                      >
                        {categoryCounts.get(category) || 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="resource-links flex min-h-0 flex-col bg-black/[0.06]">
            <div className="shrink-0 border-b border-white/[0.07] px-5 py-5 sm:px-7">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-[10px] tracking-[0.18em] text-white/32 uppercase">
                    Selected category
                  </p>
                  <h2 className="mt-1.5 text-lg font-medium text-white/86">
                    {activeCategory}
                  </h2>
                  <p className="mt-1 text-[11px] text-white/35">
                    {CATEGORY_DESCRIPTIONS[activeCategory]}
                  </p>
                </div>
                <label className="flex h-10 w-full items-center gap-2.5 border border-white/[0.1] bg-white/[0.025] px-3 text-white/50 transition focus-within:border-amber-200/30 xl:w-72">
                  <Search className="size-3.5 shrink-0" />
                  <input
                    className="min-w-0 flex-1 bg-transparent text-xs text-white/82 outline-none placeholder:text-white/28"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索标题、域名或周报内容"
                    type="search"
                    value={query}
                  />
                </label>
              </div>
              <p className="mt-4 font-mono text-[10px] text-white/28">
                SHOWING {filteredResources.length} /{" "}
                {categoryCounts.get(activeCategory) || 0}
              </p>
            </div>

            <div className="resource-list min-h-0 flex-1 overflow-y-auto px-5 sm:px-7">
              {filteredResources.length ? (
                <div>
                  {filteredResources.map((resource, index) => {
                    const mention = resource.mentions[0];
                    return (
                      <article
                        className="source-enter grid grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-white/[0.065] py-6"
                        key={resource.id}
                        style={{ animationDelay: `${Math.min(index, 10) * 35}ms` }}
                      >
                        <span className="pt-1 font-mono text-[10px] text-amber-200/48">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <a
                            className="group inline-flex max-w-full items-start gap-2"
                            href={resource.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <h3 className="line-clamp-2 text-[15px] font-medium leading-6 text-white/78 transition group-hover:text-amber-100">
                              {resource.title}
                            </h3>
                            <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-white/22 transition group-hover:text-amber-200/75" />
                          </a>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                            <span className="flex items-center gap-1.5 font-mono text-white/32">
                              <Link2 className="size-3" />
                              {resource.domain}
                            </span>
                            {resource.mentions.length > 1 && (
                              <span className="text-amber-200/52">
                                被 {resource.mentions.length} 期周报提及
                              </span>
                            )}
                          </div>

                          {mention?.context && (
                            <p className="mt-3 line-clamp-3 max-w-3xl text-[12px] leading-5 text-white/40">
                              {mention.context}
                            </p>
                          )}

                          {mention && (
                            <a
                              className="mt-4 inline-flex max-w-full items-center gap-2 text-[10px] text-white/32 transition hover:text-amber-100"
                              href={mention.documentUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <FileText className="size-3 shrink-0" />
                              <span className="truncate">
                                来源：{mention.documentTitle}
                              </span>
                              <ExternalLink className="size-3 shrink-0" />
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="grid min-h-72 place-items-center text-center">
                  <div>
                    <FolderOpen className="mx-auto size-7 text-white/18" />
                    <p className="mt-3 text-sm text-white/45">
                      {resources.length
                        ? "当前分类中没有匹配的链接"
                        : "同步飞书文档后，这里会出现资源链接"}
                    </p>
                    {query && (
                      <button
                        className="mt-3 text-xs text-amber-200/65 hover:text-amber-100"
                        onClick={() => setQuery("")}
                        type="button"
                      >
                        清除搜索
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
