# 07. 当前开发状态

> 本文记录已经进入正式调用链并通过验证的能力。目标设计仍以 01～06 文档为准；本文不把后续计划描述成已实现功能。

## 1. 当前结论

项目已完成 **M1～M6 的代码实现、mock 自动验收与 DeepSeek 真实 smoke test**，达到当前“本机 + MySQL + mock + DeepSeek”的 MVP 交付范围。mock 下的大纲、场景、课堂、刷新恢复和自动清理均进入可重复 Chromium E2E；DeepSeek 已完成真实大纲、5 个场景、输出修复和失败后单场景重试。当前在无模型 Key、无模型网络的环境中可以完成：

```text
首页填写主题并选择 3～5 个场景
  → 在 MySQL 创建 draft 课程
  → 登记 activeOperation 后通过 MockAIAdapter 生成大纲
  → JSON 提取、严格 Schema、语义门与必要时一次模型修复
  → 用 operation id + expectedRevision 短事务提交 outline_ready
  → 人工编辑并由服务端复验、保存、确认
  → 按 outline 顺序逐个登记和生成 slide / quiz
  → 每场独立解析、语义校验、装配 Action 并短事务提交
  → 单场失败时保留其他结果、继续后续场景并显式重试
  → 进入课堂按 Action 自动播放、暂停、继续和重播
  → quiz 停在 awaitingLearner，服务端判分并写入 quiz_attempts
  → 重启 Next.js 后从 MySQL 恢复课程
  → 显式删除课程及其关联测验记录
  → CI 使用临时 MySQL 重跑同一套 mock 质量门
```

MySQL 现在是课程事实的唯一运行时来源。`InMemoryCourseRepository` 仍用于不依赖数据库的单元测试，但正式 `.env.local` 使用 `COURSE_REPOSITORY=mysql`，不会在数据库失败时静默切换到内存。

## 2. 已实现内容

### 数据库与仓储

- 使用 `mysql2/promise` 的服务端进程级连接池；
- `ai_teaching` 数据库中的 courses、quiz_attempts 和 schema_migrations 表；
- `001_initial_schema.sql` 与幂等迁移执行器，重复执行会跳过已登记版本；
- `CourseRepository` 的 InMemory 和 MySQL 两个实现；
- courses 采用关系型顶层字段加 JSON 聚合列，读取后重新执行完整 CourseSchema；
- save 使用短事务和 `WHERE id = ? AND revision = ?`，成功后 revision 加一；
- quiz_attempts 通过外键在删除 Course 时级联清理；
- 数据库不可用、版本冲突、存储数据损坏和配置错误具有独立错误类型。

### 页面与接口

- `/`：创建 MySQL 课程、显示重启后恢复的历史课程并显式确认删除；
- `/generation/[courseId]`：从 MySQL 读取草稿，审核大纲，串行生成场景，展示逐项进度和失败重试；
- `/classroom/[courseId]`：从 MySQL 恢复课程，固定渲染 slide/quiz/code；
- `POST /api/courses`、`GET /api/courses`、`GET/DELETE /api/courses/[courseId]`；
- `POST /api/courses/[courseId]/outline/generate`：正式大纲生成与提交；
- `PATCH /api/courses/[courseId]/outline`：人工编辑后的结构与语义复验；
- `POST /api/courses/[courseId]/scenes/[outlineId]/generate`：只生成 URL 指定的一个场景；
- `GET /api/health/database`：只返回状态、数据库名和版本，不返回主机、用户或密码；
- `GET /api/health/config`：校验当前 AI 档位，只返回 mode、provider、model 和超时；
- 所有失败响应统一为 `success:false + error(code/message/retryable/requestId)`。
- 首页创建草稿显示“保存 MySQL → 打开工作台”的分阶段进度、耗时和 requestId；成功后使用完整导航规避开发模式 RSC 长时间停在 Rendering；
- 大纲与场景生成页面显示当前阶段、耗时、结束状态和 requestId，服务端同步输出 started/running/succeeded/failed 结构化日志。

### AI 大纲与场景管线

