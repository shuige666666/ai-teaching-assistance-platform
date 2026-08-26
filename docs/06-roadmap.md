# 06. 复刻实施路线图

> 文档状态：v0.4 设计基线
> 适用范围：`ai-teaching-assistance-platform` 工程基线与课程质量增强
> 总目标：任何时候都保留一个可运行、可演示、可回退到 mock 的系统。

## 1. 实施结论

复刻不按 OpenMAIC 的目录逐项照搬，而按纵向闭环推进：**固定课程可浏览 → MySQL 可恢复 → 真实大纲 → 真实场景 → 播放与测验 → 完整验收**。数据库现在是基础能力，因此必须在真实模型接入前完成，不能等课程已经生成后再补持久化。

M1 是第一个可运行原型，M2～M6 共同组成已经完成的 v0.3 MVP。M7 不直接做论文创新，而是把当前工程基线提升为“课程要求更明确、静态内容更丰富、至少一种互动场景可安全运行、质量改进有证据”的 v0.4 产品基线。M8 才选择一个可度量研究问题。

**当前进度：M1～M6 已按“本机 + MySQL + mock + DeepSeek”范围完成；M7 方案已冻结但尚未进入代码。下一步先执行 M7.0 质量基线，再依次实现 CourseBrief/Prompt v2、丰富静态内容、diagram 互动闭环和单场景再生成。** 已实现能力与验证证据持续记录在 [07-development-status.md](07-development-status.md)。

## 2. 统一完成定义

以下定义适用于 M1～M7 的实现任务；M0 只执行文档链接、术语和追踪一致性检查。

1. 代码已经进入正式调用链，不是孤立示例；
2. 正常路径能在 `AI_MODE=mock` 下复现；
3. 输入、模型 DTO、Course 和 API 响应具有 Zod Schema；
4. 数据变更通过 CourseRepository，页面不直接写 SQL 或伪造状态；
5. 数据库结构变化包含可重复执行的版本化迁移；
6. 至少有与风险相称的自动化测试；
7. `pnpm lint`、`pnpm test`、`pnpm build` 全部通过；
8. 文档、`.env.example` 和代码一致，不记录 Key、数据库密码、完整 Prompt 或原始响应。
9. 新增 Scene/Block 同时具有 Schema、装配、Renderer/Executor、fixture、迁移和测试；
10. 质量结论说明数据集、模型、Prompt 版本、量表和成本，不能用单个示例代替。

每个里程碑保存验收记录，包含提交版本、运行命令、数据库迁移版本、通过场景、故障注入、遗留问题和演示截图。

## 3. 里程碑总览

| 里程碑 | 可演示结果 | 主要替换对象 | 建议投入 |
| --- | --- | --- | --- |
| M0 设计基线（已完成） | 六份设计文档形成统一方案 | 默认脚手架说明 | 1～2 天 |
| M1 固定数据闭环（已完成） | 从首页进入课堂并浏览含代码块的固定课程 | 空白脚手架 | 4～6 天 |
| M2 MySQL 持久化（已完成） | 重启应用后课程仍可查询和删除 | 内存仓储 | 4～6 天 |
| M3 DeepSeek 真实大纲（已完成） | DeepSeek 生成并保存可审核大纲 | 固定大纲 | 4～6 天 |
| M4 DeepSeek 真实场景（已完成） | 逐场景生成、事务保存并隔离失败 | 固定场景 | 5～7 天 |
| M5 课堂运行时（已完成） | 自动播放、单选测验和可选浏览器语音 | 手工翻页 | 4～6 天 |
| M6 本机验收交付（已完成） | mock 自动回归、生产构建与 DeepSeek 实测 | 开发态系统 | 5～7 天 |
| M7 课程质量与互动能力（计划） | Prompt v2、丰富内容、一个 diagram 互动页和成对质量报告 | v0.3 通用静态课程 | 分四个可独立验收的小阶段 |
| M8 毕业论文延展 | 基于 M7 数据完成一个可度量研究问题 | 无 | 视选题而定 |

