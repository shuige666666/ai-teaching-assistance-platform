"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpenText, CircleAlert, FileSearch, X } from "lucide-react";
import type { Scene } from "@/lib/domain/schemas";
import type { CourseMaterial } from "@/lib/materials/types";
import { MaterialText } from "./course-materials-panel";

/** 按本次生成真实使用的片段展示来源，原文由课程接口读取，页面切换后关闭面板。 */
export function SceneMaterialSources({ scene }: { scene: Scene }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);

  async function openSources() {
    dialog.current?.showModal();
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/courses/${scene.courseId}/materials`, { signal: controller.signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "参考材料读取失败");
      setMaterials(payload.data.materials);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "参考材料读取失败"); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const ids = new Set(scene.sourceBlockIds ?? []);
  const sources = materials.flatMap((material) => material.blocks.filter((block) => ids.has(block.id)).map((block) => ({ material, block })));
  return <>
    <button type="button" className="toolbar-button material-source-button" onClick={() => void openSources()} title="查看本页参考的教学材料">
      <BookOpenText aria-hidden="true" /><span className="toolbar-button__label">参考材料</span>
    </button>
    <dialog ref={dialog} className="material-source-dialog" aria-label="本页参考材料" onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <header className="dialog-head">
        <div><p className="eyebrow">参考材料</p><h2>本页参考材料</h2><p className="dialog-head__sub">{scene.title}</p></div>
        <button type="button" className="icon-btn" aria-label="关闭参考材料" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>
      </header>
      <div className="dialog-body">
        <p className="form-note">以下是生成本页时提供的原文片段，便于核对定义、数字与案例；不代表页面中的每句话都已核验。</p>
        {scene.updatedAt > scene.createdAt ? <p className="form-note">本页生成后有过编辑，以下保留生成时的参考记录。</p> : null}
        {loading ? <p className="loading-line" role="status"><span className="spinner" aria-hidden="true" />正在读取参考材料…</p> : error ? (
          <div role="alert" className="notice notice--danger"><CircleAlert aria-hidden="true" /><div className="notice__body"><p>{error}</p></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => void openSources()}>重试</button></div>
        ) : <>
          {!sources.length ? (
            <div className="empty-state empty-state--compact">
              <span className="empty-state__icon" aria-hidden="true"><FileSearch /></span>
              <p>{materials.length ? "本页生成时没有关联材料片段。" : "这门课程没有上传教学材料。"}</p>
            </div>
          ) : null}
          {sources.map(({ material, block }) => <article className="source-item" key={block.id}><h3>{material.fileName}</h3><MaterialText block={block} /></article>)}
        </>}
      </div>
    </dialog>
  </>;
}
