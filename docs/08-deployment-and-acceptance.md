# 08. 部署、恢复与验收手册

> 适用范围：M6 本机或受信任网络交付。当前版本没有账户与权限系统，不允许直接暴露到公网。

## 1. 最小生产启动

环境要求为 Node.js 20.9+、pnpm 11、MySQL 8.0+。首次部署先复制环境模板，真实密码和模型 Key 只写入被 Git 忽略的 `.env.local`。

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# 编辑 .env.local；演示阶段保持 AI_MODE=mock
pnpm db:migrate
pnpm build
pnpm start
```

启动后依次访问：

- `GET /api/health/database`：确认 MySQL 数据库名和版本；
- `GET /api/health/config`：确认当前 mode、provider、model 和超时配置；该接口不返回 Key 或 Base URL；
- `/`：创建一门 3 场景 mock 课程，完成大纲、场景、播放和测验。

`pnpm db:migrate` 可以重复执行；已登记的迁移会显示 `skip`。生产运行使用 `pnpm build && pnpm start`，不要把 `pnpm dev` 当作交付启动方式。

## 2. 配置档验收

mock 是 CI 和答辩演示的默认配置，不访问模型网络。DeepSeek 与百炼各自只检查当前启用档位，切换后必须重启应用。

```env
AI_MODE=remote
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=<服务端地址>
DEEPSEEK_MODEL=<当前可用模型>
```

百炼使用对应的 `BAILIAN_*` 变量。每次远端 smoke test 应完成一门 3 场景课程，并从 MySQL 中核对 outline 与每个 scene 的 `provider`、`model`、`requestId`、`promptVersion`、`durationMs` 和 `upstreamCalls`。只有 HTTP 200、健康接口成功或配置解析成功都不能单独证明真实生成完成。

## 3. 自动化质量门

```powershell
pnpm exec playwright install chromium  # 新机器首次运行 E2E
pnpm verify                            # lint + unit/API contract + build
pnpm verify:full                       # 再加 MySQL integration + production E2E
```

`verify:full` 要求 MySQL 已启动且 `.env.local` 有效。E2E 使用唯一主题创建测试课程，覆盖创建、大纲、三个场景、播放/暂停/继续、quiz、刷新恢复和配置健康检查，并在 `finally` 中删除课程。失败 trace 和截图位于 `output/playwright/`，该目录不会进入 Git。

GitHub Actions 使用临时 MySQL 和 `AI_MODE=mock` 执行相同质量门，不保存真实 Key，也不调用付费 Provider。

## 4. 备份与恢复

备份前确认没有正在进行的模型生成操作。命令会交互读取密码，不要把密码直接写入脚本或终端历史。

```powershell
mysqldump --single-transaction --default-character-set=utf8mb4 -u root -p ai_teaching > ai_teaching_backup.sql
```

恢复到空数据库后重新运行迁移，确保代码所需结构存在：

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ai_teaching CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
mysql -u root -p ai_teaching < ai_teaching_backup.sql
pnpm db:migrate
```

恢复验收至少包括：数据库健康接口成功、首页课程数量符合预期、随机一门 ready 课程可进入课堂、quiz_attempts 仍与 Course 关联。恢复演练应使用备份副本，不覆盖唯一生产数据库。

## 5. 常见故障

| 现象 | 诊断 | 处理 |
| --- | --- | --- |
| `DATABASE_UNAVAILABLE` | MySQL 未启动、URL/库名错误或端口被占用 | 启动 MySQL，检查 `.env.local`，再访问数据库健康接口 |
| `AI_NOT_CONFIGURED` | remote 当前档位缺 Key、Base URL、Model 或超时非法 | 修正当前 Provider 变量并重启；不要反复点击不可重试按钮 |
| `AI_AUTH_FAILED` | Key 无效、无权限或地域/Base URL 不匹配 | 在 Provider 控制台确认权限和地域，不自动切换 mock |
| `AI_RATE_LIMITED` / 5xx | 上游限流或短暂故障 | 等待后重试；系统最多自动传输重试两次 |
| 页面显示生成中但进程已重启 | 数据库保留未过期 activeOperation | 等租约到期，在对应场景点击“恢复” |
| `COURSE_CONFLICT` | 页面 revision 落后于服务器 | 刷新课程后重新操作，禁止覆盖新版本 |
| Playwright 缺浏览器 | 首次机器没有对应 Chromium | 运行 `pnpm exec playwright install chromium` |
| Windows `.next/trace-build` EPERM | 旧 Node/Next 进程占用构建目录 | 停止旧进程后重新构建，不删除源码或重置 Git |

## 6. AC-01～AC-12 证据矩阵

| 条件 | 当前证据 | 状态 |
| --- | --- | --- |
| AC-01 全新环境启动 | 本手册、`.env.example`、幂等迁移与 CI 临时环境 | 需再做一台异机人工复现 |
| AC-02 mock 无 Key 完整流程 | `e2e/mock-course-flow.spec.ts` | 自动通过 |
| AC-03 生成 3～5 项大纲 | outline 单元测试与 3 场景 E2E | 自动通过 |
| AC-04 slide/quiz 与代码块 | scene 装配、renderer 安全测试与 E2E | 自动通过 |
| AC-05 非法模型 JSON 不持久化 | outline/scene pipeline repair 与失败测试 | 自动通过 |
| AC-06 中间失败隔离和重试 | SceneGenerationService 故障注入测试 | 自动通过 |
| AC-07 播放、暂停、继续和导航 | playback reducer 与 Chromium E2E | 自动通过 |
| AC-08 quiz 提交和解析 | 服务端判分、MySQL integration 与 E2E | 自动通过 |
| AC-09 刷新后恢复 | MySQL 新仓储实例测试与 E2E `page.reload()` | 自动通过 |
| AC-10 无语音完成 | TextOnly、BrowserSpeech 回退测试与 E2E | 自动通过 |
| AC-11 密钥不进入客户端 | 服务端配置边界、bundle/仓库扫描与 storage 检查 | 自动 + 人工审计通过 |
| AC-12 质量命令 | `pnpm verify:full` 与 GitHub Actions | 自动通过 |

M6 代码和 mock 验收完成后仍有三项外部证据不能伪造：DeepSeek 真实生成、百炼真实生成、另一台干净机器按本文复现。获得 Key 或异机环境后补充记录，才跨过完整远端交付退出门。
