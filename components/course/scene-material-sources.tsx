"use client";

import { useEffect, useRef, useState } from "react";
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
    <button type="button" className="material-source-button" onClick={() => void openSources()}>参考材料</button>
    <dialog ref={dialog} className="material-source-dialog" aria-label="本页参考材料">
      <header><div><h2>本页参考材料</h2><p>{scene.title}</p></div><button type="button" aria-label="关闭参考材料" onClick={() => dialog.current?.close()}>×</button></header>
      <p className="material-hint">以下是生成本页时提供的原文片段，便于核对定义、数字与案例；不代表页面中的每句话都已核验。</p>
      {scene.updatedAt > scene.createdAt ? <p className="material-hint">本页生成后有过编辑，以下保留生成时的参考记录。</p> : null}
      {loading ? <p role="status">正在读取参考材料…</p> : error ? <p role="alert" className="form-error">{error} <button type="button" onClick={() => void openSources()}>重试</button></p> : <>
        {!sources.length ? <p>{materials.length ? "本页生成时没有关联材料片段。" : "这门课程没有上传教学材料。"}</p> : null}
        {sources.map(({ material, block }) => <article key={block.id}><h3>{material.fileName}</h3><MaterialText block={block} /></article>)}
      </>}
    </dialog>
  </>;
}
