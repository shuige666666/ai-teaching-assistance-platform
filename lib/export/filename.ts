const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 课程/场景标题 → 安全文件名；非法字符替换、收拢空白、裁剪长度，空结果回退默认名。 */
export function safeFilename(raw: string, fallback = "课程导出", maxLength = 60): string {
  const cleaned = raw
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, maxLength)
    .replace(/[. ]+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

/** 互动页文件名：补零场景序号 + 安全化标题，如 `03_流程互动.html`。 */
export function sceneHtmlFileName(order: number, title: string): string {
  return `${String(order).padStart(2, "0")}_${safeFilename(title, "互动页", 40)}.html`;
}
