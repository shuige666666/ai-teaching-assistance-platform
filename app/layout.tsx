import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "课序 · AI 教学辅助平台",
  description: "从教学主题到结构化微型课程的 AI 教学辅助平台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
