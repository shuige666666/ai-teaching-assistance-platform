# 06. 复刻实施路线图

> 文档状态：v0.4 设计基线
> 适用范围：`ai-teaching-assistance-platform` 工程基线与课程质量增强
> 总目标：任何时候都保留一个可运行、可演示、可回退到 mock 的系统。

## 1. 实施结论

复刻不按 OpenMAIC 的目录逐项照搬，而按纵向闭环推进：**固定课程可浏览 → MySQL 可恢复 → 真实大纲 → 真实场景 → 播放与测验 → 完整验收**。数据库现在是基础能力，因此必须在真实模型接入前完成，不能等课程已经生成后再补持久化。

M1 是第一个可运行原型，M2～M6 共同组成已经完成的 v0.3 MVP。M7～M10 不直接做论文创新，而是依次完成课程质量基础、PPT 式只读幻灯片、单一互动场景和可回退的课程修订，四个里程碑共同形成 v0.4 产品基线。M11 是不阻塞 v0.4 的 PPTX + interactive HTML 简化资源包导出，已按独立扩展完成；M12 在 M10 基础上建设对话式课程修订 Agent。专业幻灯片编辑器后移为 MX 按需候选，可度量研究问题仍在 MX 中独立选题。

**当前进度：M1～M11 已完成，M12.0～M12.4 工程主链已于 2026-09-09 实现；M12.2/M12.3 已完成一轮隔离副本真实案例和浏览器证据，M12.4 已完成课堂/对话双栏、场景导航、会话逐项操作和删除的核心回归，人工教学/互动质量判断仍待补充。M7.0 六题与旧版 MHTML 保持冻结并作为历史留档，不再要求同题 A/B 评分；专业幻灯片编辑器已移出确定阶段。** 实施证据见 [07-development-status.md](07-development-status.md)。

## 2. 统一完成定义

以下定义适用于所有实现任务；M0 只执行文档链接、术语和追踪一致性检查。M11 已独立完成，M12 按已确认方案分批实施，也遵守同一完成定义。

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
| M7 课程质量基础（已完成） | 历史基线、CourseBrief、Course/outline v2 | v0.3 模糊课程要求 | M7.0/M7.1 已完成 |
| M8 PPT 式只读幻灯片（已完成） | 裁剪 OpenMAIC 的直接坐标元素链，保存、恢复并只读播放 | 纵向 Block 堆叠 | 分类型/fixture、Prompt/生成、渲染/实测已完成 |
| M9 diagram 互动闭环（已完成） | 一个可操作、可重置、可完成且可安全失败的互动页 | 全静态场景 | 一个纵向闭环 |
| M10 课程修订与 v0.4 验收（已完成） | ready 三类场景修订、新版 slide 单人需求验收 | 不自动重生成整课、不做 A/B 评分 | 单场事务闭环 + 固定视口视觉验收 |
| M11 简化资源包导出（已完成） | 一个 ZIP 内含课程 PPTX 与 `interactive/*.html` | M8 slide + M9 interactive | 不阻塞 v0.4/MX |
| M12 对话式课程修订 Agent（M12.0～M12.4 工程主链已实现） | 右侧持续对话通过受控工具读取、搜索、局部修改、调序和重新生成课程，并可在课堂工作台中联动场景与管理会话 | M10 单次修订 | 隔离副本真实结构证据已归档；人工内容判断待补 |
| M12.4 课程工作台与会话管理体验补强（已完成） | 对话期间继续查看/切换真实场景，支持会话逐项重命名和删除 | M12.3 侧栏主链 | 不增加 Agent 工具，完成双栏与基础会话生命周期 |
| MX 后置候选（暂存） | 专业幻灯片编辑器，或基于既有数据完成一个可度量研究问题 | 无 | 仅在真实需求成立后立项 |

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
- 模型不能指定 ID、持久化状态、correctOptionIds 或任意 Action，只能提供正确答案下标数组；
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

> 状态：已完成实施与验收。完整分类、调用预算、验收矩阵和实测证据见 [M6.5 远端响应韧性方案](stage-plans/m6.5-remote-response-resilience-plan.md)。

M6.5 是 M6 与 M7 之间的工程加固里程碑，不重新打开 M6 的交付范围，也不替代 M7～M10 的质量、画布、互动和修订计划。它将 HTTP 2xx 下的空响应、非 JSON、异常 OpenAI-compatible envelope 和空 content 从“未知且不可重试”改为可诊断、可受限重试的上游响应错误，同时保留严格 Zod、领域语义门、一次 repair 和单请求 4 次上游调用硬上限。

