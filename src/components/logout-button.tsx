"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      aria-label="退出登录"
      className="grid size-8 place-items-center rounded-full border border-white/10 text-white/42 transition hover:bg-white/[0.05] hover:text-white/80 disabled:opacity-35"
      disabled={pending}
      onClick={logout}
      title="退出登录"
      type="button"
    >
      <LogOut className="size-3.5" />
    </button>
  );
}