建议投入是专注开发日。延期时先减少视觉装饰和扩展能力，不压缩 Schema、事务、错误恢复和测试。

## 4. M0：设计基线

### 目标与交付

固化范围、需求、架构、领域模型、生成管线和实施顺序。v0.3 已确认：单用户、功能复刻优先、静态代码块进入 MVP、DeepSeek 为唯一验收远端 Provider、MySQL 唯一持久化、语音非必需；百炼和异机部署均为可选扩展。

### 退出门

六份文档中的路由、API、状态、Provider、MySQL 责任和 M1～M6 编号一致；目标设计与当前已实现能力明确分开。

## 5. M1：固定数据纵向闭环

> 状态：已完成。fixture、内存仓储、三个页面、固定渲染器与测试均已进入正式调用链。

### 目标

不访问模型和数据库，先证明正式领域数据可以贯穿页面、固定渲染器和课堂。演示路径为：填写主题 → 创建内存课程 → 展示固定大纲 → 装配固定场景 → 进入课堂 → 手工切换场景。

### 主要任务

建立 Course、SceneOutline、Scene、Action、GenerationMetadata、revision 的 TypeScript 类型与 Zod Schema，实现 CourseRepository 接口和仅用于开发测试的 InMemoryCourseRepository。完成 `/`、`/generation/[courseId]`、`/classroom/[courseId]` 三个页面，以及 slide/quiz 渲染器。

slide fixture 覆盖段落、列表、提示块和静态 CodeBlock。CodeBlockRenderer 只转义显示与语法高亮，不执行代码、不使用模型 HTML。fixture 必须符合正式契约，页面不能再硬编码另一份数据结构。

### 最小测试

- Schema 拒绝未知 scene/block 类型、重复 ID 和非法状态；
- reducer 完成 `draft → outlining → outline_ready → generating → ready`；
- CodeBlockRenderer 对 `<script>` 等内容只显示文本；
- slide/quiz 判别联合选择正确渲染器；
- 浏览器冒烟测试从首页走到课堂。

### 退出门

断网、无 Key、无 MySQL 时可以演示 fixture 课程；控制台无未处理异常。刷新后内存数据丢失在 M1 可接受，但必须显示“课程不存在”，不能白屏。

### 完成证据

- `pnpm lint`、`pnpm test`、`pnpm build` 已通过；
- 单元测试覆盖 Schema、状态路径、revision conflict、slide/quiz 分派和代码块转义；
- Playwright CLI 已从首页创建课程、装配场景、进入课堂、切换代码场景并提交 quiz；
- 桌面与 390px 视口完成视觉检查，浏览器控制台无未处理错误；
- 服务重启或无效 courseId 会显示可恢复提示页，而不是白屏。

## 6. M2：MySQL 持久化与课程 API

> 状态：已完成。正式运行时已切换为 MySQL，内存仓储仅保留给单元测试和显式受控模式。

### 目标

用 MySQLCourseRepository 替换运行时内存仓储，让课程从创建开始就具备服务端持久化、版本控制和恢复能力。

### 主要任务

先做小型技术验证，确定 MySQL 8.0+ 驱动或 ORM；判断标准是 Next.js 服务端兼容性、迁移、JSON 列、事务、连接池和测试便利性，而不是流行度。正式领域层不得依赖最终选中的数据库库。

建立 courses 与 quiz_attempts 表、版本化迁移和数据库健康检查。courses 使用关系型顶层字段加 JSON 聚合列，revision 负责乐观并发。实现 create/get/list/save/delete 仓储契约以及以下 API：

```text
POST   /api/courses
GET    /api/courses
GET    /api/courses/{courseId}
DELETE /api/courses/{courseId}
```

数据库凭据只在服务端读取。第一版无登录，只允许部署到本机或受信任网络；不能因为使用 MySQL 就默认成为公开多用户系统。

### 最小测试

- InMemory 与 MySQL 适配器通过同一仓储契约测试；
- create 后重启应用仍能 get/list；
- expectedRevision 不匹配返回 `COURSE_CONFLICT`；
- 写入前与读取后都执行 CourseSchema；
- 删除 Course 级联删除 quiz_attempts；
- MySQL 不可用时返回可诊断错误，不伪装为空列表。

