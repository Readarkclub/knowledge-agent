"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";

export function LoginForm({
  defaultUsername,
  configurationError,
}: {
  defaultUsername: string;
  configurationError: boolean;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    configurationError ? "服务端尚未配置登录凭证。" : ""
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || configurationError) {
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error || "登录失败，请稍后重试。");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("网络请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.14em] text-white/42 uppercase">
          用户名
        </span>
        <input
          autoComplete="username"
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/35"
          disabled={configurationError || submitting}
          maxLength={80}
          onChange={(event) => setUsername(event.target.value)}
          value={username}
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium tracking-[0.14em] text-white/42 uppercase">
          密码
        </span>
        <input
          autoComplete="current-password"
          autoFocus
          className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.035] px-4 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-amber-200/35"
          disabled={configurationError || submitting}
          maxLength={256}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="输入访问密码"
          type="password"
          value={password}
        />
      </label>

      {error && (
        <p className="rounded-xl border border-red-300/15 bg-red-300/[0.06] px-4 py-3 text-xs leading-5 text-red-100/75">
          {error}
        </p>
      )}

      <button
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-200 text-sm font-medium text-stone-950 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={
          configurationError ||
          submitting ||
          !username.trim() ||
          !password
        }
        type="submit"
      >
        {submitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <LockKeyhole className="size-4" />
        )}
        {submitting ? "正在验证…" : "进入知识库"}
        {!submitting && <ArrowRight className="size-4" />}
      </button>
    </form>
  );
}
