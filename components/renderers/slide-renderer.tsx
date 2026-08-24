import type { SlideContent } from "@/lib/domain/schemas";

type SlideRendererProps = {
  content: SlideContent;
};

/**
 * 用固定组件渲染通过 Schema 的幻灯片内容；代码始终作为 React 文本节点显示。
 */
export function SlideRenderer({ content }: SlideRendererProps) {
  return (
    <article className="lesson-sheet" data-testid="slide-renderer">
      {content.subtitle ? <p className="lesson-kicker">{content.subtitle}</p> : null}
      <div className="lesson-blocks">
        {content.blocks.map((block) => {
          switch (block.type) {
            case "paragraph":
              return <p className="lesson-paragraph" key={block.id}>{block.text}</p>;
            case "bullet_list":
              return (
                <ul className="lesson-list" key={block.id}>
                  {block.items.map((item, index) => <li key={`${block.id}-${index}`}>{item}</li>)}
                </ul>
              );
            case "callout":
              return (
                <aside className={`lesson-callout lesson-callout--${block.tone}`} key={block.id}>
                  {block.title ? <strong>{block.title}</strong> : null}
                  <p>{block.text}</p>
                </aside>
              );
            case "code":
              return (
                <figure className="code-card" key={block.id} data-testid="code-block">
                  <figcaption>
                    <span>{block.caption ?? "示例代码"}</span>
                    <span className="code-language">{block.language}</span>
                  </figcaption>
                  <pre><code>{block.code}</code></pre>
                </figure>
              );
          }
        })}
      </div>
    </article>
  );
}