### 实施顺序

```text
M6.5.0 冻结脱敏故障 fixture 和分类契约
  → M6.5.1 分层解码 OpenAI-compatible 响应
  → M6.5.2 受限重试、调用预算与安全结构化日志
  → M6.5.3 生成页恢复进度、手动重试和配置提示
  → M6.5.4 mock 故障注入、全量回归与 DeepSeek smoke
```

### 退出门

AC-R01～AC-R11 全部具备证据；`pnpm verify:full` 已通过；真实 DeepSeek 课程中的连续两次 `empty_content` 已在第 4 次上游调用自动恢复，最终 3/3 ready。认证和明确配置错误不自动重试；结构化日志可用 `requestId` 追踪但不包含 Prompt、主题、Key 或原始模型响应。

## 11. M7：课程质量基础

> 状态：M7.0 自动基线和逐场景 MHTML 已完成，作为 v0.3 历史留档；M7.1 功能已实现。M10 不再安排独立 A/B 或量表评分，完整字段和边界见 [M7～M10 开发方案](stage-plans/m7-m10-v0.4-quality-and-interaction-plan.md)。

### M7.0：质量基线与评价协议

冻结覆盖概念、机制和编程实践的 6 个开发评价主题；使用当前 Prompt v1 生成基线，记录结构完成率、修复次数、耗时、调用、token 和失败样本，并为每个已保存场景归档一份 `1280×720` MHTML。该基线只作为 v0.3 历史事实，不再触发后续人工量表或同题配对任务。

**退出门**：六题输入、模型/Prompt 配置、基线报告和逐场景 MHTML 可复现；课程内容与生成元数据完整保留；不修改生产 Prompt、Schema、Renderer 或 CSS。

**2026-08-28 证据修订**：提交 `85be4b9f` 的 44 张 PNG、双视口 DOM/密度观察和提前创建的评分空表由 28 份逐场景 MHTML 取代。迁移只读取既有 MySQL 课程，没有重新调用 DeepSeek；失败样本和报告中的生成事实继续保留。移动端结果不进入 M8～M10 评分或退出门。

### M7.1：CourseBrief、Schema v2 与大纲质量

把 CourseBrief 定义为“原始描述 + 可选高级设置 + 服务端默认值”的结构化归一结果，而不是新增一张必填表单。创建接口原样保存 topic，并先写入 provisional Brief；一次 `outline.v2.1` 调用同时返回 Prompt 中明确检测到的字段、警告和 outlines，服务端按 `explicit_setting > prompt > default` 独占计算 resolved Brief 并同事务保存。MySQL `brief_json` 同时保存有效值、每字段来源和解析状态；大纲页展示系统理解和冲突警告，确认前修改 Brief 会使旧大纲失效。

本阶段同时完成 Course v1/v2 判别、v1 明确拒绝、受众/水平/目标/先修/时长/风格/互动/附加要求契约，以及 SceneRole、误区/评估意图。旧行无需清库且不会被修改，但不迁移、不展示；正常大纲路径不因 Brief 解析固定增加一次 LLM 调用。M7 只建立后续场景生成需要的语义上下文，不提前实现画布 Renderer 或互动 iframe。

**退出门**：只有主题、信息完整 Prompt、部分信息 Prompt 和设置冲突四类 fixture 均能得到可解释的字段值、来源与警告；同一原始描述按默认值和显式受众/目标生成的计划有可解释差异；Brief 与大纲同 revision 恢复，修改 Brief 不会遗留旧大纲；Prompt 注入不能越过 System Prompt/Schema；v1 fixture、MySQL 恢复和 M6 E2E 均通过。

**M7 退出门**：M7.0 六题输入、生成报告和逐场景 MHTML 已保存；四类 Brief fixture、v1 隔离、v2 MySQL 恢复和 M6 全量回归通过；同一主题在默认值与显式受众/目标下得到可解释差异。达到此门后才开始 M8。

## 12. M8：PPT 式只读幻灯片画布

M8 取代原 M7.2 的固定 React 模板方案。slide 只有一种产品形态：固定 16:9、一次展示一个场景的 PPT 式页面，不再建设类 Markdown、纵向讲义或同课双视图。内容在 `content.canvas` 中保存 `Slide`：固定 `viewportSize: 1000`、`viewportRatio: 0.5625`，页面由带稳定 id、绝对坐标、尺寸和样式的有限 PPTElement 组成。第一版只支持 `text/shape/line/code`，不加入图片检索、图表、音视频、复杂公式、动画或可执行 slide HTML。Course 因删除旧 `content.blocks` 升级到 v3；v1/v2 行保留但不兼容。

