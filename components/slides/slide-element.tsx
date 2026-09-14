import type {
  PPTCodeElement,
  PPTElement,
  PPTLineElement,
  PPTShapeElement,
  PPTTableElement,
  PPTTextElement,
  SlideTheme,
} from "@/lib/domain/slide-schemas";
import type { CSSProperties } from "react";
import { resolveTextLayout } from "@/lib/slides/resolve-text-layout";
import { SlideChart } from "./slide-chart";
import styles from "./slide-canvas.module.css";

function TextElement({ element }: { element: PPTTextElement }) {
  const layout = resolveTextLayout(element);
  const alignmentClass = layout.verticalAlign === "middle"
    ? styles.textMiddle
    : layout.verticalAlign === "bottom"
      ? styles.textBottom
      : styles.textTop;
  const textStyle: CSSProperties & { "--slide-paragraph-spacing": string } = {
    left: element.left, top: element.top, width: element.width, height: element.height,
    transform: `rotate(${element.rotate}deg)`, color: layout.color,
    backgroundColor: element.fill, opacity: element.opacity,
    fontFamily: layout.fontFamily, fontSize: layout.fontSizePx, lineHeight: layout.lineHeight,
    padding: layout.paddingPx.map((value) => `${value}px`).join(" "),
    "--slide-paragraph-spacing": `${layout.paragraphSpacingPx}px`,
  };
  return (
    <div
      className={`${styles.box} ${styles.text} ${alignmentClass}`}
      data-element-type="text"
      data-text-type={element.textType}
      style={textStyle}
    >
      <div className={styles.richText} dangerouslySetInnerHTML={{ __html: element.content }} />
    </div>
  );
}

function ShapeElement({ element }: { element: PPTShapeElement }) {
  const gradientId = `shape-gradient-${element.id}`;
  const fill = element.gradient ? `url(#${gradientId})` : element.fill;
  const gradientStops = element.gradient
    ? [...element.gradient.colors].sort((a, b) => a.pos - b.pos)
    : [];
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
        {element.gradient && (
          <defs>
            {element.gradient.type === "linear" ? (
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0" gradientTransform={`rotate(${element.gradient.rotate} 0.5 0.5)`}>
                {gradientStops.map((stop, index) => (
                  <stop key={`${stop.pos}-${index}`} offset={`${stop.pos}%`} stopColor={stop.color} />
                ))}
              </linearGradient>
            ) : (
              <radialGradient id={gradientId}>
                {gradientStops.map((stop, index) => (
                  <stop key={`${stop.pos}-${index}`} offset={`${stop.pos}%`} stopColor={stop.color} />
                ))}
              </radialGradient>
            )}
          </defs>
        )}
        <path
          d={element.path}
          fill={fill}
          stroke={element.outline?.color ?? "none"}
          strokeWidth={element.outline?.width ?? 0}
          strokeDasharray={element.outline?.style === "dashed" ? "8 6" : element.outline?.style === "dotted" ? "2 5" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function LineMarker({ id, kind, color, atStart, width }: { id: string; kind: "" | "arrow" | "dot"; color: string; atStart: boolean; width: number }) {
  if (kind === "") return null;
  const size = Math.max(2, width);
  return (
    <marker id={id} markerWidth={size * 3} markerHeight={size * 3} refX={size * 1.5} refY={size * 1.5} orient="auto" markerUnits="userSpaceOnUse">
      {kind === "arrow"
        ? <path d="M 0 0 L 10 5 L 0 10 Z" fill={color} transform={`scale(${size * 0.3}) rotate(${atStart ? 180 : 0}, 5, 5)`} />
        : <circle cx="5" cy="5" r="5" fill={color} transform={`scale(${size * 0.3})`} />}
    </marker>
  );
}

/** 按模型给出的控制点生成直线或二次曲线路径，循环关系无需再拼接多根直线。 */
function getLinePath(element: PPTLineElement): string {
  const startX = element.left + element.start[0];
  const startY = element.top + element.start[1];
  const endX = element.left + element.end[0];
  const endY = element.top + element.end[1];
  if (!element.curve) return `M ${startX} ${startY} L ${endX} ${endY}`;
  return `M ${startX} ${startY} Q ${element.left + element.curve[0]} ${element.top + element.curve[1]} ${endX} ${endY}`;
}

function LineElement({ element }: { element: PPTLineElement }) {
  const startMarkerId = `line-start-${element.id}`;
  const endMarkerId = `line-end-${element.id}`;
  return (
    <svg className={styles.line} data-element-type="line" aria-hidden="true">
      <defs>
        <LineMarker id={startMarkerId} kind={element.points[0]} color={element.color} atStart width={element.width} />
        <LineMarker id={endMarkerId} kind={element.points[1]} color={element.color} atStart={false} width={element.width} />
      </defs>
      <path
        d={getLinePath(element)}
        stroke={element.color}
        strokeWidth={element.width}
        strokeLinecap="round"
        strokeDasharray={element.style === "dashed" ? "12 8" : element.style === "dotted" ? "2 8" : undefined}
        fill="none"
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

function TableElement({ element }: { element: PPTTableElement }) {
  const totalWidth = element.colWidths.reduce((sum, width) => sum + width, 0) || 1;
  const [headRow, ...dataRows] = element.rows;
  return (
    <div
      className={styles.box}
      data-element-type="table"
      style={{
        left: element.left, top: element.top, width: element.width, height: element.height,
        transform: `rotate(${element.rotate}deg)`,
        borderColor: element.outline?.color,
        borderStyle: element.outline && element.outline.width > 0 ? "solid" : undefined,
        borderWidth: element.outline?.width,
      }}
    >
      <table className={styles.table}>
        <colgroup>
          {element.colWidths.map((width, index) => (
            <col key={index} style={{ width: `${(width / totalWidth) * 100}%` }} />
          ))}
        </colgroup>
        {element.header && (
          <thead>
            <tr>
              {headRow.map((cell, index) => <th key={index}>{cell}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {(element.header ? dataRows : element.rows).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SlideElement({ element, index, theme }: { element: PPTElement; index: number; theme: SlideTheme }) {
  let content;
  switch (element.type) {
    case "text": content = <TextElement element={element} />; break;
    case "shape": content = <ShapeElement element={element} />; break;
    case "line": content = <LineElement element={element} />; break;
    case "code": content = <CodeElement element={element} />; break;
    case "chart": content = <SlideChart element={element} />; break;
    case "table": content = <TableElement element={element} />; break;
    default:
      content = <div className={styles.fallback}>该幻灯片元素暂时无法显示</div>;
  }
  return <div className={styles.elementLayer} style={{ zIndex: index + 1, color: theme.fontColor }}>{content}</div>;
}
