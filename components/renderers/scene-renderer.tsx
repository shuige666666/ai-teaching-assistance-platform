import type { Scene } from "@/lib/domain/schemas";
import { QuizRenderer } from "./quiz-renderer";
import { SlideRenderer } from "./slide-renderer";

type SceneRendererProps = {
  scene: Scene;
  quizDisabled?: boolean;
  quizSessionId?: number;
  onQuizSubmit?: (questionId: string, selectedOptionId: string) => Promise<{ correct: boolean }>;
  onQuizCompleted?: () => void;
};

/** 根据 Scene 判别字段分派固定渲染器，禁止动态执行模型提供的组件代码。 */
export function SceneRenderer({ scene, quizDisabled, quizSessionId, onQuizSubmit, onQuizCompleted }: SceneRendererProps) {
  switch (scene.type) {
    case "slide":
      return <SlideRenderer content={scene.content} />;
    case "quiz":
      return <QuizRenderer key={`${scene.id}:${quizSessionId ?? 0}`} content={scene.content} disabled={quizDisabled} onSubmit={onQuizSubmit} onCompleted={onQuizCompleted} />;
  }
}