生成仍只调用一次现有 scene 模型。与 OpenMAIC 一样，裁剪后的 `slide-content` Prompt 直接要求 LLM 返回背景和元素坐标；服务端执行 JSON/Schema、未支持元素过滤、默认值补齐、text 富文本净化、损坏元素丢弃和 id 分配，然后组装 `Slide`。不增加独立的语义计划、自动排版器或复杂坐标质量系统。Renderer 只负责等比缩放、四类元素分发和 fallback。

OpenMAIC 固定提交 `59adbef` 提供整条实现参照：[`slide-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/system.md) 和 [`user.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/user.md) 定义画布与视觉规则，[`pipeline-types.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/pipeline-types.ts)、[`scene-generator.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-generator.ts)、[`normalize.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/dsl/src/normalize.ts) 和 [`scene-builder.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-builder.ts) 串起响应、规范化和装配，[`SlideCanvas.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/renderer/src/SlideCanvas.tsx) 与 [`SlideElement.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/renderer/src/SlideElement.tsx) 负责渲染。本项目保留 AIAdapter、Zod、MySQL 和调用预算，裁掉上游媒体/编辑能力，并保留 MIT 许可和来源记录。

**M8 退出门（已完成）**：mock fixture 覆盖四类元素并能保存、重启恢复和播放；3 个代表主题的真实 DeepSeek 首场均一次生成成功，4 个场景归档为 `1280×720` MHTML；坏元素局部丢弃，画布内标题和 16:9 由 E2E 覆盖；v1/v2 课程明确隐藏并拒绝。移动端、平板和窄屏不阻塞退出。完成后才开始 M9。

## 13. M9：多样化 interactive 纵向闭环

已确认并接入：课程 4～8 个场景、默认 5；大纲页显式 off/required。required 时 4 场景 1 个互动、5～6 场景 1～2 个、7～8 场景 1～3 个；至少 2 slide 和 1 quiz、首场 slide、互动不连续。当前 Course v5 自动读取升级 v4，仍不兼容 v1～v3；不改历史 M7/M8 验收记录。

M9 当前实现 diagram/simulation/game/code：从 OpenMAIC 裁剪分类 Prompt，直接生成完整 HTML，再经轻量后处理、MySQL 保存和 iframe 运行。分类不锁死玩法；允许外部依赖，sandbox 仅 allow-scripts，无 allow-same-origin。code 支持 Python/JavaScript Worker，停止与超时可终止；不做服务端执行、3D 或复杂修复系统。详见 docs/09 第6节。

