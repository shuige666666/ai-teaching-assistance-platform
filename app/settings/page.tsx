import { AppHeader } from "@/components/layout/app-header";
import { UsageDashboard } from "@/components/settings/usage-dashboard";

export default function SettingsPage() {
  return (
    <div className="page">
      <AppHeader active="usage" />
      <main className="page-main settings-shell">
        <section className="page-heading">
          <div>
            <p className="eyebrow">运行观测</p>
            <h1>用量统计</h1>
            <p>查看课程生成运行、模型调用和 token 消耗。这里只记录运行事实，不评价课程内容质量。</p>
          </div>
        </section>
        <UsageDashboard />
      </main>
    </div>
  );
}
