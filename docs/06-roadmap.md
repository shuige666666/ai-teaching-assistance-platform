# 06. 复刻实施路线图

> 文档状态：v0.2 设计基线  
> 适用范围：`ai-teaching-assistance-platform` 第一阶段复刻  
> 总目标：任何时候都保留一个可运行、可演示、可回退到 mock 的系统。

## 1. 实施结论

复刻不按 OpenMAIC 的目录逐项照搬，而按纵向闭环推进：**固定课程可浏览 → MySQL 可恢复 → 真实大纲 → 真实场景 → 播放与测验 → 完整验收**。数据库现在是基础能力，因此必须在真实模型接入前完成，不能等课程已经生成后再补持久化。

M1 是第一个可运行原型，M2～M6 共同组成 MVP。M6 完成时达到导师可以独立复现的“可运行系统”；interactive HTML、多智能体等能力进入 M7，不得反向阻塞基线。

**当前进度：M1、M2 已完成，M3 尚未开始。** 已实现能力与验证证据持续记录在 [07-development-status.md](07-development-status.md)，本文件其余 M3～M7 内容仍表示后续计划。

## 2. 统一完成定义

以下定义适用于 M1～M6 的实现任务；M0 只执行文档链接、术语和追踪一致性检查。

1. 代码已经进入正式调用链，不是孤立示例；
2. 正常路径能在 `AI_MODE=mock` 下复现；
3. 输入、模型 DTO、Course 和 API 响应具有 Zod Schema；
4. 数据变更通过 CourseRepository，页面不直接写 SQL 或伪造状态；
5. 数据库结构变化包含可重复执行的版本化迁移；
6. 至少有与风险相称的自动化测试；
7. `pnpm lint`、`pnpm test`、`pnpm build` 全部通过；
8. 文档、`.env.example` 和代码一致，不记录 Key、数据库密码、完整 Prompt 或原始响应。

每个里程碑保存验收记录，包含提交版本、运行命令、数据库迁移版本、通过场景、故障注入、遗留问题和演示截图。

## 3. 里程碑总览

| 里程碑 | 可演示结果 | 主要替换对象 | 建议投入 |
| --- | --- | --- | --- |
| M0 设计基线（已完成） | 六份设计文档形成统一方案 | 默认脚手架说明 | 1～2 天 |
| M1 固定数据闭环（已完成） | 从首页进入课堂并浏览含代码块的固定课程 | 空白脚手架 | 4～6 天 |
| M2 MySQL 持久化（已完成） | 重启应用后课程仍可查询和删除 | 内存仓储 | 4～6 天 |
| M3 双 Provider 大纲（代码完成，远端验收待 Key） | DeepSeek/百炼可切换生成并保存大纲 | 固定大纲 | 4～6 天 |
| M4 真实场景（代码完成，远端验收待 Key） | 逐场景生成、事务保存并隔离失败 | 固定场景 | 5～7 天 |
| M5 课堂运行时（下一开发步） | 自动播放、单选测验和可选浏览器语音 | 手工翻页 | 4～6 天 |
| M6 验收交付 | mock/DeepSeek/百炼配置均可回归 | 开发态系统 | 5～7 天 |
| M7 论文延展 | 完成一个可度量研究问题 | 无 | 视选题而定 |

建议投入是专注开发日。延期时先减少视觉装饰和扩展能力，不压缩 Schema、事务、错误恢复和测试。

## 4. M0：设计基线

### 目标与交付

固化范围、需求、架构、领域模型、生成管线和实施顺序。v0.2 已确认：单用户、功能复刻优先、静态代码块进入 MVP、DeepSeek/阿里百炼双配置、MySQL 唯一持久化、语音非必需。

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

## 7. M3：DeepSeek、阿里百炼与真实大纲

### 目标

用统一 AIAdapter 接入两个 OpenAI-compatible 平台，并用正式大纲接口替换固定大纲。

### 主要任务

