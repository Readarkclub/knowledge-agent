import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem("knowledge-agent-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
  } catch (error) {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
  }
})();
`;

export const metadata: Metadata = {
  title: "人人智学社 · 知识库 Agent",
  description: "基于飞书群聊摘要的可引用知识问答与同步工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className="dark"
      data-theme="dark"
      lang="zh-CN"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
