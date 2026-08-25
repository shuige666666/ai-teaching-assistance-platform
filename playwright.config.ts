import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "output/playwright/test-results",
  reporter: [["line"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `pnpm start --port ${port}`,
    url: `${baseURL}/api/health/database`,
    // 自动验收必须固定走 mock，避免本机 remote 配置触发付费调用或改变测试数据形状。
    env: { ...process.env, AI_MODE: "mock", AI_PROVIDER: "deepseek" } as Record<string, string>,
    // 不复用未知配置的既有进程；端口被占用时应明确失败，而不是得到伪造的验收结果。
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } }],
});