- `MockAIAdapter` 与 `OpenAICompatibleAdapter` 共用 `AIAdapter` 接口；
- `AI_MODE=remote` 时由服务端 `AI_PROVIDER=deepseek|bailian` 选择配置档，浏览器不能覆盖 Key、Base URL、模型名或 Prompt；
- OpenAI-compatible 请求使用 `/chat/completions` 和 JSON mode，认证、限流、超时、网络与上游响应错误具有稳定分类；
- 解析只接受纯 JSON、单个 JSON 围栏或首个平衡对象，随后执行严格 Zod 和课程级语义门；
- 传输错误最多重试两次，格式/结构/语义错误最多调用一次 repair，总上游调用硬上限为 4；
- 模型不生成实体 ID，装配器补齐 outline、Scene、Block、Question、Option 和 Action ID；quiz 模型只返回 `correctOptionIndex`；
- `outlineGeneration` 保存 Provider、实际响应模型、Prompt 版本、requestId、耗时、upstreamCalls、repair 标记和可用 token usage；
- 每个 Scene 也保存独立 `GenerationMetadata`，slide 与 quiz 使用各自的版本化 Prompt；
- 大纲和每个场景均使用两个短事务包围模型调用，迟到响应必须同时匹配 operation id 和 revision；
- 场景失败只修改目标 `SceneProgress`，其他 Scene 保留；pending 场景仍可继续，failed 场景重试后按 outlineId 替换而不是重复追加；
- 进程崩溃遗留的 generating 操作只有租约到期后才能由相同 outline 恢复。

### 配置与安全边界

- `.env.example` 只提供无密码示例；真实 `.env.local` 被 Git 忽略；
- DATABASE_URL 只在服务端数据库模块读取，没有 `NEXT_PUBLIC_` 变量；
- 模型 Key、Base URL 与模型名只在服务端 Route Handler 调用链解析，没有 `NEXT_PUBLIC_` 模型配置；
- 参数化 SQL 用于所有业务值；数据库名在迁移脚本中经过标识符白名单；
- 数据库失败会返回 `DATABASE_UNAVAILABLE`，不会伪装成空课程列表；
- 固定渲染与代码块纯文本安全边界继续保留。
- 生成页离开或用户点击取消时会中止已登记的浏览器请求；迟到服务端事实通过刷新恢复；
- failed 场景只有 `retryable=true` 才显示重试，认证/配置错误明确要求修正环境；
- GitHub Actions 只使用 mock 与临时 MySQL，不读取或调用远端模型 Key。
- `pnpm dev:inspect` 开启 Next.js Node Inspector 供 IDE 断点调试；普通 `pnpm dev` 同样保留业务结构化日志和每 10 秒心跳。

### 课堂播放与学习行为

- 纯 playback reducer 覆盖 idle、playing、paused、awaitingLearner、completed；
- Action executor 顺序执行 speech、timed pause 与 learner pause，并用 sceneId、runId、actionIndex 拒绝迟到完成事件；
- TextOnlySpeechAdapter 按文本长度估算时长，是无语音环境下的默认路径；
- BrowserSpeechAdapter 仅在用户开启且 Web Speech API 可用时朗读，启动失败或不可用会回退 TextOnly；
- 手动切页、重新播放和组件卸载都会取消旧语音或计时器，暂停/继续复用当前任务而不是重复执行；
- quiz 进入页面即可作答；自动播放到 learner pause 时仍进入 awaitingLearner，所有题目成功保存后会停止当前讲解并完成本场景；
- 桌面课堂 Grid 行高只由左侧场景内容决定，右侧调度栏自动拉伸到同高，讲解正文占据剩余空间并独立滚动；窄屏布局回到普通文档流并限制讲解窗口高度；
- `POST /api/courses/[courseId]/quiz-attempts` 只接受 scene/question/option ID，服务端从 Course 查题判分；
- 作答独立写入 quiz_attempts，不增加 Course revision；语音偏好只保存在 localStorage。

## 3. 验证记录

```text
pnpm db:migrate  # 首次 applied 001；复跑 skip 001
pnpm lint
pnpm test        # 14 个文件、45 项无数据库/API 契约测试
pnpm test:db     # 1 个文件、9 项真实 MySQL 测试
pnpm build
pnpm test:e2e    # 1 项 production Chromium 完整流程
pnpm verify:full # lint + unit + MySQL + build + E2E
```

