import { AppHeader } from "./app-header";

/** 路由切换时立即显示的骨架屏，形状与真实页面保持一致，避免布局跳动。 */
export function LibrarySkeleton() {
  return (
    <div className="page" aria-busy="true">
      <AppHeader active="library" />
      <main className="page-main">
        <p className="visually-hidden" role="status">正在加载课程库…</p>
        <div className="home-hero">
          <div className="home-intro">
            <div className="skeleton" style={{ width: 150, height: 28, borderRadius: 999 }} />
            <div className="skeleton" style={{ width: "80%", height: 56, marginTop: 24 }} />
            <div className="skeleton" style={{ width: "60%", height: 56, marginTop: 12 }} />
            <div className="skeleton" style={{ width: "90%", height: 18, marginTop: 24 }} />
          </div>
          <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />
        </div>
        <div className="course-grid">
          {Array.from({ length: 4 }, (_, index) => <div className="skeleton" key={index} style={{ height: 210, borderRadius: 16 }} />)}
        </div>
      </main>
    </div>
  );
}

export function GenerationSkeleton() {
  return (
    <div className="page" aria-busy="true">
      <AppHeader />
      <main className="page-main">
        <p className="visually-hidden" role="status">正在加载课程…</p>
        <div className="skeleton" style={{ width: 110, height: 18 }} />
        <div className="skeleton" style={{ width: "55%", height: 38, marginTop: 18 }} />
        <div className="skeleton" style={{ width: "35%", height: 18, marginTop: 12, marginBottom: 28 }} />
        <div className="generation-layout">
          <div className="generation-main">
            <div className="skeleton" style={{ height: 220, borderRadius: 16 }} />
            <div className="skeleton" style={{ height: 360, borderRadius: 16 }} />
          </div>
          <div className="skeleton" style={{ height: 280, borderRadius: 16 }} />
        </div>
      </main>
    </div>
  );
}

export function ClassroomSkeleton() {
  return (
    <div className="classroom-skeleton" aria-busy="true">
      <p className="visually-hidden" role="status">正在进入课堂…</p>
      <div className="skeleton" style={{ height: 60, borderRadius: 0 }} />
      <div className="classroom-skeleton__body">
        <div className="skeleton" style={{ borderRadius: 14 }} />
        <div className="classroom-skeleton__stage"><div className="skeleton" /></div>
        <div className="skeleton" style={{ borderRadius: 14 }} />
      </div>
    </div>
  );
}
