# 08. 部署、恢复与验收手册

> 适用范围：第 1～7 节记录已完成的 M6/M6.5 本机或受信任网络交付；第 8 节是 M7/v0.4 的计划验收，不代表当前已经实现。当前版本没有账户与权限系统，不允许直接暴露到公网。

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

mock 是 CI 和答辩演示的默认配置，不访问模型网络。MVP 的 remote 档位使用 DeepSeek，切换配置后必须重启应用；百炼兼容变量仅供后续扩展。

```env
AI_MODE=remote
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=<服务端地址>
DEEPSEEK_MODEL=<当前可用模型>
```

DeepSeek smoke test 应完成一门至少 3 场景的课程，并从 MySQL 中核对 outline 与每个 scene 的 `provider`、`model`、`requestId`、`promptVersion`、`durationMs` 和 `upstreamCalls`。只有 HTTP 200、健康接口成功或配置解析成功都不能单独证明真实生成完成。百炼若在后续启用，沿用同一证据要求，但不影响当前验收。

## 3. 自动化质量门

```powershell
pnpm exec playwright install chromium  # 新机器首次运行 E2E
pnpm verify                            # lint + unit/API contract + build
pnpm verify:full                       # 再加 MySQL integration + production E2E
```

`verify:full` 要求 MySQL 已启动且 `.env.local` 有效。E2E 使用唯一主题创建测试课程，覆盖创建、大纲、三个场景、播放/暂停/继续、quiz、刷新恢复和配置健康检查，并在 `finally` 中删除课程。Playwright 启动的 production server 显式覆盖为 `AI_MODE=mock` 且不复用既有端口服务，因此即使 `.env.local` 当前配置为 remote，也不会由自动验收触发付费模型调用。失败 trace 和截图位于 `output/playwright/`，该目录不会进入 Git，也不会参与 ESLint。

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
| `INVALID_MODEL_OUTPUT` | 首次输出和一次修复仍未通过场景契约 | 已完成场景不会丢失且可从生成页进入部分预览；在失败场景右侧点击“重试”，新请求会重新采样。若旧日志提示 HTML 且主题要求 React/JSX，更新到已收窄 `code.code` 校验的版本后再试 |
| 页面显示生成中但进程已重启 | 数据库保留未过期 activeOperation | 等租约到期，在对应场景点击“恢复” |
| `COURSE_CONFLICT` | 页面 revision 落后于服务器 | 刷新课程后重新操作，禁止覆盖新版本 |
| Playwright 缺浏览器 | 首次机器没有对应 Chromium | 运行 `pnpm exec playwright install chromium` |
| Windows `.next/trace-build` EPERM | 旧 Node/Next 进程占用构建目录 | 停止旧进程后重新构建，不删除源码或重置 Git |
| `<html>` hydration mismatch 且包含 `--ai-translator-*` | 翻译类浏览器扩展在 React 水合前修改根元素样式 | 根布局只忽略根元素外部属性差异；需要确认来源时用无痕窗口或暂时关闭对应扩展复测 |

### 开发调试与生成可观测性

`pnpm dev` 适合日常开发，并会在终端输出 JSON 行日志。需要 IDE 服务端断点时改用 `pnpm dev:inspect`；Inspector 只增加断点能力，不会替代业务日志。

```powershell
pnpm dev          # 页面热更新 + 结构化业务日志
pnpm dev:inspect  # 在上述能力之外开启 Node Inspector
```

一次课程创建或生成操作会使用相同 `requestId` 贯穿浏览器操作台、请求头、API 响应/错误和服务端日志。日志事件为 `course.create.*`、`outline.generate.*`、`scene.generate.*`；持续操作每 10 秒输出 `running` 和 `elapsedMs`。M6.5 另增 `ai.upstream.retrying` 与 `ai.upstream.rejected`，用 `upstreamAttempt`、`responseKind`、`providerStatus`、`responseBytes`、`finishReason` 和 `willRetry` 说明远端响应状态。排障时先复制页面 requestId，再在终端搜索该值，不要通过反复点击制造重复草稿。日志刻意不记录主题、Prompt、模型返回、Key 和数据库连接串。

如果首页停在“正在打开工作台”，先复制 requestId，然后直接刷新首页检查“最近课程”。看到课程说明草稿已经写入 MySQL，可点击该课程继续，不应再次创建。客户端保存草稿超过 15 秒会停止等待并显示同样的排障提示；服务端可能已完成提交，因此重试前仍应刷新核对。

## 6. DeepSeek 真实 Provider 验收记录

2026-08-25 已完成一门 5 场景 DeepSeek 真实课程，超过本手册要求的 3 场景最低 smoke test。MySQL 脱敏核验结果如下：

