"use client";

import { useId, useState, type DragEvent } from "react";
import { CloudUpload, FileText, X } from "lucide-react";
import { MAX_MATERIAL_FILES, MAX_MATERIAL_FILE_BYTES } from "@/lib/materials/types";

export type MaterialUpload = { file: File; pageRange: string };

const ACCEPTED_EXTENSIONS = /\.(pdf|md|markdown|txt)$/i;

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** 首页和大纲页共用文件选择器，PDF 范围在上传前就可以缩小到所需章节。 */
export function MaterialFilePicker({ uploads, onChange, disabled = false }: {
  uploads: MaterialUpload[]; onChange: (uploads: MaterialUpload[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  /** 点击选择和拖放共用同一套数量、大小与格式校验。 */
  function addFiles(files: File[]) {
    if (!files.length) return;
    if (uploads.length + files.length > MAX_MATERIAL_FILES) { setError("每门课程最多选择 3 份材料"); return; }
    if (files.some((file) => !ACCEPTED_EXTENSIONS.test(file.name))) { setError("仅支持 PDF、Markdown 和 TXT 文件"); return; }
    if (files.some((file) => !file.size || file.size > MAX_MATERIAL_FILE_BYTES)) { setError("文件不能为空，且每份不能超过 10 MB"); return; }
    setError("");
    onChange([...uploads, ...files.map((file) => ({ file, pageRange: "" }))]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) addFiles(Array.from(event.dataTransfer.files));
  }

  const full = uploads.length >= MAX_MATERIAL_FILES;

  return (
    <div className="material-picker">
      <div className="material-picker__head">
        <span className="field-label">教学材料 <small className="field-optional">可选</small></span>
        <small>{uploads.length} / {MAX_MATERIAL_FILES} 份</small>
      </div>
      <input id={id} className="visually-hidden" type="file" accept=".pdf,.md,.markdown,.txt" multiple disabled={disabled || full} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        addFiles(files);
      }} />
      <label
        htmlFor={id}
        className={`dropzone${dragging ? " is-dragging" : ""}${disabled || full ? " is-disabled" : ""}`}
        onDragOver={(event) => { event.preventDefault(); if (!disabled && !full) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <CloudUpload aria-hidden="true" />
        <span>
          <strong>{full ? "已达到 3 份上限" : "点击选择或拖入讲义、教材"}</strong>
          <small>文字型 PDF、Markdown、TXT · 每份 ≤ 10 MB · 正文合计 ≤ 40,000 字符</small>
        </span>
      </label>
      {uploads.length ? (
        <ul className="file-list">
          {uploads.map((upload, index) => (
            <li className="file-row" key={`${upload.file.name}:${index}`}>
              <span className="file-row__icon" aria-hidden="true"><FileText /></span>
              <div className="file-row__info"><strong>{upload.file.name}</strong><small>{formatSize(upload.file.size)} · 等待上传</small></div>
              {/\.pdf$/i.test(upload.file.name) ? (
                <label className="file-row__range">
                  <span>页码范围</span>
                  <input aria-label={`${upload.file.name} 的 PDF 页码范围`} value={upload.pageRange} maxLength={200} placeholder="全部，或 1-5,8" disabled={disabled} onChange={(event) => onChange(uploads.map((item, itemIndex) => itemIndex === index ? { ...item, pageRange: event.target.value } : item))} />
                </label>
              ) : null}
              <button type="button" className="icon-btn icon-btn--danger" disabled={disabled} aria-label={`取消选择 ${upload.file.name}`} title="移除" onClick={() => { setError(""); onChange(uploads.filter((_, itemIndex) => itemIndex !== index)); }}><X aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
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
