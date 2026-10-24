/** 构造带真实文本层的最小 PDF，验证解析器而不是模拟它的返回结果。 */
export function textPdf(pages: string[]): File {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pageIds: number[] = [];
  for (const text of pages) {
    const pageId = objects.length + 1;
    const streamId = pageId + 1;
    pageIds.push(pageId);
    const escaped = text.replace(/[\\()]/g, "\\$&");
    const stream = text ? `BT /F1 12 Tf 50 700 Td (${escaped}) Tj ET` : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let document = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(document)); document += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new File([document], "lesson.pdf", { type: "application/pdf" });
}

export const MATERIAL_FACT = "实验中的慢启动门限为 37 MSS，初始拥塞窗口为 3 MSS。";
export const textMaterial = () => new File([`# 慢启动实验\n\n${MATERIAL_FACT}\n\n# 条件\n\n这些数值仅适用于本实验，不能解释为协议的固定默认值。`], "网络实验.md", { type: "text/markdown" });
