# 08. 部署、恢复与验收手册

> 适用范围：第 1～7 节记录已完成的 M6/M6.5 本机或受信任网络交付；第 8 节持续记录 M7～M11 的增量验收，其中 M7.1、M8、M9、M10 与 M11 当前范围已完成。当前版本没有账户与权限系统，不允许直接暴露到公网。

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
- `/`：创建一门 4～8 场景 mock 课程，完成大纲、场景、播放和测验。

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
pnpm check:export                      # 需先启动 production server；检查两门真实课程的导出结构
```

`verify:full` 要求 MySQL 已启动且 `.env.local` 有效。E2E 使用唯一主题创建测试课程，覆盖创建、大纲、导出下载与 ZIP 解包、四个场景、PPT 画布四类元素与 16:9、播放/暂停/继续、quiz、刷新恢复和配置健康检查，并在 `finally` 中删除课程。Playwright 启动的 production server 显式覆盖为 `AI_MODE=mock` 且不复用既有端口服务，因此即使 `.env.local` 当前配置为 remote，也不会由自动验收触发付费模型调用。`pnpm check:export` 默认访问 `http://localhost:3100`，也可用 `EXPORT_BASE_URL` 指向 production server；它读取两门已保存的真实 ready 课程并对 ZIP、PPTX 页数/文本、表格、原生图表和互动 HTML 执行失败即退出的结构断言。`output/playwright/` 的失败 trace/截图只用于临时排障；MHTML 仅作为 `1280×720` 固定视口的静态视觉留档，不用于证明离线文件的响应式缩放，实时缩放能力以课堂页面为准。

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

## 8. M7～M10/v0.4 验收记录与当前口径

M7～M10 不能用现有 AC-01～AC-12 自动继承完成结论。每个里程碑先通过自己的退出门，M10 再汇总 AC-Q01～AC-Q11 并宣布 v0.4 完成；M6 证据必须继续有效。详细范围见 [01-scope.md](01-scope.md)，开发顺序见 [M7～M10 开发方案](stage-plans/m7-m10-v0.4-quality-and-interaction-plan.md)。

截至 2026-08-28，M7.0 六题输入已冻结，mock smoke 和 6 主题 DeepSeek Prompt v1 自动基线均已完成并保留失败样本。28 个已保存场景已经从既有 MySQL 课程归档为 `1280×720` MHTML，没有重新调用模型。M8～M10 只承诺桌面视口；M10 通过新版 slide 的单人需求验收完成，不再安排同题配对评分。

### 8.1 M8 DeepSeek 与 MHTML 验收记录

2026-08-30 使用 `deepseek-v4-flash` 对 HTTP 缓存、TCP 拥塞控制和二分查找三个主题生成 v3 课程。三个首场 slide 均 `upstreamCalls=1`、`repaired=false`，分别保存 9、12、15 个元素，场景耗时 8,001～10,822ms；额外生成的二分查找第二场也一次通过。校准确认 DeepSeek V4 默认 high thinking 会消耗结构化输出预算，因此仅首轮 `stage=scene` 请求关闭 thinking，outline/repair 不变。

视觉事实位于 `eval/runs/m8-slide-v0.4/2026-08-30T09-23-19-191Z/`。`report.json` 保存课程 ID、schemaVersion、场景标题、元素数量/类型、生成元数据和 MHTML 哈希；`scenes/` 保存 4 份 `1280×720` MHTML。运行目录按评测约定被 Git 忽略，验收者应在 `1280×720`、100% 缩放下用 Chromium/Edge 打开 MHTML，重点检查画布内标题、主次、关系、文字裁切和代码转义。MHTML 是静态快照，窗口缩放时不重新执行课堂中的 ResizeObserver；响应式表现应在实时课堂页面检查。

### 8.2 自动化质量门增量

计划在原有 `verify:full` 之上加入但不混淆以下测试：

