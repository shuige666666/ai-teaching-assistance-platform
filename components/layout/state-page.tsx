import type { ReactNode } from "react";
import { CircleAlert, DatabaseZap, Hourglass, SearchX } from "lucide-react";
import { AppHeader } from "./app-header";

const icons = {
  "not-found": SearchX,
  database: DatabaseZap,
  pending: Hourglass,
  error: CircleAlert,
} as const;

/** 整页状态（不存在、数据库不可用、尚未就绪、异常）共用一张居中卡片。 */
export function StatePage({ kind, eyebrow, title, description, actions, children }: {
  kind: keyof typeof icons;
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  const Icon = icons[kind];
  return (
    <div className="page">
      <AppHeader />
      <main className="state-page">
        <section className={`state-card state-card--${kind}`}>
          <span className="state-card__icon" aria-hidden="true"><Icon /></span>
          <p className="state-card__eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="state-card__text">{description}</p>
          {children}
          <div className="state-card__actions">{actions}</div>
        </section>
      </main>
    </div>
  );
}
