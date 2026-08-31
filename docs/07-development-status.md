# 07. 当前开发状态

> 本文记录已经进入正式调用链并通过验证的能力。目标设计仍以 01～06 文档为准；本文不把后续计划描述成已实现功能。

## 1. 当前结论

项目已完成 **M1～M9**，包括可选互动的生成、保存、隔离运行与 fallback；多样化增量已完成本轮实现与验证，最新状态见下节。当前默认 mock 路径不需要模型 Key 和模型网络，正式课程仍以本机 MySQL 为唯一来源：

```text
首页填写主题、选择 4～8 个场景（默认 5 个）并可选展开高级要求
  → 在 MySQL 创建带 provisional CourseBrief 的 v4 draft 课程
  → 大纲页选择 off/required 互动模式；outline.v2.3 同一次调用检测明确要求并生成带角色的大纲
  → 服务端按设置 > 描述 > 默认值复算 Brief，再执行 Schema、语义门与必要时一次模型修复
  → 用 operation id + expectedRevision 短事务提交 outline_ready
  → 人工编辑并由服务端复验、保存、确认
  → 按 outline 顺序逐个登记和生成 slide / quiz / interactive
  → 每场独立解析、语义校验、装配 Action 并短事务提交
  → 单场失败时保留其他结果、继续后续场景并显式重试
  → 至少一个场景成功后可进入部分课堂预览；全部完成才标记 ready
  → 课堂按 Action 自动播放、暂停、继续和重播
  → quiz 停在 awaitingLearner，服务端判分并写入 quiz_attempts
  → 重启 Next.js 后从 MySQL 恢复课程
  → 显式删除课程及其关联测验记录
  → CI 使用临时 MySQL 重跑同一套 mock 质量门
```

MySQL 现在是课程事实的唯一运行时来源。`InMemoryCourseRepository` 仍用于不依赖数据库的单元测试，但正式 `.env.local` 使用 `COURSE_REPOSITORY=mysql`，不会在数据库失败时静默切换到内存。

## 2. 已实现内容

### M9 多样化增量（2026-08-31，已完成本轮验证）

正式路径已扩展为 diagram/simulation/game/code。分类选择 Prompt，不限制具体玩法；大纲可以编辑 widgetType、设计意图与 code 语言（Python/JavaScript）。outline.v2.3，互动 Prompt 为 scene-<type>.v2.1。模型直接输出 HTML，服务端从 scene-meta 提取讲解/fallback 后装配；避免整页 JSON 转义失败。diagram/simulation 16,000 tokens，game/code 20,000，注入后 256 KiB；没有增加 repair 轮次、玩法门禁或自动视觉审核。

允许外部资源/连接，iframe 仍只有 allow-scripts，无 allow-same-origin。CSP 禁止对象/子 frame/表单等；网络开放意味着不能承诺防外传，页面显示敏感数据提醒。代码使用可终止 Worker，Python 加载固定 Pyodide，初始化60秒、默认执行5秒，错误答案与代码异常留在页内。平台30秒初始化超时或未处理错误时卸载 iframe 并显示 fallback，可重载同一HTML或跳过。无关库消息忽略，课堂协议仍检查来源/结构。

新增迁移003修复数据库仍限制3～5场景的遗漏：存量约束扩为3～8以保留历史行，新课程领域约束4～8。迁移已应用，无数据删除。v4已保存HTML不回写，v1～v3仍不兼容。

校准目录为 `eval/runs/m9-diversity-v0.4/2026-08-31T02-40-51.257Z/`。两门6场景课程覆盖四类型，已保存12/12；原JSON包装导致的模拟/游戏解析失败、一次description字段别名失败保留。改为原始HTML后模拟26,578ms、游戏37,977ms均一次调用0 repair。新Python clamp课程 `c61b1c84-370a-402f-8cce-552a12f87301` 四场景和大纲全部一次成功，code 约27秒。较早的工具路由code存在CDN编辑器高度覆盖按钮问题，未手工改写该页；新版Prompt补充编辑器尺寸与工具栏规则。

最终 `pnpm verify:full` 全部通过：109单元、15 MySQL、production build、Chromium E2E 1/1。既有E2E增加JS死循环终止和终止后再次执行，不增加独立质量门。浏览器探针验证JS/Python真实输出、停止、父DOM读取SecurityError与内存存储兼容。

