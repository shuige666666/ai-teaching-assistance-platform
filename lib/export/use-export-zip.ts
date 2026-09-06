"use client";

import { useCallback, useState } from "react";
import type { Course } from "@/lib/domain/schemas";
import type { ExportDegradation } from "./build-course-package";

export type ExportState = {
  status: "idle" | "working" | "done" | "error";
  message: string | null;
  degraded: ExportDegradation[];
};

/** 课堂页导出：生成课程 ZIP（PPTX + interactive/*.html）并触发浏览器下载。 */
export function useExportZip() {
  const [state, setState] = useState<ExportState>({ status: "idle", message: null, degraded: [] });

  const exportCourse = useCallback(async (course: Course) => {
    setState({ status: "working", message: "正在生成资源包…", degraded: [] });
    try {
      const { buildCoursePackage } = await import("./build-course-package");
      const pkg = await buildCoursePackage(course, "blob");
      const url = URL.createObjectURL(pkg.zip as Blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = pkg.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      const degradedSummary = pkg.degraded.reduce((sum, item) => sum + item.count, 0);
      setState({
        status: "done",
        message: `已导出 ${pkg.slideCount} 页 PPTX + ${pkg.interactiveCount} 个互动页` +
          (degradedSummary > 0 ? `（${degradedSummary} 项降级）` : ""),
        degraded: pkg.degraded,
      });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "导出失败，请重试", degraded: [] });
    }
  }, []);

  return { state, exportCourse };
}
