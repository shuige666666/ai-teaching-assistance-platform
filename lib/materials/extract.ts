import { createHash, randomUUID } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import {
  CourseMaterialSchema, MaterialError, MAX_MATERIAL_BLOCK_CHARS,
  MAX_MATERIAL_FILE_BYTES, MAX_MATERIAL_TEXT_CHARS, type CourseMaterial, type MaterialBlock,
} from "./types";

/** 解析用户选择的 PDF 页码，编号使用 PDF 实际页序，从 1 开始。 */
export function parsePageRange(value: string, pageCount: number): number[] {
  if (!value.trim()) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set<number>();
  for (const part of value.replaceAll("，", ",").split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    const start = Number(match?.[1]);
    const end = Number(match?.[2] ?? match?.[1]);
    if (!match || start < 1 || end < start || end > pageCount) {
      throw new MaterialError("INVALID_PAGE_RANGE", `页码范围不合法；该 PDF 共 ${pageCount} 页，请填写如 1-5,8 的范围`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** 按段落打包原文；长段落拆开，来源页码或标题始终随片段保存。 */
export function splitMaterialText(text: string, materialId: string, offset = 0, location: { pageNumber?: number; heading?: string } = {}): MaterialBlock[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > MAX_MATERIAL_BLOCK_CHARS) {
      chunks.push(current);
      current = "";
    }
    let remaining = paragraph;
    while (remaining.length > MAX_MATERIAL_BLOCK_CHARS) {
      // 不在 UTF-16 代理对中间切开，保留原文中的表情和扩展汉字。
      const cut = /[\uD800-\uDBFF]/.test(remaining[MAX_MATERIAL_BLOCK_CHARS - 1]) ? MAX_MATERIAL_BLOCK_CHARS - 1 : MAX_MATERIAL_BLOCK_CHARS;
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    current = current ? `${current}\n\n${remaining}` : remaining;
  }
  if (current) chunks.push(current);
  return chunks.map((chunk, index) => ({ id: `${materialId}:${offset + index + 1}`, text: chunk, ...location }));
}

/** 在服务端解析一份材料，只保存选定范围的原文，不执行材料中的 HTML 或脚本。 */
export async function extractCourseMaterial(courseId: string, file: File, pageRange = "", signal?: AbortSignal): Promise<CourseMaterial> {
  if (!file.size || file.size > MAX_MATERIAL_FILE_BYTES) throw new MaterialError("INVALID_MATERIAL_SIZE", "材料不能为空，单个文件不能超过 10 MB");
  const fileName = file.name.split(/[\\/]/).at(-1)?.trim();
  if (!fileName || fileName.length > 255) throw new MaterialError("INVALID_MATERIAL_NAME", "材料文件名不能为空或超过 255 字符");
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (!["pdf", "md", "markdown", "txt"].includes(extension ?? "")) throw new MaterialError("UNSUPPORTED_MATERIAL", "请上传文字型 PDF、Markdown 或 TXT 文件");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const materialId = randomUUID();
  const blocks: MaterialBlock[] = [];
  let pageCount: number | undefined;
  let selectedPages: number[] | undefined;
  const warnings: string[] = [];
  signal?.throwIfAborted();
  if (extension === "pdf") {
    if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes("%PDF-")) throw new MaterialError("INVALID_PDF", "文件内容不是有效的 PDF");
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
    try {
      pdf = await getDocumentProxy(bytes.slice(), { isEvalSupported: false });
      pageCount = pdf.numPages;
      selectedPages = parsePageRange(pageRange, pageCount);
      if (selectedPages.length > 80) throw new MaterialError("MATERIAL_TOO_LONG", "一次最多使用 80 页，请填写本次课程需要的 PDF 页码范围");
      let textLength = 0;
      const emptyPages: number[] = [];
      // 只读取选定页，避免为一章内容解析整本教材。
      for (const pageNumber of selectedPages) {
        signal?.throwIfAborted();
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").trim();
        textLength += text.length;
        if (textLength > MAX_MATERIAL_TEXT_CHARS) throw new MaterialError("MATERIAL_TOO_LONG", "材料正文超过 40,000 字符，请缩小 PDF 页码范围后重试");
        if (!text) emptyPages.push(pageNumber);
        blocks.push(...splitMaterialText(text, materialId, blocks.length, { pageNumber }));
        page.cleanup();
      }
      if (emptyPages.length) warnings.push(`第 ${emptyPages.join("、")} 页未识别到文字，可能为空白页或扫描图片；这些页没有进入生成上下文。`);
    } catch (error) {
      if (error instanceof MaterialError || signal?.aborted) throw error;
      throw new MaterialError("PDF_PARSE_FAILED", "PDF 解析失败，请确认文件未损坏、未加密，并包含可选择的文字");
    } finally {
      await pdf?.destroy();
    }
  } else {
    let text: string;
    try {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/\r\n?/g, "\n");
    } catch {
      throw new MaterialError("MATERIAL_ENCODING", "文本编码无法识别，请另存为 UTF-8 后上传");
    }
    if (text.length > MAX_MATERIAL_TEXT_CHARS) throw new MaterialError("MATERIAL_TOO_LONG", "材料正文超过 40,000 字符，请截取本次教学需要的章节后上传");
    const sections = extension === "txt" ? [text] : text.split(/(?=^#{1,6}\s+)/m);
    for (const section of sections) {
      const heading = extension === "txt" ? undefined : section.match(/^#{1,6}\s+(.+)/)?.[1].trim().slice(0, 200);
      blocks.push(...splitMaterialText(section, materialId, blocks.length, heading ? { heading } : {}));
    }
  }
  if (!blocks.length) throw new MaterialError("MATERIAL_TEXT_EMPTY", "没有提取到可用文字。扫描 PDF 暂不支持 OCR，请上传文字型 PDF 或文本材料");
  return CourseMaterialSchema.parse({
    id: materialId, courseId, fileName, fileSize: file.size,
    mimeType: extension === "pdf" ? "application/pdf" : extension === "txt" ? "text/plain" : "text/markdown",
    contentHash: createHash("sha256").update(bytes).digest("hex"), pageCount, selectedPages, blocks, warnings, createdAt: Date.now(),
  });
}
