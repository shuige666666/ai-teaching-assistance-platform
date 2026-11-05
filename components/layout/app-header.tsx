import Link from "next/link";
import type { ReactNode } from "react";
import { ChartColumn, LibraryBig } from "lucide-react";

/** 品牌标识在顶栏和课堂页共用，保持同一视觉入口。 */
export function Brand({ subtitle = "AI 教学辅助平台", href = "/" }: { subtitle?: string; href?: string }) {
  return (
    <Link className="brand" href={href} aria-label="课序首页">
      <span className="brand-mark" aria-hidden="true">课</span>
      <span className="brand-text">
        <strong>课序</strong>
        <small>{subtitle}</small>
      </span>
    </Link>
  );
}

/** 应用级顶栏：品牌、主导航和页面自带的附加内容（如生成步骤）。 */
export function AppHeader({ active, children }: { active?: "library" | "usage"; children?: ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Brand />
        <nav className="app-nav" aria-label="主导航">
          <Link href="/" aria-current={active === "library" ? "page" : undefined}>
            <LibraryBig aria-hidden="true" />
            <span>课程库</span>
          </Link>
          <Link href="/settings" aria-current={active === "usage" ? "page" : undefined}>
            <ChartColumn aria-hidden="true" />
            <span>用量统计</span>
          </Link>
        </nav>
        {children ? <div className="app-header__extra">{children}</div> : null}
      </div>
    </header>
  );
}

export type StepState = "done" | "current" | "todo";

/** 课程制作流程的位置指示，只表达状态，不承担导航。 */
export function Stepper({ steps }: { steps: Array<{ label: string; state: StepState }> }) {
  return (
    <ol className="stepper" aria-label="课程制作进度">
      {steps.map((step, index) => (
        <li key={step.label} className={`is-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
          <span className="stepper__dot" aria-hidden="true">{step.state === "done" ? "✓" : index + 1}</span>
          <span className="stepper__label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
