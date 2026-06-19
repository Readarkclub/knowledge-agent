"use client";

import { Moon, Sun } from "lucide-react";

const THEME_STORAGE_KEY = "knowledge-agent-theme";

function setTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The visual preference still applies when browser storage is unavailable.
  }
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  return (
    <button
      aria-label="切换深色或浅色模式"
      className={`grid size-8 shrink-0 place-items-center rounded-full border border-white/10 text-white/48 transition hover:bg-white/[0.055] hover:text-white ${className}`}
      onClick={() =>
        setTheme(
          document.documentElement.classList.contains("dark")
            ? "light"
            : "dark"
        )
      }
      title="切换深色或浅色模式"
      type="button"
    >
      <Sun className="size-3.5 dark:hidden" />
      <Moon className="hidden size-3.5 dark:block" />
    </button>
  );
}
