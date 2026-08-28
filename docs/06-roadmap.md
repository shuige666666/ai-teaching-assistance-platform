# 06. 复刻实施路线图

> 文档状态：v0.4 设计基线
> 适用范围：`ai-teaching-assistance-platform` 工程基线与课程质量增强
> 总目标：任何时候都保留一个可运行、可演示、可回退到 mock 的系统。

## 1. 实施结论

复刻不按 OpenMAIC 的目录逐项照搬，而按纵向闭环推进：**固定课程可浏览 → MySQL 可恢复 → 真实大纲 → 真实场景 → 播放与测验 → 完整验收**。数据库现在是基础能力，因此必须在真实模型接入前完成，不能等课程已经生成后再补持久化。

M1 是第一个可运行原型，M2～M6 共同组成已经完成的 v0.3 MVP。M7～M10 不直接做论文创新，而是依次完成课程质量基础、PPT 式只读幻灯片、单一互动场景和可回退的课程修订，四个里程碑共同形成 v0.4 产品基线。M11 是不阻塞 v0.4 的可选 PPT 式幻灯片编辑器，M12 是可选的 PPTX + interactive HTML 简化资源包导出；暂存的 MX 才选择一个可度量研究问题。

**当前进度：M1～M6.5 已按“本机 + MySQL + mock + DeepSeek”范围完成；M7.0 的 6 主题 Prompt v1 自动基线、生成事实与逐场景 MHTML 已留存，人工评分延后到 M10 的 v0.3/v0.4 配对验收。下一步实现 M7.1 CourseBrief/outline v2。原 M7.2、M7.3、M7.4 尚未进入代码，现分别升格为 M8、M9、M10；M8～M10 只承诺 `1280×720` 及更大桌面视口。** 已实现能力与验证证据持续记录在 [07-development-status.md](07-development-status.md)。

## 2. 统一完成定义

以下定义适用于 M1～M10 的实现任务；M0 只执行文档链接、术语和追踪一致性检查。M11/M12 开始前必须另行确认范围，但一旦进入实现也遵守同一完成定义。

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
| M7 课程质量基础（进行中） | 桌面评价基线、CourseBrief、Course/outline v2 | v0.3 模糊课程要求 | 分 M7.0、M7.1 |
| M8 PPT 式只读幻灯片（计划） | 裁剪 OpenMAIC 的直接坐标元素链，保存、恢复并只读播放 | 纵向 Block 堆叠 | 分类型/fixture、Prompt/生成、渲染/实测 |
| M9 diagram 互动闭环（计划） | 一个可操作、可重置、可完成且可安全失败的互动页 | 全静态场景 | 一个纵向闭环 |
| M10 课程修订与 v0.4 验收（计划） | ready 场景按指令替换并完成成对质量报告 | 只能重新生成失败场景 | 事务闭环 + 最终评价 |
| M11 PPT 式幻灯片编辑器（可选） | 在同一 `Slide/PPTElement` 上选择、拖拽、缩放、文字编辑、撤销重做和保存 | M8 只读幻灯片 | 不阻塞 v0.4/MX |
| M12 简化资源包导出（可选） | 一个 ZIP 内含课程 PPTX 与 `interactive/*.html` | M8 slide + M9 interactive | 不阻塞 v0.4/MX |
| MX 毕业论文延展（暂存） | 基于 M7～M10 数据完成一个可度量研究问题 | 无 | 视选题而定 |

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

> 状态：已完成实施与验收。完整分类、调用预算、验收矩阵和实测证据见 [10-m6.5-remote-response-resilience-plan.md](10-m6.5-remote-response-resilience-plan.md)。

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

> 状态：M7.0 自动基线和逐场景 MHTML 已完成；人工评分延后到 M10，M7.1 代码尚未实现。完整任务、字段和退出门见 [09-v0.4-quality-and-interaction-plan.md](09-v0.4-quality-and-interaction-plan.md)。

### M7.0：质量基线与评价协议

冻结覆盖概念、机制和编程实践的 6 个开发评价主题；使用当前 Prompt v1 生成基线，记录结构完成率、修复次数、耗时、调用、token 和失败样本，并为每个已保存场景归档一份 `1280×720` MHTML。人工七维评分不在没有参照物的 M7.0 单独执行，而是在 M10 同题生成 v0.4 后配对完成。