| 对象 | Provider / 模型 | Prompt | 耗时 | 上游调用 / 修复 | 请求编号 |
| --- | --- | --- | ---: | --- | --- |
| 大纲 | `deepseek` / `deepseek-v4-flash` | `outline.v1` | 14446ms | 1 / 否 | `82bf9e49-f2ea-4982-9378-c2f4b61926de` |
| slide 1 | `deepseek` / `deepseek-v4-flash` | `scene-slide.v1` | 7759ms | 1 / 否 | `1a92ef86-8ddb-48d6-be93-bf54ac4a10b0` |
| slide 2 | `deepseek` / `deepseek-v4-flash` | `scene-slide.v1` | 14219ms | 1 / 否 | `13ea832b-e1da-45f5-af50-70754be0efd6` |
| slide 3 | `deepseek` / `deepseek-v4-flash` | `scene-slide.v1` | 18071ms | 2 / 是 | `5f310590-5184-47c3-8527-8e2e0d0fc61b` |
| slide 4 | `deepseek` / `deepseek-v4-flash` | `scene-slide.v1` | 11979ms | 1 / 否 | `229af453-f352-47b5-b8fe-63a22606d7e7` |
| quiz 5 | `deepseek` / `deepseek-v4-flash` | `scene-quiz.v1` | 11143ms | 2 / 是 | `ded5339d-339e-48f4-86b0-573d4c678641` |

课程 `40e63cea-8afd-462c-b888-300e4ddee3d9` 最终为 `ready`、`REV.16`、`5/5` 场景完成。生成过程中两个场景曾因 `INVALID_MODEL_OUTPUT` 失败，其他完成场景保持不变；用户从失败场景右侧逐项重试后成功，因而同时形成了真实 Provider 的失败隔离和恢复证据。记录不包含主题、API Key、数据库连接串、Prompt 正文或模型原文。

### 6.1 M6.5 远端响应自动恢复记录

2026-08-26 用 `deepseek-v4-flash` 生成一门临时 3 场景课程。outline 使用 1 次上游调用；三个 scene 分别使用 2、4、2 次。第 2 场 requestId 为 `1d5aa4c2-438b-4189-afbe-126ff07e5834`，repair 在第 2、3 次调用均收到 HTTP 200、`responseKind=empty_content`、`finishReason=length`，系统输出两条 `ai.upstream.retrying` 后在第 4 次调用成功。最终课程为 `3/3 ready`，说明响应异常与内容 repair 共享同一 4 次调用硬上限且可真实恢复。临时课程验收后已删除。

## 7. AC-01～AC-12 证据矩阵

| 条件 | 当前证据 | 状态 |
| --- | --- | --- |
| AC-01 本机生产启动 | 本手册、`.env.example`、幂等迁移、本机 production build 与 E2E | 通过 |
| AC-02 mock 无 Key 完整流程 | `e2e/mock-course-flow.spec.ts` | 自动通过 |
| AC-03 生成 3～5 项大纲 | outline 单元测试、3 场景 E2E 与 DeepSeek 5 场景实测 | 自动 + DeepSeek 人工通过 |
| AC-04 slide/quiz 与代码块 | scene 装配、只读 JSX 契约、renderer 转义安全测试与 E2E | 自动通过 |
| AC-05 非法模型 JSON 不持久化 | outline/scene pipeline repair 与失败测试 | 自动通过 |
| AC-06 中间失败隔离、部分预览和重试 | SceneGenerationService 故障注入、partial classroom 渲染测试与 DeepSeek 两场景失败后逐项重试 | 自动 + DeepSeek 人工通过 |
| AC-07 播放、暂停、继续和导航 | playback reducer 与 Chromium E2E | 自动通过 |
| AC-08 quiz 提交和解析 | 服务端判分、MySQL integration 与 E2E | 自动通过 |
| AC-09 刷新后恢复 | MySQL 新仓储实例测试与 E2E `page.reload()` | 自动通过 |
| AC-10 无语音完成 | TextOnly、BrowserSpeech 回退测试与 E2E | 自动通过 |
| AC-11 密钥不进入客户端 | 服务端配置边界、bundle/仓库扫描与 storage 检查 | 自动 + 人工审计通过 |
| AC-12 质量命令 | `pnpm verify:full` 与 GitHub Actions | 自动通过 |

M6/M6.5 已按本机、MySQL、mock 与 DeepSeek 的 v0.3 边界完成。百炼真实生成和另一台机器部署不属于当前退出门，后续只有在双 Provider 对比或异机交付确有需要时才补充相应证据。

## 8. M7/v0.4 计划验收

M7 不能用现有 AC-01～AC-12 自动继承完成结论。实施后必须新增 AC-Q01～AC-Q11 证据，并且 M6 证据继续有效。详细范围见 [01-scope.md](01-scope.md)，开发顺序见 [09-v0.4-quality-and-interaction-plan.md](09-v0.4-quality-and-interaction-plan.md)。

截至 2026-08-27，M7.0 评价集、量表、密度协议、双视口和退出阈值已冻结；mock smoke 已通过，6 主题 DeepSeek Prompt v1 自动基线已执行并保留失败样本。当前待人工七维评分，评分完成前不宣布 M7.0 退出。

### 8.1 自动化质量门增量

计划在原有 `verify:full` 之上加入但不混淆以下测试：

