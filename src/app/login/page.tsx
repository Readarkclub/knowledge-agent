import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  getAuthUsername,
  isAuthConfigured,
  verifySessionToken,
} from "@/lib/auth";
import { LoginForm } from "@/app/login/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (verifySessionToken(session)) {
    redirect("/");
  }

  const params = await searchParams;
  const configurationError =
    params.error === "config" || !isAuthConfigured();

  return (
    <main className="relative grid h-svh place-items-center overflow-y-auto px-5 py-6 sm:py-10">
      <div className="fine-grid pointer-events-none absolute inset-0" />
      <section className="relative z-[1] my-auto w-full max-w-md rounded-3xl border border-white/[0.09] bg-[color:var(--composer)] p-7 shadow-[0_30px_100px_rgba(0,0,0,0.32)] sm:p-9">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl border border-amber-200/20 bg-amber-200/[0.09] text-amber-200">
            <LockKeyholeIcon />
          </div>
          <div>
            <p className="text-[10px] tracking-[0.2em] text-amber-200/60 uppercase">
              Private knowledge
            </p>
            <h1 className="mt-1 text-lg font-medium text-white/90">
              人人智学社知识库
            </h1>
          </div>
        </div>
        <p className="mt-7 text-sm leading-6 text-white/45">
          该知识库包含内部群聊摘要与可追溯证据，请登录后访问。
        </p>
        <LoginForm
          configurationError={configurationError}
          defaultUsername={getAuthUsername()}
        />
      </section>
    </main>
  );
}

function LockKeyholeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M7 10V8a5 5 0 0 1 10 0v2m-8 0h6m-8 0h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