### 退出门

按 README 启动 MySQL、执行迁移和运行应用后，可以创建、查询、刷新、重启和删除固定课程；课程数据不依赖 IndexedDB、sessionStorage 或 React 内存。

### 完成证据

- 技术验证选择 `mysql2/promise`，业务层仍只依赖 `CourseRepository`；
- `001_initial_schema.sql` 建立 courses、quiz_attempts 和外键，迁移复跑会跳过已登记版本；
- `pnpm test:db` 的 6 项真实 MySQL 集成测试通过，覆盖共享仓储契约、revision conflict、新实例读取、级联删除、损坏聚合拒绝和连接失败分类；
- Route Handler 对数据库错误返回统一 code、message、retryable、requestId，不把数据库故障伪装为空列表；
- Playwright CLI 创建并装配课程后停止、重启 Next.js，同一 URL 和首页列表仍恢复 REV.1 与 4/4 场景；
- UI 删除课程后历史列表与数据库记录均清空，浏览器控制台无错误。

## 7. M3：DeepSeek 与真实大纲

### 目标

用统一 AIAdapter 接入 DeepSeek，并用正式大纲接口替换固定大纲。

### 主要任务

实现 MockAIAdapter、OpenAICompatibleAdapter 和 ProviderConfigResolver。MVP 的 remote 档使用 DeepSeek 服务端 Key、Base URL 和 Model；一次课程运行中不自动切换。已有百炼配置分支保留，但不进入当前验收。

完成 `POST /api/courses/{courseId}/outline/generate`：应用服务加载 Course、登记 activeOperation、调用模型、解析 JSON、执行 Zod/语义门、必要时一次修复，并用 operation id + expectedRevision 事务保存。用户编辑和确认大纲通过 `PATCH /api/courses/{courseId}/outline`。

Provider、模型、promptVersion、requestId、耗时、upstreamCalls 和可用 token usage 写入 outlineGeneration。模型名与服务地址保持环境可配置，不能散落在业务代码中。

### 最小测试

- mock 与 DeepSeek 适配器输出共用同一契约；
- Provider 配置缺失、Key/地域不匹配、401、429、超时得到稳定错误码；
- 代码围栏 JSON、纯 JSON、非法字段和场景数越界按规则处理；
- 模型成功但数据库事务失败时接口返回失败；
- 客户端 bundle 中不存在模型 Key 和 MySQL 凭据。

### 退出门

mock 必须确定性生成 3～5 项大纲。使用有效 DeepSeek 配置完成至少一次真实大纲生成，数据库元数据能够证明实际平台和模型；失败时草稿仍可恢复。

截至 2026-08-25，mock、配置解析、共用远端适配器、短事务应用服务、编辑确认和数据库元数据均已通过自动化与浏览器验证。DeepSeek 已用 `deepseek-v4-flash` 完成一门 5 场景课程的真实大纲与场景生成，MySQL 保存了 Provider、模型、请求编号、Prompt 版本、耗时、调用次数和修复标记；M3 退出门已通过。

## 8. M4：逐场景生成与失败隔离

### 目标

逐个生成 slide 或 quiz，事务保存结果，并让单场景失败不破坏其他场景。

### 主要任务

实现 `POST /api/courses/{courseId}/scenes/{outlineId}/generate`。服务端从 MySQL 读取大纲、紧凑 coursePlan 和前一场景 summary；客户端不能提交另一套课程上下文。首版串行请求，SceneProgress 独立记录 pending/generating/ready/failed、尝试次数和错误。

模型 DTO 可以返回 paragraph、bullet_list、callout、code 或 quiz。领域装配器补齐所有 ID、引用、GenerationMetadata 和 Action。每次操作先短事务登记 activeOperation，模型调用不占用长事务，最后用 operation id + revision 提交结果。超时遗留操作经过租约后才能恢复。

### 最小测试