真实操作：simulation 在0%/100%失败率下分别20/20与0/20成功，完成/重置通过；game 正确顺序消耗预算10→3并完成，重置恢复；clamp code 的错误实现显示断言失败且宿主不降级，正确实现7/7测试通过并完成，重置恢复初始代码，1280×720下按钮无遮挡。最终diagram课程 `d67c6d7f-6dd5-4381-adbb-a4972f6b825a` 的第2场支持天气/数学两条路径，比较后完成，重置和刷新恢复通过；该课大纲与4场景也均一次调用、0 repair。

四门课程共20/20场景保存、20份MHTML，完整课程、生成历史与runtimeChecks收束到同目录report.json。保留两份旧v2.0运行失败页：工具路由code的编辑器覆盖按钮、数据救援diagram的入口漏绑/弹窗/SVG越界，未手工修改。game 样例虽能完成，仍有无效操作推进进度、顶部磁盘状态未更新的小问题，已列入报告，留给人工评估，不称为无缺陷或稳定成功率。MHTML只作静态对照，脚本能力请在课堂验收。

### M9 diagram 基础版历史（已被上述范围扩展取代）

课程范围已改为 4～8 场景、默认 5。大纲页由用户选择 off/required，默认关闭，模型不能自动开启；required 在 4/5～6/7～8 场景下分别允许 1/1～2/1～3 个 interactive，至少 2 个 slide 和 1 个 quiz，首场 slide、互动不相邻。当前 Course v4 不兼容 v1～v3，旧行不删除、不迁移，只隐藏并明确拒绝。

`outline.v2.2 → scene-diagram.v1.3 → HTML 后处理 → Scene JSON/MySQL → InteractiveRenderer` 已进入正式链。Prompt 裁剪自 OpenMAIC diagram-content，版权与路径在 THIRD_PARTY_NOTICES.md。首版收敛为点击节点看详情、完成探索和重置；不引入编辑器、导出、第二种 widget 或复杂自动修复。HTML 预算 12,000 tokens、注入后不超过 100 KiB；iframe 只有 allow-scripts，CSP 禁止外部网络，宿主检查 source 和严格 v1 消息。5 秒未 ready、脚本错误、非法消息显示纯文本 fallback，可以跳过，其他场景不受影响。

101 项单元测试（18 文件）及 13 项 MySQL 集成测试覆盖新契约与持久化；production build 和 Chromium E2E 1/1 已通过。E2E 包含互动操作、重置、完成、伪造来源忽略、非法消息降级、quiz 和刷新恢复。真实浏览器探针确认父 DOM 与 localStorage 被 SecurityError 阻止，外部 fetch 被 CSP 阻止；注入脚本错误进入 STATIC FALLBACK。

真实 DeepSeek 校准与逐场景 MHTML 收束在 `eval/runs/m9-interactive-v0.4/2026-08-31T01-41-38-550Z/`，不改动 M7.0 冻结六题。初版 HTML 检查误伤 SVG 命名空间/普通 function 已修正；repair 提示词补齐 interactive 分支。后续样例的 SVG 越界、额外 RESET_ACK 和漏绑下一步事件均按运行失败保留，再通过 Prompt 和最小交互逻辑收敛，不手工改数据库伪造通过。生成成功率与实际互动可用性分开记录，不据此小样本宣称稳定成功率。

最终 `scene-diagram.v1.3` 样例为“事务状态转换图：开始、提交与回滚”，courseId=`a3dfc090-4bc0-41c4-8da3-4e0b96af7225`，Course v4/revision 10/ready。大纲和四个场景全部一次调用通过、0 repair；互动 13,856ms。真实 Chromium 验证四个节点、完成事件、播放器完成、宿主重置和刷新恢复；1280×720 课堂下 iframe 为 821×387，文档同尺寸且无滚动溢出。最终 `pnpm verify:full` 通过 101 项单元测试、13 项 MySQL 集成测试、production build、Chromium E2E 1/1。当时 diagram 基础版退出验收完成；生成内容的教学与视觉质量仍需人工评价，不承诺所有新 HTML 无逻辑或版式错误。

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
- `/classroom/[courseId]`：从 MySQL 恢复课程；至少一个成功场景即可部分预览，整课 ready 时正式播放；固定渲染 slide/quiz/code；
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
- 固定渲染与代码块纯文本安全边界继续保留；HTML/JSX/TSX 仅允许位于 `code.code` 并由 React 转义，普通文本中的标签和外链仍被拒绝。
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
pnpm test        # 15 个文件、64 项无数据库/API 契约测试
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