| 测试层 | M7～M10 必须覆盖 |
| --- | --- |
| Domain | Course v5、v4 单选答案读取升级与 v1～v3 旧行隔离、CourseBrief、单选/多选答案数组、GeneratedSlideSceneDTO、唯一 canvas Slide、四类 PPTElement 和互动数量规则 |
| Slide/Renderer | 未支持元素过滤、必要默认值、非有限坐标/非正尺寸、text 白名单净化、code 文本转义、`text/shape/line/code` 渲染、16:9 缩放和未知元素 fallback |
| Slide visual | 3 个 DeepSeek 代表主题在 `1280×720` 的逐场景 MHTML 与单人需求检查，确认新版样式满足课堂展示要求、主要内容未被裁掉；不建立 A/B 评分、PNG 档案或自动美学评分 |
| Interactive boundary | 完整 HTML、允许外部依赖的 CSP、`sandbox="allow-scripts"`、消息来源/Schema 和 fallback |
| MySQL | `brief_json` 的 Brief + Resolution 恢复、Brief/大纲同 revision 原子保存、v1 隐藏与明确拒绝、互动内容恢复、再生成原位替换和 conflict |
| API | topic 原文保存、完整/部分/无 Prompt 字段解析、设置优先与冲突提示、outline.v2.1 正常调用计数、Brief 修改使大纲失效、Prompt v2 上下文、slide 解析/规范化失败、interactive 失败分类、ready 场景再生成 |
| Playwright | `1280×720` 桌面只读 SlideCanvas 的四类元素与恢复，以及 required diagram 的操作、重置、完成、刷新和 fallback |
| Regression | 原 M6 创建、slide/quiz、播放、作答、删除和 mock E2E 全部保持通过 |

mock E2E 必须使用真正包含按钮、节点状态和完成事件的自包含 HTML fixture，不能用一张静态卡片伪装互动成功。另保留一个尝试读取父页面和一个伪造消息来源的失败 fixture，证明隔离与 fallback 即可；首版不穷举浏览器全部 API。

### 8.2.1 ready 场景修订与互动降级再生成

运行异常（包括 ResizeObserver 布局循环）后应卸载 iframe，显示静态 fallback，不继续撑高页面。点击“重新加载原脚本”只重载同一 HTML；点击“重新生成本场互动”才调用模型，期间显示等待状态、禁止重复提交，可以取消等待。

再生成成功后应展示新的互动，刷新仍能读取新版本；大纲与其他场景保持不变。生成失败应显示错误及可用的请求标识，旧场景仍保留，可以再次手动尝试。取消与最终提交可能相遇，刷新后的数据库状态为准；不能把已提交的结果当成已撤回。这里只验证恢复流程，不保证每次生成的 HTML 都没有运行或教学问题，不增加独立质量门。

任意 ready slide/interactive/quiz 的课堂调度台均应显示“修订本场”。修改意见为空时不能提交；输入最多 500 字意见后应调用 `/revise`，并只把当前旧场景作为参考。interactive 参考中不得包含 `data-interactive-runtime` 或平台 CSP。成功只替换该 outline 对应的 Scene；失败、取消和 conflict 保留原内容。quiz 必须先勾选清理确认，提交按钮才可用；成功事务必须同时替换 Scene 并删除旧 sceneId 的 QuizAttempt，其他场景作答不受影响。运行失败降级按钮应调用 `/regenerate`，请求和模型 Prompt 均不得包含旧 HTML。

Quiz 人工编辑验收：运行 `pnpm db:migrate` 后 004 已登记；ready quiz 显示“手动调整题目”。弹窗允许 1～3 题、每题 2～4 个选项，单选恰好选择一个答案，多选至少选择两个，未确认清理或存在空字段时不能保存。保存调用 PATCH `/scenes/{outlineId}/quiz` 且不调用模型；刷新后新题目仍存在。旧 sceneId 作答计数为 0。多选仅全选正确集合时判定正确，答案顺序不影响，漏选或错选均错误。

### 8.3 M9 DeepSeek 互动 smoke test

当前多样化版本以 docs/09 第6节为需求、docs/07 为最新实测记录。先运行 `pnpm db:migrate` 应用003数量约束修复，再 build/start。需要联网加载的脚本不承诺完全离线；MHTML只作视觉归档。人工试用重点为模拟参数改变结果、游戏操作影响资源/结局、代码可编辑执行及错误/正确测试反馈，以及各类重置。下面保留的是较早 diagram-only 结果，不代表当前的禁止网络策略。


