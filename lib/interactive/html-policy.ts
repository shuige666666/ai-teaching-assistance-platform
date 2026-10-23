import { buildRuntimeBootstrap } from "./runtime-bootstrap";
import { findScriptSyntaxFailure } from "./script-syntax";

export const INTERACTIVE_HTML_MAX_BYTES = 256 * 1024;
export type InteractiveHtmlIssue = { path: string; message: string };

export class InvalidInteractiveHtmlError extends Error {
  constructor(public readonly issues: InteractiveHtmlIssue[]) {
    super("INVALID_INTERACTIVE_HTML");
    this.name = "InvalidInteractiveHtmlError";
  }
}

// 资源开放、宿主隔离；无 CDN 域名白名单，仍关闭子页面、对象和表单提交。
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:",
  "style-src 'unsafe-inline' https: http: data:",
  "img-src https: http: data: blob:",
  "font-src https: http: data:",
  "media-src https: http: data: blob:",
  "connect-src https: http: data: blob:",
  "worker-src blob: https: http:",
  "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ");

/** 检查文档、大小和普通内联脚本语法；执行安全仍依靠浏览器 sandbox/CSP。 */
export function postProcessInteractiveHtml(rawHtml: string): string {
  let html = rawHtml.trim().replace(/^```(?:html)?\s*([\s\S]*?)\s*```$/i, "$1").trim();
  if (!/<html(?:\s|>)/i.test(html) || !/<head(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new InvalidInteractiveHtmlError([{ path: "content.html", message: "必须返回包含 html、head 和 body 的完整文档" }]);
  }
  if (!/^\s*<!doctype html>/i.test(html)) html = `<!doctype html>\n${html}`;
  const injection = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n${buildRuntimeBootstrap()}`;
  html = html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}\n${injection}`);
  if (new TextEncoder().encode(html).length > INTERACTIVE_HTML_MAX_BYTES) {
    throw new InvalidInteractiveHtmlError([{ path: "content.html", message: "注入运行策略后的 HTML 不能超过 256 KiB" }]);
  }
  // 语法失败沿用生成管线的一次 repair；局部修订则在保存前拒绝候选，保留旧页面。
  const failure = findScriptSyntaxFailure(html);
  if (failure) throw new InvalidInteractiveHtmlError([{
    path: `content.html.script[${failure.scriptIndex}]`,
    message: `普通内联脚本语法错误：${failure.message}`,
  }]);
  return html;
}

/** 提取模型最初生成的互动文档，修订时不把平台注入的运行脚本和 CSP 再发给模型。 */
export function extractInteractiveAuthorHtml(storedHtml: string): string {
  return storedHtml
    .replace(/\s*<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="[^"]*">/i, "")
    .replace(/\s*<script\s+data-interactive-runtime="\d+">[\s\S]*?<\/script>/i, "")
    .trim();
}