- 创建请求只有 topic 和 3～5 场景数；即使用户把受众、难度和学习结果写进 topic，当前系统也只把它当作一段不透明文本，没有逐字段归一、默认补全、来源记录或冲突处理，后续调用无法证明使用的是同一份教学要求；
- outline.v1 只要求“概念、机制到应用”，SceneOutline 没有场景角色、常见误区、案例/练习意图或互动计划；
- slide 只有 paragraph、bullet_list、callout、code，quiz 只有 single_choice；
- scene-slide.v1 主要约束 JSON 字段和宽松长度上限，paragraph 最多 500 字符、列表单项最多 180 字符、callout 最多 400 字符，没有“屏幕摘要与讲解稿分工”或整页密度预算；
- SlideRenderer 将全部 Block 放入单列文档流，正文继续使用 21～30px 的展示型衬线字体；长段落因此获得接近标题的视觉重量，结构合法但容易呈现为纵向讲义；
- 当前 JSON 没有 card/process/comparison 等内容关系，也没有可持久化的绝对坐标画布；即使只修改 Prompt，Renderer 也无法稳定生成类似幻灯片的并列、流程或对比布局；
- 场景上下文只有课程标题计划和前一 ready 场景摘要，不能显式追踪已覆盖/待覆盖目标；
- Action 由程序装配为 speech/pause，没有页面元素动作或互动协议；
- 当前 repair 与质量门主要保证 JSON/Schema/领域结构，不评价事实正确性、教学深度和案例价值。

DeepSeek 已验收课程的 5 个场景为 4 个 slide + 1 个 quiz，适合作为 v0.3 工程基线样本，但单个样本不能证明平均课程质量。后续必须在固定主题集和同一模型配置下比较 Prompt/契约版本。

## 6. M6.5 远端响应韧性与可观测性验收结果

M6.5 已完成。`OpenAICompatibleAdapter` 现在分层读取 HTTP 2xx 响应，区分空体、非 JSON、异常 envelope 和空 content；outline/scene pipeline 作为唯一重试决策者，在单请求 4 次硬上限内执行最多 2 次指数退避重试。Abort 不会在已取消请求内继续调用，但保留用户之后手动恢复的语义。

M6.5 主验收时 62 个单元测试、9 个 MySQL 集成测试、production build 和 1 条 Chromium 完整课程 E2E 已通过。真实 DeepSeek `deepseek-v4-flash` smoke 生成 3 场景课程：outline 使用 1 次上游调用，三个 scene 分别使用 2、4、2 次。第 2 场 repair 在第 2、3 次调用收到 `empty_content + finish_reason=length`，日志记录 `ai.upstream.retrying`，第 4 次恢复并完成 3/3 ready。临时课程已删除。

2026-08-26 缺陷回归确认课程 `6648e038-c9df-4faa-b77f-f49bfc75f4d0` 的第 4 场连续失败并非远端 envelope 故障，而是 React 教学内容中的 JSX 被全对象 HTML 正则误判。校验现已只检查会作为普通文本展示的字段，排除始终被转义的 `code.code`；Prompt 与 repair Prompt 同步声明只读源码边界。同时课堂门禁从“Course.status 必须 ready”调整为“至少存在一个已保存 Scene”，partial preview 显示完成数、原始场景序号和返回生成页入口。修复后 `pnpm verify:full` 通过：15 个文件、64 项单元测试，1 个文件、9 项 MySQL 集成测试，production build 与 Chromium E2E 1/1 均成功。

## 7. 已完成：M7.0 质量基线与场景归档

M7.0 相关内容已统一收束到 `eval/`：`config/course-quality.v1.json` 固定概念解释、机制流程和编程实践三类共 6 个公开主题，`README.md` 是唯一操作与验收说明，`scripts/` 保存输入校验、正式采集和 MHTML 迁移工具，`runs/` 保存正式结果。六题输入已于 `2026-08-27T13:24:42.566Z` 冻结。

