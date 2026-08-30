import type {
  PPTCodeElement,
  PPTElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTextElement,
  SlideTheme,
} from "@/lib/domain/slide-schemas";
import styles from "./slide-canvas.module.css";

function TextElement({ element }: { element: PPTTextElement }) {
  const alignmentClass = element.vAlign === "middle"
    ? styles.textMiddle
    : element.vAlign === "bottom"
      ? styles.textBottom
      : styles.textTop;
  return (
    <div
      className={`${styles.box} ${styles.text} ${alignmentClass}`}
      data-element-type="text"
      data-text-type={element.textType}
      style={{
        left: element.left, top: element.top, width: element.width, height: element.height,
        transform: `rotate(${element.rotate}deg)`, color: element.defaultColor,
        backgroundColor: element.fill, opacity: element.opacity,
        fontFamily: element.defaultFontName, lineHeight: element.lineHeight,
      }}
    >
      <div className={styles.richText} dangerouslySetInnerHTML={{ __html: element.content }} />
    </div>
  );
}

function ShapeElement({ element }: { element: PPTShapeElement }) {
  return (
    <div
      className={styles.box}
      data-element-type="shape"
      style={{
        left: element.left, top: element.top, width: element.width, height: element.height,
        transform: `rotate(${element.rotate}deg)`,
      }}
    >
      <svg className={styles.shape} viewBox={`0 0 ${element.viewBox[0]} ${element.viewBox[1]}`} preserveAspectRatio={element.fixedRatio ? "xMidYMid meet" : "none"} aria-hidden="true">
        <path
          d={element.path}
          fill={element.fill}
          stroke={element.outline?.color ?? "none"}
          strokeWidth={element.outline?.width ?? 0}
          strokeDasharray={element.outline?.style === "dashed" ? "8 6" : element.outline?.style === "dotted" ? "2 5" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function LineMarker({ id, kind, color, atStart }: { id: string; kind: "" | "arrow" | "dot"; color: string; atStart: boolean }) {
  if (kind === "") return null;
  return (
    <marker id={id} markerWidth="10" markerHeight="10" refX={atStart ? 2 : 8} refY="5" orient="auto-start-reverse" markerUnits="strokeWidth">
      {kind === "arrow"
        ? <path d={atStart ? "M 10 0 L 0 5 L 10 10 Z" : "M 0 0 L 10 5 L 0 10 Z"} fill={color} />
        : <circle cx="5" cy="5" r="3.2" fill={color} />}
    </marker>
  );
}

function LineElement({ element }: { element: PPTLineElement }) {
  const startMarkerId = `line-start-${element.id}`;
  const endMarkerId = `line-end-${element.id}`;
  const x1 = element.left + element.start[0];
  const y1 = element.top + element.start[1];
  const x2 = element.left + element.end[0];
  const y2 = element.top + element.end[1];
  return (
    <svg className={styles.line} data-element-type="line" aria-hidden="true">
      <defs>
        <LineMarker id={startMarkerId} kind={element.points[0]} color={element.color} atStart />
        <LineMarker id={endMarkerId} kind={element.points[1]} color={element.color} atStart={false} />
      </defs>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={element.color}
        strokeWidth={element.width}
        strokeLinecap="round"
        strokeDasharray={element.style === "dashed" ? "12 8" : element.style === "dotted" ? "2 8" : undefined}
        markerStart={element.points[0] ? `url(#${startMarkerId})` : undefined}
        markerEnd={element.points[1] ? `url(#${endMarkerId})` : undefined}
      />
    </svg>
  );
}

function CodeElement({ element }: { element: PPTCodeElement }) {
  return (
    <figure
      className={`${styles.box} ${styles.code}`}
      data-element-type="code"
      style={{
        left: element.left, top: element.top, width: element.width, height: element.height,
        transform: `rotate(${element.rotate}deg)`,
      }}
    >
      <figcaption className={styles.codeHeader}>
        <span>{element.fileName ?? "example"}</span>
        <span className={styles.codeLanguage}>{element.language}</span>
      </figcaption>
      <pre className={styles.codeBody} style={{ fontSize: element.fontSize }}>
        {element.lines.map((line, index) => (
          <span className={styles.codeLine} key={line.id}>
            {element.showLineNumbers ? <span className={styles.codeLineNumber}>{index + 1}</span> : <span />}
            <code className={styles.codeLineContent}>{line.content}</code>
          </span>
        ))}
      </pre>
    </figure>
  );
}

export function SlideElement({ element, index, theme }: { element: PPTElement; index: number; theme: SlideTheme }) {
  let content;
  switch (element.type) {
    case "text": content = <TextElement element={element} />; break;
    case "shape": content = <ShapeElement element={element} />; break;
    case "line": content = <LineElement element={element} />; break;
    case "code": content = <CodeElement element={element} />; break;
    default:
      content = <div className={styles.fallback}>该幻灯片元素暂时无法显示</div>;
  }
  return <div className={styles.elementLayer} style={{ zIndex: index + 1, color: theme.fontColor }}>{content}</div>;
}