2026-08-31 已完成。当前 Course v4、outline.v2.2、scene-diagram.v1.3，最终事务状态课程 `a3dfc090-4bc0-41c4-8da3-4e0b96af7225` 为 ready，4/4 场景，整课 5 次上游调用、0 repair。互动页 13,856ms，实际点击全部节点后可完成，宿主重置与刷新恢复通过。校准中的 SVG 越界、额外 ACK 和遗漏事件绑定保留为失败事实，不计作运行成功。报告和 16 份 MHTML 位于 `eval/runs/m9-interactive-v0.4/2026-08-31T01-41-38-550Z/`。

最终 `pnpm verify:full`：101 单元、13 MySQL、production build、Chromium E2E 1/1 全部通过。浏览器故障探针确认父 DOM/存储隔离、CSP 阻断外部 fetch、脚本异常显示 fallback；自动 E2E 另覆盖伪造来源与非法协议。正常样例与主动故障注入的预期错误分开记录。

M9 退出前使用固定 Provider、模型和 Prompt 版本生成至少一门 `interactionMode=required` 的 4～8 场景课程。验收必须核对：

- MySQL 中存在符合分档数量的 interactive（diagram/simulation/game/code）（4 场景 1 个；5～6 场景 1～2 个；7～8 场景 1～3 个），保存 promptVersion、耗时、upstreamCalls 和修复标记；
- iframe 在 production Chromium 中报告 ready，核心节点/步骤可操作，reset 恢复初始状态，completed 可以解除 learner pause；
- 页面刷新后重新读取同一 HTML，不依赖生成页内存；
- 控制台没有未处理错误，iframe 不可读取父页面 DOM/存储，CDN 失败可重载；允许外部网络请求；
- 若首次 HTML 不合法，记录修复或失败，不手工改数据库伪造成功。

### 8.4 课程质量验收

M7.0 的六题输入、课程内容、失败样本和生成元数据保持不变，作为 v0.3 历史基线；旧版 MHTML 不改写。M10 的当前验收重点是新版 slide 是否符合已确认的课堂页面需求，采用项目负责人单人检查，不要求同题 v0.3/v0.4 配对、人工量表或总体偏好统计。

验收只确认可直接观察的产品要求：固定桌面视口下画布比例正常、标题和正文层次清楚、布局关系可读、主要内容未被裁切。事实正确性、解释与案例价值、教学效果和统计意义上的版本优越性不在本轮结论内。课程生成状态、耗时、token 和失败场景仍可作为机器事实留档，但不转化为人工质量分数。

`eval:pair`、`course-quality-rubric.v2.json` 和 `scores.template.json` 属于已实现的可选历史评测工具，不是当前 M10 退出条件；如后续不需要论文对照实验，可在清理其脚本引用后从主线移除。MHTML 的响应式缩放也不属于离线归档验收，窗口缩放应在实时课堂页面中检查。

### 8.5 M7～M10 证据矩阵模板

| 条件 | 里程碑 | 预期证据 | 当前状态 |
| --- | --- | --- | --- |
| AC-Q01 CourseBrief 解析、来源、警告与同 revision 保存恢复 | M7 | Schema + API + MySQL integration | 已通过 |
| AC-Q02 v1 隔离与明确错误 | M7 | repository integration + 旧行读取 | 已通过 |
| AC-Q03 outline.v2.1 同调用解析与大纲生成；后续场景 Prompt 使用完整上下文 | M7/M8 | golden + 调用计数 + 生成元数据 | outline.v2.1 已通过；scene v2 随 M8 接入 |
| AC-Q04 OpenMAIC 式 Slide/PPTElement 生成、规范化、保存恢复与桌面只读渲染 | M8 | Schema + normalize + component + 真实模型 MHTML + 桌面 E2E | 已实现 |
| AC-Q05 required diagram 数量 | M9 | domain + API | 已通过 |
| AC-Q06 HTML 安全门 | M9 | validator 恶意 fixture | 已通过 |
| AC-Q07 iframe 协议 | M9 | Playwright + network/console 记录 | 已通过 |
| AC-Q08 fallback 与失败隔离 | M9 | 故障注入 + E2E | 已通过 |
| AC-Q09 ready 场景再生成 | M10 | application + MySQL conflict + production browser smoke | 已通过 |
| AC-Q10 新版 slide 样式需求验收 | M10 | 单人需求检查 + `1280×720` 固定视口视觉证据 | 已通过 |
| AC-Q11 M6 全量回归 | M7～M10 | `pnpm verify:full` | 每个里程碑退出时复跑 |

