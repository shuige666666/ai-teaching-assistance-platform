import type { Scene } from "@/lib/domain/schemas";
import { QuizRenderer } from "./quiz-renderer";
import { SlideRenderer } from "./slide-renderer";
import { InteractiveRenderer } from "@/components/interactive/interactive-renderer";

type SceneRendererProps = {
  scene: Scene;
  quizSessionId?: number;
  onQuizSubmit?: (questionId: string, selectedOptionIds: string[]) => Promise<{ correct: boolean }>;
  onQuizCompleted?: () => void;
  onInteractiveCompleted?: () => void;
  onInteractiveRegenerate?: (runtimeError: string) => Promise<void>;
  onCancelRegeneration?: () => void;
};

/** 根据 Scene 判别字段分派固定渲染器，禁止动态执行模型提供的组件代码。 */
export function SceneRenderer({ scene, quizSessionId, onQuizSubmit, onQuizCompleted, onInteractiveCompleted, onInteractiveRegenerate, onCancelRegeneration }: SceneRendererProps) {
  switch (scene.type) {
    case "slide":
      return <SlideRenderer content={scene.content} />;
    case "quiz":
      return <QuizRenderer key={`${scene.id}:${quizSessionId ?? 0}`} content={scene.content} onSubmit={onQuizSubmit} onCompleted={onQuizCompleted} />;
    case "interactive":
      return <InteractiveRenderer key={`${scene.id}:${quizSessionId ?? 0}`} content={scene.content} onCompleted={onInteractiveCompleted} onRegenerate={onInteractiveRegenerate} onCancelRegeneration={onCancelRegeneration} />;
  }
}
