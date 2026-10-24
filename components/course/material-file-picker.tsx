"use client";

import { useId, useState } from "react";
import { MAX_MATERIAL_FILES, MAX_MATERIAL_FILE_BYTES } from "@/lib/materials/types";

export type MaterialUpload = { file: File; pageRange: string };

/** 首页和大纲页共用文件选择器，PDF 范围在上传前就可以缩小到所需章节。 */
export function MaterialFilePicker({ uploads, onChange, disabled = false }: {
  uploads: MaterialUpload[]; onChange: (uploads: MaterialUpload[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState("");
  return (
    <div className="material-picker">
      <label htmlFor={id}>教学材料（可选）</label>
      <p className="material-hint">文字型 PDF、Markdown、TXT · 最多 3 份，每份 10 MB，正文合计 40,000 字符。材料会随课程保存。</p>
      <input id={id} type="file" accept=".pdf,.md,.markdown,.txt" multiple disabled={disabled} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (uploads.length + files.length > MAX_MATERIAL_FILES) { setError("每门课程最多选择 3 份材料"); return; }
        if (files.some((file) => !file.size || file.size > MAX_MATERIAL_FILE_BYTES)) { setError("文件不能为空，且每份不能超过 10 MB"); return; }
        setError("");
        onChange([...uploads, ...files.map((file) => ({ file, pageRange: "" }))]);
      }} />
      {uploads.map((upload, index) => (
        <div className="material-upload" key={`${upload.file.name}:${index}`}>
          <div><strong>{upload.file.name}</strong><small>{(upload.file.size / 1024).toFixed(1)} KB · 等待上传</small></div>
          {/\.pdf$/i.test(upload.file.name) ? <label><span>PDF 页码范围</span><input aria-label={`${upload.file.name} 的 PDF 页码范围`} value={upload.pageRange} maxLength={200} placeholder="全部页，或填写 1-5,8" disabled={disabled} onChange={(event) => onChange(uploads.map((item, itemIndex) => itemIndex === index ? { ...item, pageRange: event.target.value } : item))} /></label> : null}
          <button type="button" className="material-text-button" disabled={disabled} aria-label={`取消选择 ${upload.file.name}`} onClick={() => { setError(""); onChange(uploads.filter((_, itemIndex) => itemIndex !== index)); }}>移除</button>
        </div>
      ))}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </div>
  );
}

/** 仅传原文件、选择范围和课程版本，正文与来源 ID 由服务端确定。 */
export function materialUploadBody(revision: number, uploads: MaterialUpload[]): FormData {
  const body = new FormData();
  body.set("expectedRevision", String(revision));
  for (const upload of uploads) { body.append("files", upload.file); body.append("pageRanges", upload.pageRange); }
  return body;
}