- slide、CodeBlock、quiz 合法样例可装配为领域实体；
- 模型不能指定 ID、持久化状态、correctOptionId 或任意 Action；
- 第 2 个场景失败时第 1 个结果仍保留；
- 重试替换同 outlineId 结果而非重复追加；
- 并发或迟到响应触发 conflict，不能覆盖较新聚合；
- 达到上游调用上限后停止。

### 退出门

一门 3～5 场景课程逐项显示生成进度；故障注入证明失败隔离、单场景重试、事务失败和迟到响应保护有效；全部 ready 后课程才进入 ready。

截至 2026-08-25，mock 下的 slide/quiz 生成、逐项进度、故障注入、失败隔离、单场重试、迟到响应保护、MySQL 增量恢复和浏览器课堂闭环均已通过。DeepSeek 真实课程曾有两个场景在输出修复后仍未通过契约，系统保留其他完成内容并允许逐场重试，最终达到 `5/5 ready`；M4 退出门已通过。

## 9. M5：课堂播放、测验与可选语音

> 状态：代码完成。playback reducer、Action executor、TextOnly/BrowserSpeech、课堂控制和 quiz_attempts 服务端写入均已进入正式调用链。

### 目标

让静态课程数据成为可运行课堂。语音不是交付前提，讲解文本和确定性状态机才是核心。

### 主要任务

实现 playback reducer 和 Action executor，支持 speech、pause。默认 TextOnlySpeechAdapter 显示讲解并按估算时长完成；BrowserSpeechAdapter 在用户启用且浏览器支持时使用 `speechSynthesis`。后续若需要云 TTS，只新增适配器，不改变 Action 或播放器。

quiz 进入页面即可作答；自动播放到 learner pause 时进入 awaitingLearner，提交后展示对错和解析。若在讲解前或讲解中完成全部题目，则取消当前语音或计时并完成场景。课堂提供播放、暂停、继续、上一场景、下一场景和重新播放。切换课程或卸载页面时取消当前适配器、定时器和监听器。quiz_attempts 通过服务端保存；语音开关和非关键播放游标可留在 localStorage。

### 最小测试

- reducer 覆盖 idle、playing、paused、awaitingLearner、completed；
- pause/resume 不重复执行当前 Action；
- 快速切页后旧完成事件不污染新场景；
- TextOnly 模式能够完成整门课程；
- BrowserSpeech 不可用时自动回退；
- quiz 提交前不会自动跳过。

### 退出门

关闭语音时固定课程和真实课程均可播放到结束并完成测验；启用浏览器语音时能朗读，失败不会阻塞课程。连续播放两遍不产生重复语音、悬挂计时器或错位场景。

截至 2026-08-24，reducer 状态路径、暂停恢复、迟到事件隔离、TextOnly 计时和 BrowserSpeech 回退已通过单元测试；服务端判分与 MySQL 作答恢复已通过集成测试。生产构建包含正式作答 API。真实浏览器的连续播放与作答闭环记录在 [07-development-status.md](07-development-status.md)。

## 10. M6：系统验收与交付

> 状态：已按本机、MySQL、mock 与 DeepSeek 范围完成。

### 目标

把“开发者机器上能跑”提升为“导师可以按文档启动数据库、应用并完成演示”。

### 主要任务

补齐领域单元测试、MySQL 仓储集成测试、API 集成测试和完整 E2E。建立 mock 与 DeepSeek 配置检查，但自动测试固定运行 mock，避免费用和网络不稳定。统一 loading、empty、error、conflict、cancelled 状态；整理 `.env.example`、迁移、测试数据、备份恢复、部署和故障排查说明。

逐项审计 FR、NFR 与 AC-01～AC-12。未实现项必须修复、正式缩小范围，或列入后续版本，不能用“接口存在”代替行为验收。

### 验收矩阵

| 层次 | 重点证据 |
| --- | --- |
| 静态检查 | TypeScript、lint、依赖、服务端环境边界 |
| 单元测试 | Schema、装配器、reducer、错误分类、预算 |
| 数据库集成 | 迁移、CRUD、revision conflict、事务和级联删除 |
| API 集成 | mock 下课程、大纲、场景成功与失败响应 |
| 浏览器 E2E | 创建 → 大纲 → 场景 → 课堂 → 测验 → 重启恢复 |
| Provider 冒烟 | DeepSeek 一次受控真实调用，不进入默认 CI |
| 故障注入 | 非法 JSON、429、超时、DB 失败、迟到响应、无 TTS |