单元测试在 M3/M4 覆盖项之外，新增播放器完整状态路径、暂停/继续不重复、快速切页迟到事件保护、可暂停 TextOnly 计时、BrowserSpeech 不可用回退，以及测验服务端判分和非法选项拒绝。MySQL 集成测试新增“服务端判分后由新作答仓储实例恢复记录且 Course revision 不变”。

Playwright CLI 在 production server 上完成“创建 3 场景草稿 → mock 生成 REV.2 大纲 → 确认后依次生成 2 个 slide 和 1 个 quiz → REV.8 ready → 进入课堂检查生成内容和答案选项”的浏览器链路。页面显示 03/03 独立提交，课堂显示 `REV.8 · MOCK`，控制台错误数为 0；验证课程随后已从 MySQL 删除。

M5 继续在 production server 上验证“进入 ready 课程 → TextOnly 开始播放 → 暂停状态 → 手工切到 quiz 并确认旧 Action 取消 → 讲解完成进入 awaitingLearner → 选择答案 → 服务端保存 → 本场景 completed”。页面显示 `ACTION 2 / 2` 和“回答正确”，MySQL 查询得到 1 条 `correct=1` 作答记录且 Course 保持 `REV.9`；浏览器错误与警告均为 0。验证课程和 Playwright 临时产物在验收后清理。

M6 将上述人工步骤固化为 `e2e/mock-course-flow.spec.ts`：在 1280×720 Chromium 中创建唯一主题课程，生成 REV.8 ready 课程，验证播放/暂停/继续、手工切页取消、quiz 无需播放即可提交、服务端判分、页面刷新、首页历史和 `/api/health/config`，最后无条件删除测试课程。本地 production E2E 1/1 通过；API 错误 envelope、三档配置解析和非法请求另由 Vitest 自动覆盖。

2026-08-25 在本机 remote 档位下复跑质量门时发现 Playwright 服务会继承 `.env.local`，使标称 mock 的 E2E 误用真实 Provider。现已在 `playwright.config.ts` 强制测试服务使用 `AI_MODE=mock`、禁止复用未知配置的既有 3100 端口服务，并让 ESLint 忽略 `output/` 中的报告、trace 与截图生成物。修复后 `pnpm verify:full` 完整通过：14 个文件 45 项单元/API 契约测试、1 个文件 9 项 MySQL 集成测试、production build 和 Chromium E2E 1/1 均成功。

M6 可观测性补强回归进一步故意延迟课程创建响应，确认首页在等待期间显示 MySQL 写入阶段、耗时和 requestId，随后通过完整导航进入工作台。生产进程已用固定 requestId 核对 `course.create.started` 与 `course.create.succeeded` JSON 日志；临时验收课程均已删除。

远端 DeepSeek 场景 smoke test 暴露并修正了恢复分类：`INVALID_MODEL_OUTPUT` 表示本次输出及一次修复均未通过契约，但新请求重新采样仍可能成功，因此会保存为可重试错误。前端同时兼容修复前已保存的同码错误，并在失败场景右侧显示“重试”；修复 Prompt 明确限制 slide block 字段、callout tone 和 quiz option 的 `label` 字段。用户随后对两个失败场景执行了付费重试，最终课程达到 `5/5 ready`，证明真实 Provider 下已完成场景不会因局部失败或重试丢失。

2026-08-25 从 MySQL 对课程 `40e63cea-8afd-462c-b888-300e4ddee3d9` 进行脱敏核验：最终状态为 `ready`、`REV.16`，大纲 Provider 为 `deepseek`、模型为 `deepseek-v4-flash`、Prompt 为 `outline.v1`，耗时 14446ms、上游调用 1 次。5 个场景均保存独立元数据，类型为 4 个 slide 和 1 个 quiz，成功请求耗时依次为 7759、14219、18071、11979、11143ms；其中第 3 个 slide 与第 5 个 quiz 使用一次模型修复并记录 `upstreamCalls=2`，其余场景为 1 次调用。验收记录只保留运行元数据，不记录主题、Key、Prompt 正文或模型原文。

