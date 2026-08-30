import type { SlideContent } from "@/lib/domain/schemas";
import { SlideCanvas } from "@/components/slides/slide-canvas";

type SlideRendererProps = {
  content: SlideContent;
};

/** 渲染已经过服务端净化和领域 Schema 校验的只读 PPT 式画布。 */
export function SlideRenderer({ content }: SlideRendererProps) {
  return (
    <article className="ppt-slide" data-testid="slide-renderer">
      <SlideCanvas slide={content.canvas} />
    </article>
  );
}
