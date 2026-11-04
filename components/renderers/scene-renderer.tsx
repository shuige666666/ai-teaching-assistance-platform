import type { Scene } from "@/lib/domain/schemas";
import { QuizRenderer } from "./quiz-renderer";
import { SlideRenderer } from "./slide-renderer";
import { InteractiveRenderer } from "@/components/interactive/interactive-renderer";

type SceneRendererProps = {
  scene: Scene;
  sceneCount?: number;
  focusElementIds?: string[];
  quizSessionId?: number;
  onQuizSubmit?: (questionId: string, selectedOptionIds: string[]) => Promise<{ correct: boolean }>;
  onQuizCompleted?: () => void;
  onInteractiveCompleted?: () => void;
  onInteractiveRegenerate?: (runtimeError: string) => Promise<void>;
  onCancelRegeneration?: () => void;
};

/** 根据 Scene 判别字段分派固定渲染器，禁止动态执行模型提供的组件代码。 */
export function SceneRenderer({ scene, sceneCount, focusElementIds, quizSessionId, onQuizSubmit, onQuizCompleted, onInteractiveCompleted, onInteractiveRegenerate, onCancelRegeneration }: SceneRendererProps) {
  // 课件和互动共用一行场景编号，互动标题由脚本自己显示。
  const number = String(scene.order).padStart(2, "0");
  const canvasMeta = sceneCount === undefined ? undefined : (
    <>
      <span aria-label={`当前场景：${scene.title}`}>{scene.type.toUpperCase()} · SCENE {number}</span>
      <span>{number} / {String(sceneCount).padStart(2, "0")}</span>
    </>
  );
  switch (scene.type) {
    case "slide":
      return <>
        {canvasMeta && <div className="scene-canvas-meta">{canvasMeta}</div>}
        <SlideRenderer content={scene.content} focusElementIds={focusElementIds} />
      </>;
    case "quiz":
      return <QuizRenderer key={`${scene.id}:${quizSessionId ?? 0}`} content={scene.content} onSubmit={onQuizSubmit} onCompleted={onQuizCompleted} />;
    case "interactive":
      return <InteractiveRenderer key={`${scene.id}:${quizSessionId ?? 0}`} content={scene.content} canvasMeta={canvasMeta} onCompleted={onInteractiveCompleted} onRegenerate={onInteractiveRegenerate} onCancelRegeneration={onCancelRegeneration} />;
  }
}
