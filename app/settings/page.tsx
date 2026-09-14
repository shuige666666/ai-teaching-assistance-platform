import Link from "next/link";
import { UsageDashboard } from "@/components/settings/usage-dashboard";

export default function SettingsPage() {
  return (
    <main className="settings-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="返回课序首页">
          <span className="brand-mark">课</span>
          <span><strong>课序</strong><small>COURSE COMPOSER</small></span>
        </Link>
        <Link className="settings-back" href="/">← 返回课程</Link>
      </header>
      <section className="settings-heading reveal reveal--one">
        <div>
          <p className="eyebrow">SETTINGS / OBSERVABILITY</p>
          <h1>用量统计</h1>
          <p>查看课程生成运行、模型调用和可获得的 token。这里记录运行事实，不评价课程内容质量。</p>
        </div>
        <span>01 / USAGE</span>
      </section>
      <UsageDashboard />
    </main>
  );
}