可参考 OpenMAIC 的 [`interactive.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/dsl/src/interactive.ts)、[`diagram-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/diagram-content/system.md)、[`interactive-renderer.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/interactive-renderer.tsx)、[`InteractiveIframeHost.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/InteractiveIframeHost.tsx) 和 [`iframe.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/lib/utils/iframe.ts)。OpenMAIC 当前 iframe 还允许 forms/popups，本项目范围更小，安全配置不得原样复制，仍坚持只有 `allow-scripts`。

**M9 退出门**：`interactionMode=required` 的课程完成“生成 → MySQL 保存 → 课堂操作 → 重置 → 完成 → 刷新恢复”的 production Chromium E2E；隔离 fixture 不能读取主页面身份或存储；允许网络，不承诺防外传；失败不影响其他场景。

## 14. M10：单场景再生成与 v0.4 验收（已完成）

允许 ready 场景携带 500 字以内意见进行事务化再生成。候选生成期间不改变 ready Course；提交前保留旧结果，失败、取消和 conflict 均不破坏课程。slide 再生成继续经过 M8 的同一 Prompt、规范化和 Slide 装配链；quiz 再生成经用户确认后，在替换场景的同一事务清理旧作答。新版 slide 最终在固定 `1280×720` 视口下完成单人需求验收；M7.0 的 v0.3 课程和 MHTML 仅作为历史留档，不做 v0.3/v0.4 成对评分。

**M10 退出门**：AC-Q01～AC-Q11 全部有证据；M6 `pnpm verify:full` 继续通过；新版 slide 已通过固定视口下的单人需求验收。达到此门后宣布 v0.4 当前范围完成，不把该验收写成事实正确性、教学质量或统计意义上的版本优越性结论。

## 15. M11：PPTX + interactive HTML 简化资源包导出（已完成）

M11 在 M10/v0.4 已完成、M8 slide 与 M9 interactive 稳定且用户确认范围后实施，并于 2026-09-07 完成验收。导出结果固定为一个 ZIP：根目录只放一个课程 PPTX，`interactive/` 目录只放按原始场景顺序命名的自包含 HTML，例如 `03_流程互动.html`。第一版不生成 manifest、README 或 assets 目录；外部依赖不承诺完全离线。PPTX 只写入 slide 场景并保持相对顺序，互动页面不尝试嵌入 PPTX。v2.2 起元素集已扩展为 text/shape/line/code/chart/table 六类，导出映射已覆盖全部六类——chart 映射为 PPTX 原生图表、table 映射为 PPTX 表格；文本默认字体/透明度和代码长文本收缩已与课堂渲染能力对齐；下载对象 URL 延迟释放，完成提示具备状态播报语义，移动端长提示放在导出按钮下方。斜线使用 PPTX 原生直线，`curve` 按直线近似并计入降级清单；Windows 保留设备名不纳入低概率场景硬门禁。具体映射表与保真度决策见 [M11 导出方案](stage-plans/m11-slide-export-plan.md)。

M11 退出证据包括：`pnpm test` 通过 26 个文件、164 项测试；`pnpm lint`、TypeScript 检查和 `pnpm build` 通过；`pnpm test:e2e` 覆盖真实点击下载、解包、完成提示状态播报和刷新恢复；`pnpm check:export` 在两门真实 ready 课程上核对 ZIP、PPTX 页数、文本、表格、原生图表和互动 HTML。PowerPoint/WPS 人工打开核对已由用户于 2026-09-07 完成。导出仍为课堂页纯只读能力，不改数据库或 revision。

可参考 OpenMAIC 的 [`lib/export/use-export-pptx.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/lib/export/use-export-pptx.ts) 中 PPTElement 到 PPTX 的映射、资源包组装、标题安全化和 `interactive/` 分包方式，以及其内置 [`packages/pptxgenjs`](https://github.com/THU-MAIC/OpenMAIC/tree/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/pptxgenjs)。固定提交按“第几个互动页”编号，本项目明确改为原始 `Scene.order`，不能原样复制该编号逻辑。本项目不复用 `.maic.zip` manifest、导入协议、视频导出或完整媒体管线。

## 16. M12：对话式课程修订 Agent（M12.0～M12.4 已实现）

M12 把 M10 的一次性单场景修订升级为课堂右侧的持续对话：模型可以先讨论，再按需调用 `list_scenes/read_stage/grep_stage/patch_stage/edit_deck/generate_scene` 等受控工具读取、搜索和修改课程。模型明确返回的可见 reasoning、正文与工具生命周期通过 SSE 流式展示；思考卡和工具组默认收起，展开后可查看经净化和限长的真实入参与结果。

第一版采用单 Agent、独立 MySQL 会话记录和服务端工具循环，不复制 OpenMAIC 的多 Agent Director、后台 Worker、Skills、媒体或语音系统。M12.0～M12.3 已完成 `list_scenes/read_stage/grep_stage/patch_stage/edit_deck/generate_scene`、SSE、会话列表/切换、上下文裁剪提示、运行状态恢复、轻量指标、确认和课程刷新；M12.4 补齐桌面课堂/对话双栏、场景选择与消息锚点、会话逐项重命名和删除，所有写入继续经过 application service、完整 Schema、净化与 `expectedRevision`。生成工具复用现有 operation lease，新增页不保存占位数据。完整方案与当前实现边界见 [M12 对话式课程修订 Agent 开发方案](stage-plans/m12-conversational-course-revision-agent-plan.md)。

M12.3 工程实现已完成会话切换、上下文裁剪提示、轻量运行统计和刷新状态恢复；随后补齐过期插页租约恢复、逐工具轨迹检查点、确认原子领取和旧任务收尾不覆盖新 Session 状态。真实 DeepSeek 已在隔离副本上完成调序、新增、局部补丁、三类重生成和确认/取消案例，工具轨迹与 MHTML 归档见方案 M12.3-D。具体参数、事务、取消、页面定位和验收边界见方案第 9 节。视觉预览、撤销/版本历史、媒体生成及专业编辑器不作为 M12.3 的完成前提。

M12.4 已在真实试用基础上完成课程工作台与会话管理体验补强：桌面端打开对话时保留可操作的真实场景画面，以课堂状态为唯一真源继续使用主课堂场景导航；侧栏不重复渲染当前场景卡片，每条消息继续冻结发送时的 sceneId 并可通过消息锚点定位。会话列表改为逐项菜单和内联重命名，删除按钮首次点击后原位变为“确认删除”，再次点击才删除会话；同时处理当前会话删除后的回落以及标题补齐不污染活动时间。窄屏保留覆盖式面板。该阶段未新增工具、截图服务、会话全文搜索、回收站或多会话并行，详细要求与验证见 M12 方案的 M12.4 章节。

## 17. 共同硬边界

M7～M10 不加入 LangGraph、多智能体、多模态、RAG、媒体、3D/procedural-skill 或服务端代码执行。M9 已按用户确认扩展四类互动和浏览器代码练习；M8 不实现直接编辑，M11/M12 不并入 v0.4 硬门。M12 的 Agent 工具不获得任意文件系统、数据库、网络或代码执行能力。

## 18. MX：毕业论文延展

专业幻灯片编辑器后移到 MX，不再占用确定阶段编号。它的选择、拖拽、缩放、命中测试、坐标换算和撤销重做属于较重的前端交互工程，但主要解决精确人工排版，不能直接提高课程事实正确性、教学质量或 Agent 修订能力；当前 M11 已支持导出 PPTX，精细调整也可以在 PowerPoint/WPS 中完成，因此它不是 M12 的前置条件。

只有满足以下任一条件时才重新立项编辑器：真实使用持续出现自然语言修订无法解决的精确坐标/尺寸调整；课程作者必须在平台内完成专业课件制作；或论文明确研究“AI 生成与人工精修协同”。重新立项时仍复用 `Slide/PPTElement`、SlideCanvas、净化、完整 CourseSchema 与 `expectedRevision` 保存边界，不建立第二套编辑器格式。MX 的论文研究选题与编辑器候选彼此独立，一次仍只选择一个主问题。

## 19. 风险登记与止损规则

| 风险 | 早期信号 | 止损措施 |
| --- | --- | --- |
| 范围膨胀 | M12 同时建设完整编辑器、多 Agent、媒体、RAG 或后台任务平台 | M12 只做单 Agent 课程工具闭环；编辑器与其他扩展留在 MX |
| 数据库先于领域模型扩张 | 页面和 API 直接拼 SQL | 强制 CourseRepository 与契约测试 |
| 长事务 | 模型调用期间占用数据库事务 | 使用登记操作和结果提交两个短事务 |
| 并发覆盖 | 迟到响应覆盖重试结果 | operation id + expectedRevision |
| Provider 漂移 | 模型名或服务地址写死 | 环境配置、启动校验、保存生成元数据 |
| 演示依赖网络 | 无 Key 就无法进入课堂 | mock 走同一数据库和生成链路 |
| 语音拖慢主线 | 调试集中在音色或兼容性 | TextOnly 为默认，BrowserSpeech 可关闭 |
| 生成脚本越权 | iframe 可访问网络、主页面或存储 | 关闭 interactive 入口，先修复 sandbox/CSP/消息边界 |
| 用户误以为所有旧课程都兼容 | v1/v2/v3 行留在数据库但不再进入 v5 运行链 | 只自动升级差异可控的 v4；列表过滤更老版本，按 ID 返回明确错误 |
| 裁剪上游时牵入过多依赖 | 为一个 slide 同时引入媒体、编辑器、动效和存储包 | 只移植四类元素需要的类型、纯函数和 Renderer，记录来源 |
| 模型坐标不稳定 | 多个真实主题反复出现相同重叠、越界或超长正文 | 先缩小 Prompt/元素字段并调整示例；稳定复现后只补针对性规则 |
| 用视觉手段掩盖超载 | 依赖小字体、隐藏或画布内滚动才不溢出 | 回退 Prompt 中的可见内容预算，细节移入 narration |
| 质量结论越界 | 将一次单人需求验收写成客观质量提升或统计结论 | 文档明确区分产品验收与论文实验；需要定量比较时另立独立实验 |
| 论文成为功能堆砌 | 延展没有唯一变量 | MX 一次只选择一个主问题 |

当前主分支无法启动、迁移不可重复、CourseSchema 可被绕过、密钥进入客户端、失败只能清库恢复或测试连续失效时，停止增加功能并先恢复基线。

## 20. 推荐的下一次开发迭代

当前 M7.0 基线保持冻结，M9 多样化互动、M10 单场修订/quiz 人工题目编辑、新版 slide 单人需求验收、M11 导出和 M12.0～M12.4 均已完成工程主链，最新实测以 docs/07 为准。新课程为 Course v5、4～8 场景；v4 按需无损升级，v1～v3 不迁移。下一步可继续补充多课程人工质量证据；专业编辑器与其他论文延展仍留在 MX。
