"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, CircleAlert, CircleCheck, FileText, Lock, RefreshCw, Trash2, TriangleAlert, Upload } from "lucide-react";
import type { Course } from "@/lib/domain/schemas";
import type { CourseMaterial, MaterialBlock } from "@/lib/materials/types";
import { MaterialFilePicker, materialUploadBody, type MaterialUpload } from "./material-file-picker";

/** 原文只以 React 文本节点展示，上传的 Markdown/HTML 不作为可执行页面渲染。 */
export function MaterialText({ block }: { block: MaterialBlock }) {
  return <div className="material-excerpt"><small>{block.pageNumber ? `PDF 第 ${block.pageNumber} 页` : block.heading ?? "正文片段"}</small><pre>{block.text}</pre></div>;
}

/** 大纲审核前允许替换材料；展示保存后的解析结果，支持失败重试与删除。 */
export function CourseMaterialsPanel({ course, disabled, onCourseChange, onBusyChange, onPendingChange }: {
  course: Course; disabled: boolean; onCourseChange: (course: Course) => void;
  onBusyChange: (busy: boolean) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [uploads, setUploads] = useState<MaterialUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const editable = !course.scenes.length && !course.activeOperation && ["draft", "outline_ready", "failed"].includes(course.status);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/courses/${course.id}/materials`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "材料加载失败");
      setMaterials(payload.data.materials); setLoading(false); setError("");
    }).catch((caught) => { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "材料加载失败"); setLoading(false); } });
    return () => { controller.abort(); mutation.current?.abort(); };
  }, [course.id, refresh]);

  function changeUploads(next: MaterialUpload[]) { setUploads(next); onPendingChange(next.length > 0); setNotice(""); }

  /** 服务端成功后再更新材料与课程版本，失败时保留待上传文件。 */
  async function saveMaterials(materialId?: string) {
    const controller = new AbortController();
    mutation.current = controller;
    setSaving(true); onBusyChange(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/courses/${course.id}/materials`, materialId ? {
        method: "DELETE", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: course.revision, materialId }),
      } : { method: "POST", signal: controller.signal, body: materialUploadBody(course.revision, uploads) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "材料保存失败");
      setMaterials(payload.data.materials); onCourseChange(payload.data.course);
      if (!materialId) changeUploads([]);
      setNotice("材料已保存，请根据当前材料生成大纲。");
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "材料保存失败");
    } finally { setSaving(false); onBusyChange(false); mutation.current = null; }
  }

  return <section className="panel course-materials-panel" aria-label="课程教学材料">
    <header className="panel__head">
      <div className="panel__title">
        <span className="panel__icon panel__icon--amber" aria-hidden="true"><BookOpenText /></span>
        <div>
          <h2>教学材料</h2>
          <p>{editable ? "生成大纲前可以上传或替换讲义，AI 会优先依据原文生成" : materials.length ? "材料已随课程固定，修订页面时会继续参考对应原文" : "这门课程使用主题生成，没有上传教学材料"}</p>
        </div>
      </div>
      <span className="meta-chip">{editable ? null : <Lock aria-hidden="true" />}{materials.length} / 3 份</span>
    </header>
    {loading || materials.length || editable || error || notice ? <div className="panel__body material-panel-body">
      {loading ? <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" />正在读取材料…</p> : null}
      {materials.length ? <ul className="file-list">
        {materials.map((material) => <li className="material-saved" key={material.id}>
          <details>
            <summary>
              <span className="file-row__icon" aria-hidden="true"><FileText /></span>
              <span className="file-row__info"><strong>{material.fileName}</strong><small>{material.blocks.reduce((sum, block) => sum + block.text.length, 0).toLocaleString()} 字符{material.pageCount ? ` · 共 ${material.pageCount} 页，使用 ${material.selectedPages?.length} 页` : ""} · 点击查看解析原文</small></span>
            </summary>
            <div className="material-saved__detail">
              {material.selectedPages ? <p className="material-hint">已使用 PDF 实际页码：{material.selectedPages.join("、")}</p> : null}
              {material.warnings.map((warning) => <p className="notice notice--warning" key={warning}><TriangleAlert aria-hidden="true" />{warning}</p>)}
              <div className="material-preview">{material.blocks.map((block) => <MaterialText key={block.id} block={block} />)}</div>
            </div>
          </details>
          {editable ? <button type="button" className="icon-btn icon-btn--danger" disabled={disabled || saving || loading} onClick={() => void saveMaterials(material.id)} aria-label={`删除材料 ${material.fileName}`} title="删除材料"><Trash2 aria-hidden="true" /></button> : null}
        </li>)}
      </ul> : null}
      {editable ? <>
        <MaterialFilePicker uploads={uploads} onChange={changeUploads} disabled={disabled || saving || loading} />
        {uploads.length ? <div className="material-actions">
          <p className="form-note">{materials.length ? "保存后将替换当前全部材料，并清空旧大纲。" : "请先解析并保存材料，再生成课程大纲。"}</p>
          <button type="button" className="btn btn--primary" disabled={disabled || saving || loading} onClick={() => void saveMaterials()}>
            {saving ? <span className="spinner" aria-hidden="true" /> : <Upload aria-hidden="true" />}{saving ? "正在解析并保存…" : "解析并保存材料"}
          </button>
        </div> : null}
      </> : null}
      {error ? <div className="notice notice--danger" role="alert"><CircleAlert aria-hidden="true" /><div className="notice__body"><p>{error}</p></div><button type="button" className="btn btn--secondary btn--sm" disabled={saving} onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}><RefreshCw aria-hidden="true" />重新读取</button></div> : null}
      {notice ? <p className="notice notice--success" role="status"><CircleCheck aria-hidden="true" />{notice}</p> : null}
    </div> : null}
  </section>;
}
