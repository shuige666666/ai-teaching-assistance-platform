import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "课序 · AI 教学辅助平台",
  description: "从教学主题到结构化微型课程的 AI 教学辅助平台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 翻译类浏览器扩展可能在 React 水合前给根元素注入 CSS 变量，仅忽略这一层外部属性差异。
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