**退出门**：六题输入、模型/Prompt 配置、基线报告和逐场景 MHTML 可复现；课程内容与生成元数据完整保留；不修改生产 Prompt、Schema、Renderer 或 CSS。

**2026-08-28 证据修订**：提交 `85be4b9f` 的 44 张 PNG、双视口 DOM/密度观察和提前创建的评分空表由 28 份逐场景 MHTML 取代。迁移只读取既有 MySQL 课程，没有重新调用 DeepSeek；失败样本和报告中的生成事实继续保留。移动端结果不进入 M8～M10 评分或退出门。

### M7.1：CourseBrief、Schema v2 与大纲质量

把 CourseBrief 定义为“原始描述 + 可选高级设置 + 服务端默认值”的结构化归一结果，而不是新增一张必填表单。创建接口原样保存 topic，并先写入 provisional Brief；原有一次 `outline.v2` 调用同时返回 Prompt 中明确检测到的字段、警告、resolved Brief 和 outlines，服务端按 `explicit_setting > prompt > default` 复算并同事务保存。MySQL `brief_json` 同时保存有效值、每字段来源和解析状态；大纲页展示系统理解和冲突警告，确认前修改 Brief 会使旧大纲失效。

本阶段同时完成 Course v1/v2 判别、确定性 v1 → v2 迁移、受众/水平/目标/先修/时长/风格/互动/附加要求契约，以及 SceneRole、误区/评估意图和可选 diagram 计划。旧课程无需清库、无需重新调用模型即可恢复；正常大纲路径不因 Brief 解析固定增加一次 LLM 调用。M7 只建立后续场景生成需要的语义上下文，不提前实现画布 Renderer 或互动 iframe。

**退出门**：只有主题、信息完整 Prompt、部分信息 Prompt 和设置冲突四类 fixture 均能得到可解释的字段值、来源与警告；同一原始描述按默认值和显式受众/目标生成的计划有可解释差异；Brief 与大纲同 revision 恢复，修改 Brief 不会遗留旧大纲；Prompt 注入不能越过 System Prompt/Schema；v1 fixture、MySQL 恢复和 M6 E2E 均通过。

**M7 退出门**：M7.0 六题输入、生成报告和逐场景 MHTML 已保存；四类 Brief fixture、Course v1/v2 兼容、MySQL 恢复和 M6 全量回归通过；同一主题在默认值与显式受众/目标下得到可解释差异。达到此门后才开始 M8。

## 12. M8：PPT 式只读幻灯片画布

M8 取代原 M7.2 的固定 React 模板方案。新生成的 slide 只有一种产品形态：固定 16:9、一次展示一个场景的 PPT 式页面，不再建设类 Markdown、纵向讲义或同课双视图。新内容在 `content.canvas` 中保存 `Slide`：固定 `viewportSize: 1000`、`viewportRatio: 0.5625`，页面由带稳定 id、绝对坐标、尺寸和样式的有限 PPTElement 组成。第一版只支持 `text/shape/line/code`，不加入图片检索、图表、音视频、复杂公式、动画或可执行 slide HTML。旧 `content.blocks` 继续由当前 Renderer 读取，但仅用于历史兼容。

生成仍只调用一次现有 scene 模型。与 OpenMAIC 一样，裁剪后的 `slide-content` Prompt 直接要求 LLM 返回背景和元素坐标；服务端执行 JSON/Schema、未支持元素过滤、默认值补齐、text 富文本净化、损坏元素丢弃和 id 分配，然后组装 `Slide`。不增加独立的语义计划、自动排版器或复杂坐标质量系统。Renderer 只负责等比缩放、四类元素分发和 fallback。

OpenMAIC 固定提交 `59adbef` 提供整条实现参照：[`slide-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/system.md) 和 [`user.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/user.md) 定义画布与视觉规则，[`pipeline-types.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/pipeline-types.ts)、[`scene-generator.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-generator.ts)、[`normalize.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/dsl/src/normalize.ts) 和 [`scene-builder.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-builder.ts) 串起响应、规范化和装配，[`SlideCanvas.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/renderer/src/SlideCanvas.tsx) 与 [`SlideElement.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/renderer/src/SlideElement.tsx) 负责渲染。本项目保留 AIAdapter、Zod、MySQL 和调用预算，裁掉上游媒体/编辑能力，并保留 MIT 许可和来源记录。