正式采集前，`pnpm eval:baseline` 会检查评价集已冻结，且服务明确运行在 `remote + deepseek`。业务层不额外手动重试，生产管线内部受限重试和一次 repair 保持不变，失败样本不删除。mock smoke 验证真实课堂逐场景切换和 Chromium MHTML 归档，成功后自动删除临时课程与文件。

正式基线运行 ID 为 `2026-08-27T13-36-18-569Z`：4/6 课程为 `ready`，2/6 为 `partial_failed`，保存 28/30 个场景；共记录 50 次上游调用、31711 输入 token 和 62567 输出 token。两个第 5 场景在修复后仍不符合契约，以 `INVALID_MODEL_OUTPUT` 保留。六门课程均从 MySQL 重新读取并核对 ID、revision 和场景清单，再归档为 28 份 `1280×720` MHTML；没有调用创建、大纲生成或场景生成接口。

实施中还发现并修复了一个原有契约缺陷：用户 topic 允许 500 字符，而草稿 title 最多 120 字符，原实现直接复制会让长主题在创建阶段失败。现在保留完整 topic，只为草稿 title 派生 120 字符内摘要，并补充回归测试。本次 M7.0 证据重做后的完整回归为 16 个文件、68 项单元测试、9 项 MySQL 集成测试、production build 和 Chromium E2E 1/1 通过。

2026-08-28 需求澄清后，提交 `85be4b9f` 遗留的 `slide-density.v1.json`、44 张 PNG、DOM/密度报告、`scores.json` 和独立汇总脚本被删除或收束。`report.json` 继续保存原课程、narration、quiz、生成耗时、调用、token、repair 和错误；`summary.md` 只做事实索引，`scenes/` 保存逐场景 MHTML。人工七维评分延后到 M10 的 v0.3/v0.4 配对验收。M8～M10 只承诺 `1280×720` 及更大桌面视口。

M7.0 没有修改 Prompt v1 教学策略、Course Schema、Renderer 或 CSS。M7.1 已在不改写这些基线产物的前提下升级正式运行链；下一步依次为 M8 PPT 式只读幻灯片画布、M9 diagram 互动和 M10 单场景再生成与 v0.4 配对验收。M11 编辑器和 M12 导出均为可选项。完整边界见 [09-v0.4 方案](09-v0.4-quality-and-interaction-plan.md)。

## 8. 已实现：M7.1 CourseBrief、Course v2 与 outline.v2.1

新建课程统一写入 `schemaVersion: 2` 和非空 `brief_json`。首页保留 topic 为唯一必填输入，并增加可折叠高级设置；字段缺失由原始描述或默认值补齐，显式空数组仍表示用户明确选择“无”。`interactionMode` 在当前 Schema 中固定为 `off`，M7.1 不产生 interactive 场景。

`outline.v2.1` 在一次正常模型调用中返回 `detectedBrief`、有限 warning、courseTitle 和带 `role/misconceptions/assessmentFocus` 的 outlines。模型不再重复回传 resolved Brief；服务端按 `explicit_setting > prompt > default` 独占计算最终值。成功时 Brief、来源、警告和大纲在同一个 expectedRevision 提交。大纲页展示每字段采用值和来源；场景生成前修改 Brief 会把变化字段提升为显式设置，清空旧大纲、进度和生成元数据。

本阶段不实现旧课程迁移。已有 v1 行原样留在 MySQL，列表只查询 v2；按 v1 ID 访问返回 `LEGACY_COURSE_UNSUPPORTED`，按未来版本访问返回 `FUTURE_COURSE_SCHEMA_VERSION`。这样不需要清库，也不会把当前默认值错误套到历史课程。M7.0 的 `report.json`、`summary.md` 和 MHTML 未被修改。

最终自动证据为：`002_course_brief.sql` 成功应用；17 个文件、75 项单元测试通过；1 个文件、10 项 MySQL 集成测试通过；ESLint、production build 和 Chromium E2E 1/1 通过。单元测试确认同一主题采用默认 Brief 与显式受众/目标时会形成不同教学计划；E2E 覆盖高级设置、Course v2 创建、outline.v2、逐场景生成、课堂播放、测验、刷新恢复和自动清理。M7.1 完整退出门已经关闭。