M7、M8、M9 和 M10 可以在各自相关行具备证据后单独更新为完成；当前表中 M10 的新版 slide 需求验收已经通过，v0.4 当前范围可以标记完成。M7.0 旧基线继续作为历史留档，配对脚本和人工量表不属于运行质量门。M11 已作为独立扩展完成，退出证据见下节；M12.0～M12.3 工程主链已实现，真实隔离副本案例和浏览器证据见 8.7，教学内容与互动语义仍需人工判断。专业幻灯片编辑器已后移为 MX，不在当前验收范围内。

### 8.6 M11 资源包导出验收

M11 于 2026-09-07 完成。课堂页导出是纯只读操作：`ready`/`partial_failed` 课程生成一个 ZIP，根目录包含一个课程 PPTX，`interactive/` 下保存按原始 `Scene.order` 命名的互动 HTML，quiz 不进入导出物。PPTX 原生直线支持斜线；`curve` 二次曲线按端点直线近似，并在完成提示中计入降级，不能把斜线误报为降级。后续收尾已补充元素级默认字体、文本透明度、代码长文本收缩、下载对象 URL 延迟释放、状态播报语义和移动端提示布局；Windows 保留设备名不作为本次低概率场景门禁。

验收命令与结果：

- `pnpm test`：26 个文件、164 项测试通过，包含曲线/斜线降级统计、字体/透明度/长代码文本回归；
- `pnpm test:e2e`：1/1 通过，mock 课程真实点击导出、读取下载 ZIP、核对 1 个 PPTX、1 个互动 HTML 和完成提示；
- `pnpm check:export`：两门真实 ready 课程通过 ZIP 结构、PPTX 页数/文本、表格、原生 `barChart` 和互动 HTML 检查；
- AC-E02：PowerPoint/WPS 人工打开核对已由用户确认通过，样例留存于 `output/export-check/`。

这些证据证明的是导出结构、内容进入文件和当前样例可读，不等于所有未来生成课程都没有字体替换、布局或内容质量问题；互动 HTML 仍不承诺离线运行。

### 8.7 M12.2/M12.3 对话式修订真实验收（2026-09-08）

使用本地 production server 和已配置的真实 DeepSeek，在新 UUID 的隔离课程副本上执行，不改动正式课程。复现脚本为 `eval/scripts/m12-3-deepseek-acceptance.mjs`。

- 8 页副本 `9fb86c2f-68cc-49f0-9da7-e4b92efcd4d0`：只读查询/搜索保持 REV.0；调序 REV.0→1；明确 `str_replace` 补丁 REV.1→2；slide 重生成 REV.2→4；interactive 重生成 REV.4→6；quiz 先 `waiting_confirmation`，确认后 REV.6→8 并替换 sceneId。
- 6 页副本 `f0776b0f-1a19-4519-a75f-4c589f230d57`：新增页第一次因模型遗漏 outline 字段被工具拒绝，第二次补齐后成功插入第 7 页，REV.0→2；删除第 7 页只走到确认并取消，课程保持 REV.2。8 页副本新增请求正确报告容量上限且不写入。
- 每条记录保存 SSE 事件、实际工具参数/结果摘要、前后页面列表与 revision；`eval/runs/m12-3-real-deepseek-*` 保存调用证据，最终课程页面归档为 `eval/runs/m12-3-final-8p/`（8 份 MHTML）和 `eval/runs/m12-3-final-7p-add/`（7 份 MHTML）。
- 浏览器检查覆盖侧栏会话新建/切换、最近 run 指标、思考/工具卡默认收起与展开。消息容器实测 `overflow-y=auto`、`scrollHeight > clientHeight`，并能将 scrollTop 从底部回到 0；截图位于 `output/playwright/m12-3-*.png`。

本节证据证明的是 Agent 工具选择、SSE 生命周期、确认语义、revision/scene 定位、MySQL 持久化和当前样例渲染可读；不把模型正文、Schema 通过或“已完成”文案当作事实正确性、教学质量或 interactive 运行语义证明。推荐的多课程扩展样本和人工内容判断仍按 M12 方案执行，不设固定成功率门禁。