| 测试层 | M7 必须覆盖 |
| --- | --- |
| Domain | Course v1/v2 判别、v1 → v2 迁移、CourseBrief 默认值/字段来源/合并优先级/冲突警告、SlideContent v2/旧 slide 联合读取、模板组合和互动数量规则 |
| Renderer | 六种模板与 card_grid、steps、comparison、table 的边界、转义、字体层级和响应式布局 |
| Slide quality | 可见字符、最长单项、代码行数、重复信号、模板预算以及 `1280×720`/`390×844` DOM 溢出断言和截图 |
| Interactive security | HTML 大小与禁用标签、CSP、sandbox、消息来源和消息 Schema |
| MySQL | `brief_json` 的 Brief + Resolution 恢复、Brief/大纲同 revision 原子保存、新旧行读取、互动内容恢复、再生成原位替换和 conflict |
| API | topic 原文保存、完整/部分/无 Prompt 字段解析、设置优先与冲突提示、outline.v2 正常调用计数、Brief 修改使大纲失效、Prompt v2 上下文、slide 模板/密度失败分类、interactive 失败分类、ready 场景再生成 |
| Playwright | 双视口 slide 布局，以及 required diagram 的生成、操作、重置、完成、刷新、fallback 和迟到事件 |
| Regression | 原 M6 创建、slide/quiz、播放、作答、删除和 mock E2E 全部保持通过 |

mock E2E 必须使用真正包含按钮、节点状态和完成事件的自包含 HTML fixture，不能用一张静态卡片伪装互动成功。恶意 fixture 至少覆盖外部 fetch、读写父页面、`eval`、子 iframe、meta refresh 和伪造 postMessage。

### 8.2 DeepSeek 互动 smoke test

M7 退出前使用固定 Provider、模型和 Prompt 版本生成至少一门 `interactionMode=required` 的 5 场景课程。验收必须核对：

- MySQL 中存在且只存在一个 interactive/diagram，保存 promptVersion、耗时、upstreamCalls 和修复标记；
- iframe 在 production Chromium 中报告 ready，核心节点/步骤可操作，reset 恢复初始状态，completed 可以解除 learner pause；
- 页面刷新后重新读取同一 HTML，不依赖生成页内存；
- 控制台没有未处理错误，iframe 没有成功发起外部网络请求；
- 若首次 HTML 不合法，记录修复或失败，不手工改数据库伪造成功。

### 8.3 课程质量验收

M7.0 先冻结主题集、七维评分说明、`slide-density.v1`、截图视口和阈值。M7.4 使用同一 DeepSeek 模型、温度、场景数量和主题，分别生成 v0.3 与 v0.4 课程，使用相同视口截图并隐藏版本后成对评分。报告至少包含：

- 事实正确性、目标匹配、结构连贯、解释/案例价值、可见内容可读性、视觉层级与版式适配、quiz 对齐；
- 互动页的教学必要性、控件可理解性、重置和完成反馈；
- 课程完成率、首次结构/密度通过率、修复次数、请求耗时、token、模板分布、硬溢出和关键事实错误；
- 每个失败样本的保留/排除规则，不能只展示成功课程。

建议初始退出阈值为目标匹配、教学组织、案例/练习价值、可见内容可读性、视觉层级与版式适配五项平均提升至少 0.5/5，事实正确性不下降，标准视口不存在硬溢出，至少 70% 的课程对更偏好 v0.4。正式阈值必须在看到 v0.4 结果前由 M7.0 冻结；这份小样本报告用于产品退出，不直接宣称统计显著或论文结论。

### 8.4 M7 证据矩阵模板

| 条件 | 预期证据 | 当前状态 |
| --- | --- | --- |
| AC-Q01 CourseBrief 解析、来源、警告与同 revision 保存恢复 | Schema + API + MySQL integration | 未实现 |
| AC-Q02 v1 → v2 兼容 | migration fixture + 旧库读取 | 未实现 |
| AC-Q03 outline.v2 同调用解析与大纲生成，场景 Prompt 使用完整上下文 | golden + 调用计数 + 生成元数据 | 未实现 |
| AC-Q04 SlideContent v2、模板、新 Block 与双视口安全渲染 | Schema + component + DOM 断言 + 截图 | 未实现 |
| AC-Q05 required diagram 数量 | domain + API | 未实现 |
| AC-Q06 HTML 安全门 | validator 恶意 fixture | 未实现 |
| AC-Q07 iframe 协议 | Playwright + network/console 记录 | 未实现 |
| AC-Q08 fallback 与失败隔离 | 故障注入 + E2E | 未实现 |
| AC-Q09 ready 场景再生成 | application + MySQL conflict | 未实现 |
| AC-Q10 成对质量提升 | 固定量表报告 | 未实现 |
| AC-Q11 M6 全量回归 | `pnpm verify:full` | 待 M7 完成时复跑 |

只有表中所有“未实现”都被真实证据替换后，才能把 [07-development-status.md](07-development-status.md) 更新为“M7 完成”。