实现 MockAIAdapter、OpenAICompatibleAdapter 和 ProviderConfigResolver。`AI_PROVIDER=deepseek|bailian` 选择一个服务端配置档；两个平台分别配置 Key、Base URL 和 Model，一次课程运行中不自动切换。

完成 `POST /api/courses/{courseId}/outline/generate`：应用服务加载 Course、登记 activeOperation、调用模型、解析 JSON、执行 Zod/语义门、必要时一次修复，并用 operation id + expectedRevision 事务保存。用户编辑和确认大纲通过 `PATCH /api/courses/{courseId}/outline`。

Provider、模型、promptVersion、requestId、耗时、upstreamCalls 和可用 token usage 写入 outlineGeneration。模型名与百炼地域 URL保持环境可配置，不能散落在业务代码中。

### 最小测试

- mock、DeepSeek、百炼适配器输出共用同一契约；
- Provider 配置缺失、Key/地域不匹配、401、429、超时得到稳定错误码；
- 代码围栏 JSON、纯 JSON、非法字段和场景数越界按规则处理；
- 模型成功但数据库事务失败时接口返回失败；
- 客户端 bundle 中不存在模型 Key 和 MySQL 凭据。

### 退出门

mock 必须确定性生成 3～5 项大纲。分别使用有效 DeepSeek 与百炼配置完成至少一次真实大纲生成，数据库元数据能够证明实际使用的平台和模型；失败时草稿仍可恢复。

截至 2026-08-24，mock、配置解析、共用远端适配器、短事务应用服务、编辑确认和数据库元数据均已通过自动化与浏览器验证。由于本地尚未配置 DeepSeek/百炼有效 Key，两家远端 smoke test 仍未完成，因此 M3 只标记为“代码完成”，尚未跨过完整退出门。

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

截至 2026-08-24，mock 下的 slide/quiz 生成、逐项进度、故障注入、失败隔离、单场重试、迟到响应保护、MySQL 增量恢复和浏览器课堂闭环均已通过。与 M3 相同，真实 DeepSeek/百炼调用仍等待有效 Key，因此这里标记为“代码完成”，不宣称远端验收完成。

## 9. M5：课堂播放、测验与可选语音

### 目标

让静态课程数据成为可运行课堂。语音不是交付前提，讲解文本和确定性状态机才是核心。

### 主要任务

实现 playback reducer 和 Action executor，支持 speech、pause。默认 TextOnlySpeechAdapter 显示讲解并按估算时长完成；BrowserSpeechAdapter 在用户启用且浏览器支持时使用 `speechSynthesis`。后续若需要云 TTS，只新增适配器，不改变 Action 或播放器。

quiz 在作答前进入 awaitingLearner，提交后展示对错和解析。课堂提供播放、暂停、继续、上一场景、下一场景和重新播放。切换课程或卸载页面时取消当前适配器、定时器和监听器。quiz_attempts 通过服务端保存；语音开关和非关键播放游标可留在 localStorage。

### 最小测试

- reducer 覆盖 idle、playing、paused、awaitingLearner、completed；
- pause/resume 不重复执行当前 Action；
- 快速切页后旧完成事件不污染新场景；
- TextOnly 模式能够完成整门课程；
- BrowserSpeech 不可用时自动回退；
- quiz 提交前不会自动跳过。

### 退出门

关闭语音时固定课程和真实课程均可播放到结束并完成测验；启用浏览器语音时能朗读，失败不会阻塞课程。连续播放两遍不产生重复语音、悬挂计时器或错位场景。

## 10. M6：系统验收与交付

### 目标

把“开发者机器上能跑”提升为“导师可以按文档启动数据库、应用并完成演示”。

### 主要任务

补齐领域单元测试、MySQL 仓储集成测试、API 集成测试和完整 E2E。建立 mock、DeepSeek、百炼三份配置检查，但 CI 默认只运行 mock，避免费用和网络不稳定。统一 loading、empty、error、conflict、cancelled 状态；整理 `.env.example`、迁移、测试数据、备份恢复、部署和故障排查说明。

