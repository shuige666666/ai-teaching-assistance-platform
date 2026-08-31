import { buildRuntimeBootstrap } from "./runtime-bootstrap";

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

/** 只检查文档和大小，执行边界依靠浏览器 sandbox/CSP，不用源码正则冒充脚本审计。 */
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
  return html;
}