**M8 退出门**：mock fixture 覆盖四类元素并能保存、重启恢复和播放；2～3 个代表主题完成 DeepSeek 真实生成和 `1280×720` 人工视觉检查；新页面主次清楚、主要内容没有被裁掉，坏元素不会造成白屏；v1 课程仍能打开，M6 全量回归通过。移动端、平板和窄屏不阻塞退出。完成后才开始 M9。

## 13. M9：interactive/diagram 纵向闭环

M9 只实现 `interactive/diagram`：从 OpenMAIC 裁剪专用 Prompt、HTML 后处理、InteractiveRenderer 和 iframe 宿主，生成自包含 HTML/CSS/JavaScript；服务端只做完整文档、大小、外部依赖和消息契约等必要检查。课堂只用 `sandbox="allow-scripts"` 且注入禁止外部网络的 CSP，支持 ready、reset、completed、error 和固定 fallback。若 M8 还不能稳定生成和恢复页面，不进入互动开发。

可参考 OpenMAIC 的 [`interactive.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/dsl/src/interactive.ts)、[`diagram-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/diagram-content/system.md)、[`interactive-renderer.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/interactive-renderer.tsx)、[`InteractiveIframeHost.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/InteractiveIframeHost.tsx) 和 [`iframe.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/lib/utils/iframe.ts)。OpenMAIC 当前 iframe 还允许 forms/popups，本项目范围更小，安全配置不得原样复制，仍坚持只有 `allow-scripts`。

**M9 退出门**：`interactionMode=required` 的课程完成“生成 → MySQL 保存 → 课堂操作 → 重置 → 完成 → 刷新恢复”的 production Chromium E2E；恶意 fixture 不能访问主页面身份、存储或网络；失败不影响其他场景。

## 14. M10：单场景再生成与 v0.4 验收

允许 ready 场景携带 500 字以内意见进行事务化再生成。候选生成期间不改变 ready Course；提交前保留旧结果，失败、取消和 conflict 均不破坏课程。slide 再生成继续经过 M8 的同一 Prompt、规范化和 Slide 装配链；quiz 再生成经用户确认后，在替换场景的同一事务清理旧作答。最后使用 M7.0 的相同六题、Provider、模型、请求设置和 `1280×720` 视口完成 v0.3/v0.4 成对人工评价，并报告内容质量、视觉可读性、成本、延迟、完成率和修复率。

**M10 退出门**：AC-Q01～AC-Q11 全部有证据；M6 `pnpm verify:full` 继续通过；质量达到 M7.0 预先冻结并在候选生成前版本化的阈值。达到此门后才宣布 v0.4 完成。

## 15. M11：PPT 式幻灯片编辑器（可选）

M11 只在 M10/v0.4 已完成、M8 的 `Slide/PPTElement` 已稳定且用户再次确认范围后开始。第一批能力限于选择、拖拽、缩放、删除、文字编辑、撤销重做和 MySQL 保存；第二批再考虑复制粘贴、对齐吸附和图层。它复用 M8 的只读 Renderer，在同一 PPT 式页面上叠加编辑交互，不建立第二套页面格式，不反向改变 M8 生成契约，也不作为 MX 的前置条件。

可参考 OpenMAIC Editor 的三层边界：[`README.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/editor/README.md)、[`core/index.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/editor/src/core/index.ts)、[`EditableSlideCanvas.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/editor/src/react/EditableSlideCanvas.tsx) 和 [`EditableSlideCanvasWithUI.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/editor/src/ui/EditableSlideCanvasWithUI.tsx)。本项目用 MySQL revision/事务保存替代 OpenMAIC 的宿主状态与本地持久化方式。

## 16. M12：PPTX + interactive HTML 简化资源包（可选）

M12 只在 M10/v0.4 已完成、M8 slide 与 M9 interactive 均稳定且用户再次确认范围后开始。导出结果固定为一个 ZIP：根目录只放一个课程 PPTX，`interactive/` 目录只放按原始场景顺序命名的自包含 HTML，例如 `03_流程互动.html`。第一版不生成 manifest、README 或 assets 目录；互动页依赖的 CSS、JavaScript 和小型资源必须内联。PPTX 只写入 slide 场景并保持相对顺序，互动页面不尝试嵌入 PPTX。

可参考 OpenMAIC 的 [`lib/export/use-export-pptx.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/lib/export/use-export-pptx.ts) 中 PPTElement 到 PPTX 的映射、资源包组装、标题安全化和 `interactive/` 分包方式，以及其内置 [`packages/pptxgenjs`](https://github.com/THU-MAIC/OpenMAIC/tree/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/pptxgenjs)。固定提交按“第几个互动页”编号，本项目明确改为原始 `Scene.order`，不能原样复制该编号逻辑。本项目只复用 `text/shape/line/code` 子集和简单 ZIP 结构，不复制 `.maic.zip` manifest、导入协议、视频导出或完整媒体管线。

## 17. 共同硬边界

M7～M10 不加入 LangGraph、多智能体、多模态、RAG、媒体、code/simulation/game/3D widget 或任意学习者代码执行。M8 不实现直接编辑，M9 的 diagram 未稳定前不得增加第二类互动场景，M11/M12 不得被悄悄并入 v0.4 硬门。

## 18. MX：毕业论文延展



## 19. 风险登记与止损规则

| 风险 | 早期信号 | 止损措施 |
| --- | --- | --- |
| 范围膨胀 | M8 未稳定就并行开发互动、编辑器、导出、RAG 或 Agent | 严格按 M7 → M8 → M9 → M10，M11/M12 与额外能力不进入 v0.4 硬门 |
| 数据库先于领域模型扩张 | 页面和 API 直接拼 SQL | 强制 CourseRepository 与契约测试 |
| 长事务 | 模型调用期间占用数据库事务 | 使用登记操作和结果提交两个短事务 |
| 并发覆盖 | 迟到响应覆盖重试结果 | operation id + expectedRevision |
| Provider 漂移 | 模型名或服务地址写死 | 环境配置、启动校验、保存生成元数据 |
| 演示依赖网络 | 无 Key 就无法进入课堂 | mock 走同一数据库和生成链路 |
| 语音拖慢主线 | 调试集中在音色或兼容性 | TextOnly 为默认，BrowserSpeech 可关闭 |
| 生成脚本越权 | iframe 可访问网络、主页面或存储 | 关闭 interactive 入口，先修复 sandbox/CSP/消息边界 |
| 旧课程无法读取 | schemaVersion 2 直接替换 v1 | 停止 UI/Prompt 开发，先完成迁移与 fixture 回归 |
| 裁剪上游时牵入过多依赖 | 为一个 slide 同时引入媒体、编辑器、动效和存储包 | 只移植四类元素需要的类型、纯函数和 Renderer，记录来源 |
| 模型坐标不稳定 | 多个真实主题反复出现相同重叠、越界或超长正文 | 先缩小 Prompt/元素字段并调整示例；稳定复现后只补针对性规则 |
| 用视觉手段掩盖超载 | 依赖小字体、隐藏或画布内滚动才不溢出 | 回退 Prompt 中的可见内容预算，细节移入 narration |
| 质量提升不可证 | 只展示一个好看的课程 | M7.0 先冻结数据集、量表与阈值，再做成对评价 |
| 论文成为功能堆砌 | 延展没有唯一变量 | MX 一次只选择一个主问题 |

当前主分支无法启动、迁移不可重复、CourseSchema 可被绕过、密钥进入客户端、失败只能清库恢复或测试连续失效时，停止增加功能并先恢复基线。

## 20. 推荐的下一次开发迭代

当前 M7.0 已保留冻结的六题输入、6 门 MySQL 课程、生成元数据、失败样本和 28 份逐场景 MHTML，并保持 Prompt、Schema、Renderer、CSS 与 iframe 不变。下一次开发迭代直接进入 M7.1 CourseBrief、Course v2 和 outline v2；人工评分等 M8/M9/M10 形成同题 v0.4 课程后再做。不得提前开始 M8 画布、M9 互动或把移动端适配重新加入当前硬门。
