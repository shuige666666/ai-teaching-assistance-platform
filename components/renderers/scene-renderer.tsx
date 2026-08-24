import type { Scene } from "@/lib/domain/schemas";
import { QuizRenderer } from "./quiz-renderer";
import { SlideRenderer } from "./slide-renderer";

/** 根据 Scene 判别字段分派固定渲染器，禁止动态执行模型提供的组件代码。 */
export function SceneRenderer({ scene }: { scene: Scene }) {
  switch (scene.type) {
    case "slide":
      return <SlideRenderer content={scene.content} />;
    case "quiz":
      return <QuizRenderer content={scene.content} />;
  }
}