### 退出门

在本机仅按 README 可启动 MySQL、执行迁移、运行 mock 完整演示；DeepSeek remote 配置完成真实验证；质量命令通过；所有 MVP 验收标准都有证据。

当前已补齐统一 API error envelope、请求取消与不可重试 UI、配置健康检查、API 契约测试、production Chromium E2E、临时 MySQL mock CI、部署/备份/恢复/排障手册和 AC-01～AC-12 证据矩阵。mock 自动退出门与 DeepSeek 真实 smoke test 已通过，M6 正式完成；百炼与异机部署仅在后续确有需要时另立扩展任务。

## 10.5. M6.5：远端响应韧性与可观测性

> 状态：方案已完成，代码尚未开始。完整分类、调用预算、验收矩阵和提交顺序见 [10-m6.5-remote-response-resilience-plan.md](10-m6.5-remote-response-resilience-plan.md)。

M6.5 是 M6 与 M7 之间的工程加固里程碑，不重新打开 M6 的交付范围，也不修改 M7 的质量与互动计划。它将 HTTP 2xx 下的空响应、非 JSON、异常 OpenAI-compatible envelope 和空 content 从“未知且不可重试”改为可诊断、可受限重试的上游响应错误，同时保留严格 Zod、领域语义门、一次 repair 和单请求 4 次上游调用硬上限。

### 实施顺序

```text
M6.5.0 冻结脱敏故障 fixture 和分类契约
  → M6.5.1 分层解码 OpenAI-compatible 响应
  → M6.5.2 受限重试、调用预算与安全结构化日志
  → M6.5.3 生成页恢复进度、手动重试和配置提示
  → M6.5.4 mock 故障注入、全量回归与 DeepSeek smoke
```

### 退出门

AC-R01～AC-R11 全部具备证据；`pnpm verify:full` 通过；可恢复响应异常在调用硬上限内自动或手动恢复；认证和明确配置错误不自动重试；结构化日志可用 `requestId` 追踪但不包含 Prompt、主题、Key 或原始模型响应。

## 11. M7：课程质量与互动能力

> 状态：方案已完成，代码尚未开始。完整任务、字段、安全协议和提交顺序见 [09-v0.4-quality-and-interaction-plan.md](09-v0.4-quality-and-interaction-plan.md)。

### M7.0：质量基线与评价协议

冻结覆盖概念、机制和编程实践的 6 个开发评价主题；使用当前 Prompt v1 生成基线，记录结构完成率、修复次数、耗时、token 和人工六维评分。先确定评分说明和阈值，之后不得根据候选结果临时修改。

**退出门**：评价数据、量表版本、模型/Prompt 配置和基线报告可复现；不修改生产 Prompt。

### M7.1：CourseBrief、Schema v2 与大纲质量

增加 CourseBrief、服务端默认值、MySQL `brief_json`、v1 → v2 迁移和 outline.v2。大纲增加场景角色、误区/评估意图和可选 diagram 计划；旧课程无需清库即可恢复。

**退出门**：同一主题按初学者/进阶目标生成的计划有可解释差异；v1 fixture、MySQL 恢复和 M6 E2E 均通过。

### M7.2：丰富静态场景与课程连贯性

增加 steps、comparison、table 固定 Block，升级 slide/quiz Prompt；使用受限课程记忆传递已覆盖关键点、待覆盖目标和前文摘要；增加密度、重复、覆盖和 quiz 对齐报告。

**退出门**：三种 Block 在桌面和窄屏安全渲染；候选课程不是靠增加长段落提高信息量；原 slide/quiz/code 回归全部通过。

### M7.3：interactive/diagram 纵向闭环

只实现 `interactive/diagram`：专用 Prompt 生成自包含 HTML/CSS/JavaScript，服务端进行大小、结构、危险能力和运行协议校验；课堂使用无 `allow-same-origin`、无外部网络的 sandbox iframe，支持 ready、reset、completed、error 和固定 fallback。

