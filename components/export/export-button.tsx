"use client";

import type { Course } from "@/lib/domain/schemas";
import { useExportZip } from "@/lib/export/use-export-zip";

/** 课堂页导出入口：ready/partial 课程可导出 ZIP（课程 PPTX + interactive/*.html）。 */
export function ExportButton({ course }: { course: Course }) {
  const { state, exportCourse } = useExportZip();
  const exportable = course.status === "ready" || course.status === "partial_failed";
  const disabled = !exportable || state.status === "working";

  return (
    <div className="export-zone" data-testid="export-zone" data-export-state={state.status}>
      <button
        type="button"
        className="export-button"
        data-testid="export-button"
        disabled={disabled}
        title={exportable ? "导出课程 PPTX 与互动 HTML 资源包" : "课程尚未生成场景，无法导出"}
        onClick={() => void exportCourse(course)}
      >
        {state.status === "working" ? "导出中…" : "⤓ 导出课程"}
      </button>
      {state.message && (
        <small
          className={state.status === "error" ? "export-message export-message-error" : "export-message"}
          data-testid="export-message"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {state.message}
          {state.degraded.length > 0 && (
            <span className="export-degraded">
              {state.degraded.map((item) => `${item.kind} ×${item.count}`).join("、")}
            </span>
          )}
        </small>
      )}
    </div>
  );
}