逐项审计 FR、NFR 与 AC-01～AC-12。未实现项必须修复、正式缩小范围，或列入 M7，不能用“接口存在”代替行为验收。

### 验收矩阵

| 层次 | 重点证据 |
| --- | --- |
| 静态检查 | TypeScript、lint、依赖、服务端环境边界 |
| 单元测试 | Schema、装配器、reducer、错误分类、预算 |
| 数据库集成 | 迁移、CRUD、revision conflict、事务和级联删除 |
| API 集成 | mock 下课程、大纲、场景成功与失败响应 |
| 浏览器 E2E | 创建 → 大纲 → 场景 → 课堂 → 测验 → 重启恢复 |
| Provider 冒烟 | DeepSeek、百炼各一次受控真实调用，不进入默认 CI |
| 故障注入 | 非法 JSON、429、超时、DB 失败、迟到响应、无 TTS |

### 退出门

在干净环境中仅按 README 即可启动 MySQL、执行迁移、运行 mock 完整演示；两个 remote Provider 配置分别验证；质量命令通过；所有 MVP 验收标准都有证据。

## 11. M7：毕业论文延展

M7 只选择一个主问题，不建议同时引入互动脚本、RAG、多智能体和多模态。可选方向包括：

- 受控互动场景：先支持一种 simulation 或 code widget，生成完整 HTML/CSS/JS，在无 `allow-same-origin` 的 sandbox iframe 中运行，并研究运行错误检测与自动修复；
- 双 Provider 质量成本比较：在相同测试集和 Prompt 下比较 DeepSeek 与百炼模型的结构通过率、人工质量、延迟、token 和费用；
- 可恢复生成：比较整课重生成与逐场景事务恢复的成功率、浪费调用和恢复时间；
- 教学结构质量：比较基础 Prompt 与教学策略约束，使用结构合法率和人工量表；
- 文档增强：加入受控文档检索，比较有无来源上下文时的事实一致性。

若引入 LangGraph，它必须解决可验证的编排问题；“使用了多智能体框架”本身不是研究贡献。

## 12. 风险登记与止损规则

| 风险 | 早期信号 | 止损措施 |
| --- | --- | --- |
| 范围膨胀 | M1 前开始做 iframe、RAG 或 Agent | 非 MVP 任务全部移入 M7 |
| 数据库先于领域模型扩张 | 页面和 API 直接拼 SQL | 强制 CourseRepository 与契约测试 |
| 长事务 | 模型调用期间占用数据库事务 | 使用登记操作和结果提交两个短事务 |
| 并发覆盖 | 迟到响应覆盖重试结果 | operation id + expectedRevision |
| Provider 漂移 | 模型名或百炼地域 URL 写死 | 环境配置、启动校验、保存生成元数据 |
| 演示依赖网络 | 无 Key 就无法进入课堂 | mock 走同一数据库和生成链路 |
| 语音拖慢主线 | 调试集中在音色或兼容性 | TextOnly 为默认，BrowserSpeech 可关闭 |
| 论文成为功能堆砌 | 延展没有基线和指标 | M7 开工前先写实验问题与评价方案 |

当前主分支无法启动、迁移不可重复、CourseSchema 可被绕过、密钥进入客户端、失败只能清库恢复或测试连续失效时，停止增加功能并先恢复基线。

## 13. 推荐的第一次开发迭代

第一批提交严格限制为：领域类型与 Schema、合法 fixture、InMemoryCourseRepository、三个页面骨架、slide/quiz/CodeBlockRenderer，以及一条首页到课堂的冒烟测试。暂不安装数据库库、Provider SDK、LangGraph、富文本编辑器或媒体 SDK。

M1 通过后立即进入 MySQL 技术验证和 M2，不先接真实模型。这样模型输出从第一天起就进入最终持久化边界，后续问题可以明确定位在模型、Schema、应用服务、数据库事务、渲染或播放中的某一层。
