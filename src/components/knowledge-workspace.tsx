"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowUp,
  BookOpenText,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileText,
  LibraryBig,
  LoaderCircle,
  MessageSquareText,
  PanelRightOpen,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import type { SearchResult, SyncState } from "@/lib/types";

const SUGGESTIONS = [
  "最近一周群里讨论了哪些 AI Agent 话题？",
  "大家对 RAG 知识库落地有哪些经验和分歧？",
  "整理近期关于 Claude、Codex 与飞书的实践分享",
];

function formatDate(value?: string): string {
  if (!value) {
    return "尚未同步";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function messageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

type KnowledgeWorkspaceProps = {
  canSync: boolean;
  initialSync: SyncState;
  semanticSearchEnabled: boolean;
};

export function KnowledgeWorkspace({
  canSync,
  initialSync,
  semanticSearchEnabled,
}: KnowledgeWorkspaceProps) {
  const [input, setInput] = useState("");
  const [sync, setSync] = useState(initialSync);
  const [sources, setSources] = useState<SearchResult[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [localError, setLocalError] = useState("");
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat" }),
    []
  );
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";

  async function runSearch(query: string) {
    setSearching(true);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const payload = (await response.json()) as {
        results?: SearchResult[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "检索失败");
      }
      setSources(payload.results || []);
    } finally {
      setSearching(false);
    }
  }

  async function ask(question: string) {
    const query = question.trim();
    if (!query || isBusy) {
      return;
    }

    setLocalError("");
    setInput("");
    try {
      await runSearch(query);
      await sendMessage({ text: query });
    } catch (requestError) {
      setLocalError((requestError as Error).message);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await ask(input);
  }

  async function handleSync() {
    if (isSyncing) {
      return;
    }

    setIsSyncing(true);
    setLocalError("");
    try {
      const response = await fetch("/api/sync", { method: "POST" });
      const payload = (await response.json()) as {
        sync?: SyncState;
        error?: string;
      };
      if (!response.ok || !payload.sync) {
        throw new Error(payload.error || "同步失败");
      }
      setSync(payload.sync);
    } catch (syncError) {
      setLocalError((syncError as Error).message);
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <main className="knowledge-shell">
      <aside className="navigation-panel flex min-h-0 flex-col border-r border-white/[0.07] bg-black/15 px-4 py-5">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-amber-200/20 bg-amber-200/[0.08] text-amber-200">
              <BookOpenText className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] tracking-[0.22em] text-amber-200/65 uppercase">
                Renren AI Club
              </p>
              <h1 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight">
                知识库 Agent
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>

        <nav className="mt-7 space-y-1" aria-label="工作区导航">
          <div className="flex items-center gap-3 rounded-lg bg-amber-200/[0.09] px-3 py-2.5 text-[13px] font-medium text-amber-100">
            <MessageSquareText className="size-4" />
            知识问答
          </div>
          <Link
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-white/48 transition hover:bg-white/[0.045] hover:text-white/88"
            href="/resources"
          >
            <LibraryBig className="size-4" />
            资源索引
          </Link>
        </nav>

        <div className="mt-8 px-1">
          <p className="text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Knowledge scope
          </p>
          <div className="mt-3 border-l border-amber-200/25 pl-4">
            <p className="text-sm font-medium text-white/88">群聊摘要</p>
            <p className="mt-1 text-xs leading-5 text-white/43">
              2025 年 4 月至今
              <br />
              按月与周报递归同步
            </p>
          </div>
        </div>

        <div className="mt-8 px-1">
          <p className="text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Ask by theme
          </p>
          <div className="mt-2 space-y-1">
            {["Agent 工程", "模型与工具", "知识库 / RAG", "产品与行业"].map(
              (item) => (
                <button
                  className="group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] text-white/55 transition hover:bg-white/[0.045] hover:text-white/90"
                  key={item}
                  onClick={() => setInput(`总结近期关于${item}的讨论`)}
                  type="button"
                >
                  {item}
                  <ChevronRight className="size-3.5 opacity-0 transition group-hover:opacity-70" />
                </button>
              )
            )}
          </div>
        </div>

        <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
          <div className="flex items-center justify-between">
            <span
              className={`status-pulse text-[11px] font-medium ${
                sync.status === "ready"
                  ? "text-emerald-300"
                  : sync.status === "partial"
                    ? "text-amber-200"
                    : "text-white/45"
              }`}
            >
              {sync.status === "ready"
                ? "索引就绪"
                : sync.status === "partial"
                  ? "部分就绪"
                  : "等待同步"}
            </span>
            <span className="font-mono text-[10px] text-white/32">
              {sync.chunkCount} chunks
            </span>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/38">
            上次同步 {formatDate(sync.completedAt)}
          </p>
          {canSync ? (
            <Button
              className="mt-3 h-8 w-full border-white/10 bg-white/[0.035] text-xs text-white/65 hover:bg-white/[0.07] hover:text-white"
              disabled={isSyncing}
              onClick={handleSync}
              size="sm"
              variant="outline"
            >
              {isSyncing ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              {isSyncing ? "正在同步飞书…" : "同步飞书文档"}
            </Button>
          ) : (
            <p className="mt-3 border-t border-white/[0.06] pt-3 text-[10px] leading-5 text-white/30">
              线上索引由每周五发布任务更新
            </p>
          )}
        </div>
      </aside>

      <section className="knowledge-main relative flex min-h-0 min-w-0 flex-col">
        <div className="fine-grid pointer-events-none absolute inset-x-0 top-0 h-72 opacity-35" />

        <header className="relative z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/[0.065] px-5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-amber-200 text-stone-950 sm:hidden">
              <BookOpenText className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white/90">
                人人智学社群聊摘要
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/38">
                <Sparkles className="size-3 text-amber-200/75" />
                {semanticSearchEnabled ? "Hybrid retrieval" : "Keyword retrieval"} ·
                引用可追溯
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:hidden">
            <ThemeToggle />
            <LogoutButton />
            <Link
              aria-label="打开资源索引"
              className="grid size-8 place-items-center rounded-full border border-white/10 text-white/48 transition hover:bg-white/[0.05] hover:text-white"
              href="/resources"
            >
              <LibraryBig className="size-3.5" />
            </Link>
            <button
              className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/52 transition hover:bg-white/[0.05] hover:text-white"
              onClick={() => setMobileSourcesOpen(true)}
              type="button"
            >
              <PanelRightOpen className="size-3.5" />
              证据 {sources.length || ""}
            </button>
          </div>
        </header>

        <Conversation className="relative z-[1]">
          <ConversationContent
            className="mx-auto min-h-full w-full max-w-3xl gap-7 px-5 pb-36 pt-8 sm:px-8 sm:pt-12"
            scrollClassName="conversation-scroll"
          >
            {messages.length === 0 ? (
              <div className="soft-enter flex min-h-[62vh] flex-col justify-center">
                <div className="mb-7 flex items-center gap-3">
                  <div className="h-px w-9 bg-amber-200/45" />
                  <span className="font-mono text-[10px] tracking-[0.22em] text-amber-200/60 uppercase">
                    Ask the archive
                  </span>
                </div>
                <h2 className="max-w-2xl text-3xl font-medium leading-[1.18] tracking-[-0.035em] text-white sm:text-5xl">
                  从一年多的群聊摘要里，
                  <span className="text-white/37">找出有依据的答案。</span>
                </h2>
                <p className="mt-5 max-w-xl text-sm leading-7 text-white/43 sm:text-[15px]">
                  适合追踪某个话题的时间线、提炼群友经验、核对具体观点。
                  每个关键结论都会回到飞书原文。
                </p>

                <div className="mt-10 divide-y divide-white/[0.07] border-y border-white/[0.07]">
                  {SUGGESTIONS.map((suggestion, index) => (
                    <button
                      className="group flex w-full items-center gap-4 py-4 text-left transition hover:pl-2"
                      key={suggestion}
                      onClick={() => ask(suggestion)}
                      type="button"
                    >
                      <span className="font-mono text-[10px] text-amber-200/55">
                        0{index + 1}
                      </span>
                      <span className="flex-1 text-sm text-white/58 transition group-hover:text-white/90">
                        {suggestion}
                      </span>
                      <ArrowUp className="size-4 rotate-45 text-white/20 transition group-hover:text-amber-200/75" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <Message
                  className="soft-enter max-w-none"
                  from={message.role}
                  key={message.id}
                >
                  <div className="mb-1 flex items-center gap-2 text-[10px] tracking-[0.14em] text-white/30 uppercase">
                    {message.role === "user" ? (
                      <>
                        <span className="h-px w-4 bg-white/20" />
                        You
                      </>
                    ) : (
                      <>
                        <Bot className="size-3 text-amber-200/65" />
                        Knowledge Agent
                      </>
                    )}
                  </div>
                  <MessageContent
                    className={
                      message.role === "user"
                        ? "max-w-[88%] rounded-2xl rounded-tr-sm bg-white/[0.075] px-4 py-3 text-[14px] leading-6 text-white/88"
                        : "w-full max-w-none text-[14px] leading-7 text-white/78"
                    }
                  >
                    {message.role === "assistant" ? (
                      <MessageResponse className="max-w-none dark:prose-invert [&_a]:text-amber-200 [&_a]:underline-offset-4 [&_h3]:mt-7 [&_h3]:text-base [&_li]:my-1">
                        {messageText(message)}
                      </MessageResponse>
                    ) : (
                      <p>{messageText(message)}</p>
                    )}
                  </MessageContent>
                </Message>
              ))
            )}

            {status === "submitted" && (
              <div className="flex items-center gap-3 text-xs text-white/38">
                <LoaderCircle className="size-3.5 animate-spin text-amber-200/70" />
                正在核对证据…
              </div>
            )}

            {(error || localError) && (
              <div className="flex items-start gap-3 rounded-xl border border-red-300/15 bg-red-300/[0.055] px-4 py-3 text-xs leading-5 text-red-100/75">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {localError || error?.message}
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-28 border-white/10 bg-stone-900/90 text-white/60" />
        </Conversation>

        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[var(--background)] via-[var(--background)] to-transparent px-4 pb-4 pt-12 sm:px-7 sm:pb-6">
          <form
            className="mx-auto max-w-3xl"
            onSubmit={handleSubmit}
          >
            <div className="relative rounded-2xl border border-white/[0.11] bg-[color:var(--composer)] shadow-[0_24px_80px_rgba(0,0,0,0.18)] transition focus-within:border-amber-200/30">
              <textarea
                className="block min-h-14 max-h-36 w-full resize-none bg-transparent px-4 pb-3 pt-4 pr-14 text-[14px] leading-6 text-white/88 outline-none placeholder:text-white/28"
                disabled={isBusy}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void ask(input);
                  }
                }}
                placeholder="询问某个话题、人物、工具或时间段…"
                rows={1}
                value={input}
              />
              <button
                aria-label="发送问题"
                className="absolute right-2.5 top-2.5 grid size-9 place-items-center rounded-xl bg-amber-200 text-stone-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-35"
                disabled={!input.trim() || isBusy}
                type="submit"
              >
                {isBusy || searching ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-white/25">
              <span>Enter 发送 · Shift + Enter 换行</span>
              <span className="font-mono">{sync.documentCount} documents</span>
            </div>
          </form>
        </div>
      </section>

      <SourcePanel
        onSearch={runSearch}
        searching={searching}
        semanticSearchEnabled={semanticSearchEnabled}
        sources={sources}
        sync={sync}
      />

      {mobileSourcesOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm sm:hidden">
          <div className="absolute inset-x-0 bottom-0 max-h-[82svh] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[color:var(--drawer)] p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">检索证据</p>
                <p className="mt-1 text-[11px] text-white/35">
                  {sources.length} 个相关片段
                </p>
              </div>
              <button
                className="grid size-9 place-items-center rounded-full bg-white/[0.06] text-white/55"
                onClick={() => setMobileSourcesOpen(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <SourceList sources={sources} />
          </div>
        </div>
      )}
    </main>
  );
}

function SourcePanel({
  onSearch,
  searching,
  semanticSearchEnabled,
  sources,
  sync,
}: {
  onSearch: (query: string) => void;
  searching: boolean;
  semanticSearchEnabled: boolean;
  sources: SearchResult[];
  sync: SyncState;
}) {
  const [evidenceQuery, setEvidenceQuery] = useState("");

  function handleEvidenceSearch(event: FormEvent) {
    event.preventDefault();
    const query = evidenceQuery.trim();
    if (!query) {
      return;
    }
    onSearch(query);
  }

  return (
    <aside className="source-panel min-h-0 overflow-y-auto border-l border-white/[0.07] bg-black/10 px-5 py-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Evidence
          </p>
          <h2 className="mt-1.5 text-sm font-medium text-white/82">检索证据</h2>
        </div>
      </div>

      <form onSubmit={handleEvidenceSearch} className="mt-4">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2 focus-within:border-amber-200/30">
          <Search className="size-3.5 shrink-0 text-white/30" />
          <input
            className="min-w-0 flex-1 bg-transparent text-[12px] text-white/70 placeholder:text-white/25 focus:outline-none"
            onChange={(event) => setEvidenceQuery(event.target.value)}
            placeholder="输入关键词搜索证据"
            value={evidenceQuery}
          />
          {searching ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin text-white/40" />
          ) : null}
        </div>
      </form>

      <div className="mt-5 flex items-center gap-2 border-y border-white/[0.065] py-3 text-[11px] text-white/36">
        {semanticSearchEnabled && sync.embeddedChunkCount > 0 ? (
          <Check className="size-3.5 text-emerald-300/70" />
        ) : (
          <CircleAlert className="size-3.5 text-amber-200/70" />
        )}
        {semanticSearchEnabled && sync.embeddedChunkCount > 0
          ? "关键词 + 向量混合检索"
          : "线上使用稳定关键词检索"}
      </div>

      <div className="mt-5">
        <SourceList sources={sources} />
      </div>
    </aside>
  );
}

function SourceList({ sources }: { sources: SearchResult[] }) {
  if (!sources.length) {
    return (
      <div className="mt-12 text-center">
        <FileText className="mx-auto size-6 text-white/20" />
        <p className="mt-3 text-xs text-white/35">提问后显示命中的原文证据</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sources.map((source, index) => (
        <article
          className="source-enter border-b border-white/[0.065] pb-5"
          key={source.id}
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 font-mono text-[10px] text-amber-200/55">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <a
                className="group block"
                href={source.url}
                rel="noreferrer"
                target="_blank"
              >
                <h3 className="line-clamp-2 text-[12px] font-medium leading-5 text-white/72 transition group-hover:text-amber-100">
                  {source.title}
                  <ExternalLink className="ml-1 inline size-3 opacity-0 transition group-hover:opacity-70" />
                </h3>
              </a>
              <p className="mt-1 truncate text-[10px] text-white/28">
                {source.parentTitle} / {source.heading}
              </p>
              <p className="mt-3 line-clamp-5 text-[11px] leading-5 text-white/42">
                {source.excerpt}
              </p>
              <div className="mt-3 h-px overflow-hidden bg-white/[0.055]">
                <div
                  className="h-full bg-amber-200/55"
                  style={{ width: `${Math.max(16, source.score * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