**退出门**：`interactionMode=required` 的课程完成“生成 → MySQL 保存 → 课堂操作 → 重置 → 完成 → 刷新恢复”的 production Chromium E2E；恶意 fixture 不能访问主页面身份、存储或网络；失败不影响其他场景。

### M7.4：单场景再生成与 v0.4 验收

允许 ready 场景携带 500 字以内意见进行事务化再生成。候选生成期间不改变 ready Course；提交前保留旧结果，失败、取消和 conflict 均不破坏课程。quiz 再生成经用户确认后，在替换场景的同一事务清理旧作答。最后在固定模型配置下完成 v0.3/v0.4 成对人工评价，并报告质量、成本、延迟和修复率。

**退出门**：AC-Q01～AC-Q11 全部有证据；M6 `pnpm verify:full` 继续通过；质量达到 M7.0 预先冻结的阈值。达到此门后才宣布 v0.4 完成。

### M7 的硬边界

M7 不加入 LangGraph、多智能体、多模态、RAG、媒体、自由坐标画布、code/simulation/game/3D widget 或任意学习者代码执行。diagram 未稳定前不得增加第二类互动场景。

## 12. M8：毕业论文延展

M8 从 M7 已收集的数据中只选择一个主问题，例如教学策略 Prompt 的成对实验、互动脚本运行错误检测与修复、双 Provider 质量—成本比较，或整课重生成与单场景恢复的效率比较。实验必须写清基线、唯一主要变量、评价指标、样本、重复次数和失败处理。

若引入 LangGraph、多智能体、多模态或 RAG，它必须是该研究问题的必要变量并有消融对照；“使用了某个框架”本身不是研究贡献。

## 13. 风险登记与止损规则

| 风险 | 早期信号 | 止损措施 |
| --- | --- | --- |
| 范围膨胀 | diagram 未稳定就加入 RAG、Agent 或第二种 widget | 严格按 M7.0～M7.4，额外能力移入 M8 |
| 数据库先于领域模型扩张 | 页面和 API 直接拼 SQL | 强制 CourseRepository 与契约测试 |
| 长事务 | 模型调用期间占用数据库事务 | 使用登记操作和结果提交两个短事务 |
| 并发覆盖 | 迟到响应覆盖重试结果 | operation id + expectedRevision |
| Provider 漂移 | 模型名或服务地址写死 | 环境配置、启动校验、保存生成元数据 |
| 演示依赖网络 | 无 Key 就无法进入课堂 | mock 走同一数据库和生成链路 |
| 语音拖慢主线 | 调试集中在音色或兼容性 | TextOnly 为默认，BrowserSpeech 可关闭 |
| 生成脚本越权 | iframe 可访问网络、主页面或存储 | 关闭 interactive 入口，先修复 sandbox/CSP/消息边界 |
| 旧课程无法读取 | schemaVersion 2 直接替换 v1 | 停止 UI/Prompt 开发，先完成迁移与 fixture 回归 |
| 质量提升不可证 | 只展示一个好看的课程 | M7.0 先冻结数据集、量表与阈值，再做成对评价 |
| 论文成为功能堆砌 | 延展没有唯一变量 | M8 一次只选择一个主问题 |

当前主分支无法启动、迁移不可重复、CourseSchema 可被绕过、密钥进入客户端、失败只能清库恢复或测试连续失效时，停止增加功能并先恢复基线。

## 14. 推荐的下一次开发迭代

下一批提交先执行 M6.5.0，用脱敏 fixture 冻结远端响应异常的分类和重试契约，随后按 M6.5.1～M6.5.4 完成工程加固。

M6.5 退出后，按既定方案执行 M7.0：建立评价集、评分量表、基线生成清单和报告模板，选择 6 个无隐私主题，用当前 DeepSeek 配置生成可追踪基线；不直接改 Prompt 或加 iframe。M7.0 退出后再开始 Course v2 和迁移；迁移通过前不修改当前 Scene 联合。