课堂长讲解布局使用现有 1344 字真实场景完成浏览器检查：左侧 stage、Grid 行和右侧调度栏均为 1263px，讲解窗口随剩余空间扩展到 `clientHeight=793`，实际内容 `scrollHeight=3093` 且 `overflow-y=auto`。左右栏动态同高，浏览器控制台 0 error / 0 warning。

## 4. 当前非阻塞限制与可选扩展

- 百炼兼容配置尚未用有效 Key 联调；该能力不属于当前 MVP，后续有双 Provider 对比需求时再验收；
- 超时租约可以被下一次显式生成请求接管，但尚无后台扫描器主动恢复遗留操作；
- 尚未在另一台机器复现部署；当前项目只承诺本机或受信任网络运行，异机交付按需扩展；
- BrowserSpeech 的回退与控制已自动测试，实际系统音色和听感仍需目标演示机器人工确认。

上述项目均不阻塞当前 MVP。M6 已依据 v0.3 范围完成，不再保留外部 Provider 或异机前置条件。

## 5. 已确认的质量差距

M6 证明的是结构、状态、持久化、恢复和运行闭环，不代表课程内容已达到 OpenMAIC 的表现力。当前实现的限制已经从代码与真实课程中确认：

- 创建请求只有 topic 和 3～5 场景数，没有学习者水平、明确学习目标、先修知识、时长或教学风格；
- outline.v1 只要求“概念、机制到应用”，SceneOutline 没有场景角色、常见误区、案例/练习意图或互动计划；
- slide 只有 paragraph、bullet_list、callout、code，quiz 只有 single_choice；
- 场景上下文只有课程标题计划和前一 ready 场景摘要，不能显式追踪已覆盖/待覆盖目标；
- Action 由程序装配为 speech/pause，没有页面元素动作或互动协议；
- 当前 repair 与质量门主要保证 JSON/Schema/领域结构，不评价事实正确性、教学深度和案例价值。

DeepSeek 已验收课程的 5 个场景为 4 个 slide + 1 个 quiz，适合作为 v0.3 工程基线样本，但单个样本不能证明平均课程质量。后续必须在固定主题集和同一模型配置下比较 Prompt/契约版本。

## 6. 下一步：M6.5 远端响应韧性与可观测性

M6 保持关闭，不重新打开其范围。真实 DeepSeek 调用新暴露了 HTTP 2xx 下的空体、非 JSON、异常 envelope 或空 content 会被统一标记为不可重试 `AI_UPSTREAM_ERROR` 的缺口。该问题不扩展为新产品功能，放入独立 M6.5 工程加固里程碑。

```text
M6.5.0 冻结远端故障 fixture 与诊断契约
  → M6.5.1 分层解码 OpenAI-compatible 响应
  → M6.5.2 受限重试、调用预算与安全日志
  → M6.5.3 生成页恢复进度与一致操作
  → M6.5.4 mock 故障注入、全量回归与 DeepSeek smoke
  → M7.0 固定评价集、人工量表和 Prompt v1 基线
  → M7.1 CourseBrief、schemaVersion 2、迁移和 outline.v2
  → M7.2 steps/comparison/table、slide/quiz v2 与课程记忆
  → M7.3 interactive/diagram 生成、MySQL、sandbox iframe 与 E2E
  → M7.4 ready 场景再生成、成对质量报告和 v0.4 验收
```

当前下一项可执行工作是 M6.5.0：先为正常响应、空体、非 JSON、异常 envelope、空 content、429/5xx、401/403 和 AbortError 建立脱敏、确定性测试，再修改生产分类。完整任务与退出门见 [10-m6.5-remote-response-resilience-plan.md](10-m6.5-remote-response-resilience-plan.md)。

M6.5 不修改 Prompt v1 教学策略或 Course Schema。M6.5 完成后，M7 仍按已冻结的 [09-v0.4 方案](09-v0.4-quality-and-interaction-plan.md) 原序执行，不引入 LangGraph、多智能体、多模态、RAG、媒体或第二种 widget。M7 完成后，毕业论文选题仍进入 M8。