2026-08-29 首次真实运行 `outline.v2` 时发现管线仍沿用 M1～M4 为 `outline.v1` 设置的 2,000 输出 token 上限。5 场景请求连续三次以 `empty_content + finish_reason=length` 结束。现已将 `outline.v2` 单次输出预算调整为 6,000，并增加预算回归测试。随后使用 `deepseek-v4-flash` 重新执行 5 场景大纲 smoke：请求 `m71-outline-token-budget-smoke-20260829` 在 41,564ms 内成功保存为 `outline_ready`，包含 5 项大纲；共 2 次上游调用、一次结构修复、2,223 输入 token 和 5,699 输出 token，全程未再出现长度截断。临时课程验收后删除，不生成场景。

同日继续补齐大纲失败可追溯性：成功上游调用、首次校验失败和 repair 失败均有独立结构化事件，最终失败日志不再只有 `errorName`；API、课程 `lastError.details` 和前端错误卡会共同显示 requestId、上游调用次数、`json/schema/semantic` 阶段及最多 5 条脱敏问题。刷新失败课程后诊断仍保留，后续成功会按既有规则清空 `lastError`，历史事实以终端结构化日志为准。日志和数据库仍不记录 Prompt、模型返回原文、cause、Key 或连接信息。

2026-08-30 按“一次成功优先”把 Prompt/DTO 修订为 `outline.v2.1`：删除模型回传的冗余 resolvedBrief 和逐字一致门，补齐 JSON 骨架、role/CourseBrief 枚举与 optional 规则；服务端丢弃无害额外字段、把 optional `null` 归一为空缺，并移除会误伤 JSON/Prompt 正常课程标题的关键词门。第一轮 6 主题、6,000 tokens、90 秒测试得到 5/6 最终成功、4/6 首次上游调用成功、0 repair；唯一失败及一次恢复都源于 `empty_content + finish_reason=length`，没有 Schema/语义失败。随后调整为 8,000 tokens 与 120 秒，并用相同 6 个冻结公开主题复测：6/6 均在第一次上游调用通过，0 repair、0 失败、每门均保存 5 项大纲；总计 5,462 输入 token、24,310 输出 token，单门耗时 19,843～39,173ms。最终版本标签 smoke `outline-v21-final-smoke-20260830` 记录 `promptVersion=outline.v2.1`，28,241ms 内一次成功、0 repair、849 输入 token、3,903 输出 token。全部临时课程验收后删除，未生成场景。本轮最终 `pnpm verify:full` 通过：17 个文件、80 项单元测试，10 项 MySQL 集成测试，production build 和 Chromium E2E 1/1。

M8 已完成 OpenMAIC 幻灯片纵向链的范围裁剪。Course 当前版本升级为 v3，旧 v1/v2 行不迁移、不删除，只在列表隐藏并按 ID 明确拒绝；新 slide 只允许 `content.canvas`，旧 block 联合和 Renderer 已删除。`scene-slide.v2` 直接返回背景、带坐标的 `text/shape/line/code`、narration 与 summary；服务端过滤坏元素、收口坐标、补默认值、净化富文本、分配元素/代码行 id 并装配 `1000 × 562.5` Slide。课堂使用只读 SlideCanvas 等比缩放，PPT 标题保留在画布内，外层只显示细场景元信息。

真实 DeepSeek 校准先复现了 `deepseek-v4-flash` 默认 high thinking 把 8,000/12,000 token 消耗在隐藏推理、最终 content 为空或截断的问题。适配器现只对首轮 `scene` 关闭 thinking，大纲与 repair 保持默认推理。调整后 HTTP 缓存、TCP 拥塞控制、二分查找三个主题首场均一次通过、0 repair，耗时 8,001～10,822ms，输出 1,421～2,088 tokens，生成 9～15 个元素；额外二分查找第二场也一次通过，仅一条 width 超限的 line 被局部丢弃。3 门课程的 4 个已保存场景已归档为 MHTML，运行目录为 `eval/runs/m8-slide-v0.4/2026-08-30T09-23-19-191Z/`，没有 PNG 或自动视觉评分。

M8 最终 `pnpm verify:full` 已通过：17 个文件、85 项单元测试，11 项 MySQL 集成测试，production build 和 Chromium E2E 1/1。OpenMAIC 固定提交与 MIT 许可已记录在根目录 `THIRD_PARTY_NOTICES.md`。下一步是 M9：独立裁剪 diagram Prompt、HTML 后处理和 iframe Renderer，形成一个自包含 diagram 闭环，不引入 LangGraph、多智能体、多模态、RAG、媒体或第二种 widget。
