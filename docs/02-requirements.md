# 02. 系统需求规格说明

> 文档版本：0.4
> 前置文档：[01-scope.md](01-scope.md)  
> 状态说明：FR-001～FR-705 对应已完成的 v0.3；带 `Q` 或 `I` 前缀的需求对应计划中的 v0.4/M7，不能描述成当前已实现能力。

## 1. 系统目标

系统面向需要快速构建和体验小型 AI 课程的本地用户。v0.3 已验证“结构化 AI 内容可以被可靠生成、渲染、播放、保存和重试”；v0.4 在不破坏该闭环的前提下，让生成结果更贴合学习者和目标，并加入一种可隔离运行的互动场景。系统不宣称替代教师，也不把结构合法等同于事实正确或教学质量优秀。

## 2. 参与者

MVP 只有一个逻辑参与者：本地用户。

本地用户同时具有两种使用意图：

- **课程创建者**：输入主题、确认大纲、观察生成进度、重试失败场景；
- **课程学习者**：浏览课程、播放讲解、完成测验、重新打开历史课程。

系统不区分账号和权限，不提供多人协作。

## 3. 核心用例

### UC-01 创建课程

**前置条件**：应用已启动；使用真实模型时，服务端模型配置有效。  
**主流程**：

1. 用户在首页输入教学主题；
2. 用户选择 3～5 个场景，默认 4 个；
3. 系统校验输入，通过 `POST /api/courses` 在 MySQL 创建课程草稿；
4. 系统跳转到生成页面并请求课程大纲。

**异常流程**：输入为空或超长时在当前页面提示；模型不可用时保留草稿并提供重试。

### UC-02 审核课程大纲

**前置条件**：大纲生成成功。  
**主流程**：

1. 系统展示课程标题和有序场景；
2. 用户可以修改场景标题、教学目标和关键点；
3. 用户确认大纲；
4. 系统锁定本轮大纲快照并开始逐场景生成。

**异常流程**：大纲不满足 Schema 时不展示为成功结果；用户可以重新生成。

### UC-03 生成教学场景

**前置条件**：用户已确认大纲。  
**主流程**：

1. 系统按顺序处理每个 SceneOutline；
2. 每个场景独立显示生成状态；
3. 服务端在同一业务操作中校验生成结果并事务写入 MySQL；
4. 所有场景完成，或失败场景被明确标记后，用户可以进入课堂。

**异常流程**：单个场景失败不回滚其他成功场景；用户可以只重试该场景。

### UC-04 播放课程

**前置条件**：至少一个场景状态为 ready。  
**主流程**：

1. 用户进入课堂页面；
2. 系统加载课程并显示第一场景；
3. 用户开始播放，播放器依次执行当前场景的 Action；
4. 用户可以暂停、继续、上一页或下一页；
5. 到达末页后系统显示课程完成状态。

**异常流程**：用户未启用语音或浏览器语音不可用时，使用讲解文本和估算停留时间继续播放。

### UC-05 完成测验

**前置条件**：当前场景类型为 quiz。  
**主流程**：

1. 用户选择一个答案并提交；
2. 系统确定性判断答案；
3. 系统展示正确性和题目解析；
4. 用户继续下一场景。

测验判分不调用大模型。

### UC-06 管理历史课程

**前置条件**：MySQL 中存在课程记录。  
**主流程**：

1. 首页列出课程标题、状态和更新时间；
2. 用户重新打开 ready 或生成中的课程；
3. 用户可以删除课程；
4. 删除前要求确认，删除后由数据库外键或事务清理关联数据。

### UC-07 配置课程教学要求（v0.4 计划）

**前置条件**：用户正在创建新课程。
**主流程**：

1. 用户填写必需的教学主题；
2. 系统提供学习者水平、学习目标、先修知识、预计时长、教学风格和互动偏好；
3. 用户不展开设置时，服务端使用推荐默认值；
4. 系统把规范化后的 CourseBrief 与草稿一起保存，后续大纲、场景和再生成都从 MySQL 读取同一份要求。

**异常流程**：非法枚举、超长目标或先修知识被请求 Schema 拒绝；客户端不能在大纲生成接口临时覆盖已保存的 CourseBrief。

### UC-08 学习互动场景（v0.4 计划）

**前置条件**：课程包含一个 ready 的 `interactive/diagram` 场景。
**主流程**：

1. 用户进入互动场景，先看到固定 React fallback 和加载状态；
2. 沙箱 iframe 加载自包含 HTML 并报告 ready；
3. 用户点击节点或按步骤探索概念关系，可以重置；
4. iframe 报告 completed 后，播放器解除 learner pause，用户继续课程。

**异常流程**：加载超时、脚本异常或消息不合法时，主页面保持可用并显示 fallback；用户可以跳过或单独再生成该场景。

### UC-09 按意见再生成场景（v0.4 计划）

**前置条件**：目标场景已经 ready。
**主流程**：用户输入不超过 500 字的修改意见；服务端读取当前场景、大纲、CourseBrief 和课程上下文，生成候选结果；候选通过完整校验并事务提交后原位替换旧场景。

**异常流程**：生成、校验、运行预检、数据库提交或 revision 检查失败时，旧 ready 场景保持不变。

## 4. 功能需求

### 4.1 首页与课程草稿

| 编号 | 需求 |
|---|---|
| FR-001 | 首页必须提供主题输入框和创建按钮。 |
| FR-002 | 主题规范化后长度必须为 2～500 个字符。 |
| FR-003 | 用户可以选择 3～5 个场景，默认 4 个。 |
| FR-004 | 点击创建后，服务端必须生成 courseId 并把 draft 写入 MySQL，成功后客户端才能跳转。 |
| FR-005 | 重复点击创建按钮不能产生并发重复提交。 |
| FR-006 | 首页必须通过 `GET /api/courses` 显示 MySQL 中的历史课程及其状态。 |
| FR-007 | 用户必须能够重新打开和删除历史课程。 |

### 4.2 大纲生成

| 编号 | 需求 |
|---|---|
| FR-101 | 系统必须通过 `POST /api/courses/{courseId}/outline/generate` 生成并保存大纲。 |
| FR-102 | 响应必须包含 courseTitle 和 3～5 个 SceneOutline。 |
| FR-103 | SceneOutline.type 只能是 slide 或 quiz。 |
| FR-104 | SceneOutline.order 必须唯一且连续。 |
| FR-105 | 大纲写入 MySQL 前必须通过 Zod 和领域不变量校验。 |
| FR-106 | 用户必须能通过课程 API 编辑标题、教学目标和关键点，但不能编辑 id、order 和 type。 |
| FR-107 | 用户明确确认后才能开始场景生成。 |
| FR-108 | 大纲失败时必须保留 topic、courseId 和错误分类。 |

### 4.3 场景生成

| 编号 | 需求 |
|---|---|
| FR-201 | 每个大纲通过 `POST /api/courses/{courseId}/scenes/{outlineId}/generate` 独立生成并保存。 |
| FR-202 | 客户端第一版必须串行生成场景，避免并发、限流和状态同步同时复杂化。 |
| FR-203 | 服务端持久化场景前必须通过与场景类型匹配的 Schema。 |
| FR-204 | 服务端必须为生成结果装配本地 id、courseId、outlineId、order 和 Action。 |
| FR-205 | 模型产生的 narration 必须转换为 speech Action，模型不能决定持久化主键。 |
| FR-206 | 每次场景状态变化必须通过 CourseRepository 事务保存；生成成功和保存成功不可被 UI 混为一谈。 |
| FR-207 | 单场景失败必须记录错误，不能清除其他 ready 场景。 |
| FR-208 | 用户必须可以单独重试 failed 场景。 |
| FR-209 | 课程至少有一个 ready 场景时可以预览；正式 ready 要求全部场景 ready。 |

### 4.4 固定渲染器

| 编号 | 需求 |
|---|---|
| FR-301 | SceneRenderer 必须使用 scene.type 分派固定 React 组件。 |
| FR-302 | slide 必须支持标题、段落、要点列表、提示块和静态代码块。 |
| FR-303 | 代码块必须转义显示，支持 language、code 和可选 caption，不允许执行代码。 |
| FR-304 | quiz 首版只支持单选题，每题必须有 2～4 个选项。 |
| FR-305 | 未知场景类型或不匹配 content 不能导致白屏，必须显示可诊断错误。 |
| FR-306 | 渲染器不得执行模型返回的 HTML、脚本或动态组件代码。 |

### 4.5 播放与可选语音

| 编号 | 需求 |
|---|---|
| FR-401 | 播放器状态至少包括 idle、playing、paused、awaitingLearner 和 completed。 |
| FR-402 | 播放器必须顺序消费当前场景 Action，不得从 React 渲染副作用隐式推进。 |
| FR-403 | speech Action 必须先显示讲解文本，并通过可替换 SpeechAdapter 执行。 |
| FR-404 | 默认 TextOnlySpeechAdapter 按文本估算时长；可选 BrowserSpeechAdapter 使用 Web Speech API。 |
| FR-405 | pause Action 的 learner 原因必须等待用户操作，timed 原因按 durationMs 等待。 |
| FR-406 | 上一页、下一页必须重置当前动作游标，并取消当前 SpeechAdapter。 |
| FR-407 | quiz 未提交时，自动播放必须进入 awaitingLearner。 |
| FR-408 | 页面卸载时必须清理 SpeechAdapter、计时器和 AbortController。 |
| FR-409 | quiz 进入页面后应立即允许选择和提交，不以前置播放讲解作为作答条件；全部题目保存成功后完成当前场景。 |

### 4.6 持久化与恢复

| 编号 | 需求 |
|---|---|
| FR-501 | MySQL 必须是 Course 聚合根的唯一事实来源，浏览器不得维护第二份课程数据库。 |
| FR-502 | courses 记录必须包含 schemaVersion、revision、createdAt 和 updatedAt。 |
| FR-503 | CourseRepository 只能在服务端运行，写入前和读取后都必须执行共享 Schema 校验。 |
| FR-504 | 聚合更新必须使用事务和 expectedRevision；版本冲突返回 `COURSE_CONFLICT`。 |
| FR-505 | 生成页面刷新后必须通过 `GET /api/courses/{courseId}` 恢复课程和场景状态。 |
| FR-506 | 课堂页面刷新后必须从同一课程 API 加载，不依赖只存在于 React 内存的对象。 |
| FR-507 | 删除课程必须是显式操作，并事务清理相关测验记录。 |
| FR-508 | 数据库结构变更必须使用版本化迁移，不能依靠运行时自动猜测。 |
| FR-509 | localStorage 只允许保存主题偏好、语音开关等轻量 UI 状态，不作为课程事实来源。 |

### 4.7 错误与状态反馈

| 编号 | 需求 |
|---|---|
| FR-601 | API 必须返回统一错误结构：code、message、retryable、requestId。 |
| FR-602 | UI 必须区分配置/认证错误、限流/网络错误、模型输出错误和内部错误。 |
| FR-603 | 重试按钮只能对 retryable 错误启用；配置错误必须引导用户修正环境。 |
| FR-604 | 生成过程中必须展示当前阶段、场景序号和已完成数量。 |
| FR-605 | 用户离开生成页面时必须能取消未完成的浏览器请求。 |

### 4.8 模型 Provider

| 编号 | 需求 |
|---|---|
| FR-701 | MVP 必须支持 `mock` 与 `deepseek` 两种 Provider 配置；`bailian` 为非阻塞兼容扩展。 |
| FR-702 | DeepSeek 通过统一 AIAdapter 调用 OpenAI-compatible 接口，mock 与 remote 共用后续契约。 |
| FR-703 | 一次课程生成运行固定使用一个 Provider 和模型，不在场景间自动切换。 |
| FR-704 | Provider、模型名、promptVersion、requestId、耗时和可用 token usage 必须作为生成元数据保存。 |
| FR-705 | DeepSeek 的 API Key、Base URL 和 Model 必须由服务端配置，不能由浏览器覆盖。 |

### 4.9 课程质量上下文（v0.4 计划）

| 编号 | 需求 |
|---|---|
| FR-Q101 | `POST /api/courses` 必须接受可选 CourseBrief；缺省字段由服务端补齐推荐值并持久化。 |
| FR-Q102 | CourseBrief 必须包含 learnerLevel、learningGoal、prerequisites、durationMinutes、teachingStyle 和 interactionMode。 |
| FR-Q103 | 首页仍只要求 topic；高级设置必须可折叠，不能增加首次使用阻力。 |
| FR-Q104 | 大纲和场景生成只能使用 MySQL 中已校验的 CourseBrief，客户端不得在生成请求中覆盖。 |
| FR-Q105 | SceneOutline v2 必须包含教学场景角色；误区、评估重点和 widgetType 按场景需要出现。 |
| FR-Q106 | 场景 Prompt 必须接收有长度上限的已覆盖关键点、待覆盖目标和前文摘要，不能无限累计整课原文。 |
| FR-Q107 | slide 必须继续区分可见短内容和 narration，不得通过生成长段落伪造课程深度。 |
| FR-Q108 | 系统必须生成可机器检查的密度、重复、关键点覆盖和 quiz—objective 对齐报告；该报告不宣称事实正确。 |

### 4.10 丰富固定渲染（v0.4 计划）

| 编号 | 需求 |
|---|---|
| FR-Q201 | SlideBlock 在保留现有类型的基础上增加 steps、comparison 和 table。 |
| FR-Q202 | steps 包含 2～6 个有序步骤；comparison 只比较两个对象的同维度项目；table 限制为短文本小表格。 |
| FR-Q203 | 新 Block 必须由固定 React 组件渲染，不能包含模型 CSS、React、HTML 或可执行代码。 |
| FR-Q204 | 渲染器必须分别在桌面和窄屏保持可读，长内容有明确折行或滚动策略。 |
| FR-Q205 | 未知 Block 或版本不兼容时必须显示可诊断 fallback，不能导致整个课堂白屏。 |

### 4.11 互动场景（v0.4 计划）

| 编号 | 需求 |
|---|---|
| FR-I101 | Scene 判别联合增加 `interactive`，v0.4 的 widgetType 只能是 `diagram`。 |
| FR-I102 | `interactionMode=off` 时不得生成互动场景；`auto` 时最多一个；`required` 时必须恰好一个。 |
| FR-I103 | 互动模型输出必须包含完整自包含 HTML、固定 fallback 和 `runtimeContractVersion:1`，不得包含实体 ID。 |
| FR-I104 | HTML 最大 100 KiB，禁止外部 script/link、子 iframe、object/embed、meta refresh、下载、表单提交、外部 URL、Worker/WebAssembly 和持续执行调度器。 |
| FR-I105 | InteractiveRenderer 必须用 iframe `srcDoc` 渲染，sandbox 只能包含 `allow-scripts`。 |
| FR-I106 | iframe CSP 必须拒绝外部资源、连接、Worker、对象、子 frame、base URI 和表单提交，并且不允许 `unsafe-eval`；脚本检查另行拒绝 window.open 和 location 导航。 |
| FR-I107 | 父子页面消息必须经过来源检查和 Zod 校验，只支持 ready、reset、completed 和 error 最小协议。 |
| FR-I108 | 互动页 5 秒未 ready、运行报错或消息非法时必须显示固定 fallback，不能影响课堂导航和其他场景。 |
| FR-I109 | 互动场景使用 speech + learner pause；合法 completed 事件解除等待，切页或卸载必须拒绝迟到事件。 |
| FR-I110 | 互动 HTML、fallback、生成元数据和失败状态必须通过 CourseRepository 持久化并可在刷新后恢复。 |

### 4.12 单场景再生成与质量评价（v0.4 计划）

| 编号 | 需求 |
|---|---|
| FR-Q301 | 用户可以对 ready 场景提交不超过 500 字的修改指令；失败场景继续使用原有重试流程。 |
| FR-Q302 | 再生成必须读取现有场景作为受限 baseline，但模型不能修改 courseId、outlineId、order、status 或实体 ID。 |
| FR-Q303 | 新场景只有在解析、Schema、语义/安全门和 MySQL expectedRevision 提交全部成功后才能替换旧场景。 |
| FR-Q304 | 再生成失败、取消或冲突时必须保留旧 ready 场景和其他场景。 |
| FR-Q305 | 项目必须保存固定评价集、量表版本、Prompt/模型元数据和汇总分数，评价产物不得包含真实用户隐私。 |
| FR-Q306 | v0.4 退出前必须在同一模型配置下与 v0.3 做成对人工比较，并同时报告质量、延迟、token、修复和完成率。 |
| FR-Q307 | ready 场景再生成期间不改变 Course.status 或持久化 activeOperation；最终用 expectedRevision 原子替换。quiz 再生成必须经用户确认，并在同一事务删除旧 sceneId 的作答。 |

## 5. 非功能需求

### 5.1 安全与隐私

| 编号 | 需求 |
|---|---|
| NFR-SEC-01 | 模型 API Key 和 MySQL 凭据只能由服务端代码读取。 |
| NFR-SEC-02 | 客户端请求不得携带、显示或持久化模型 Key、数据库密码。 |
| NFR-SEC-03 | 日志不得记录 Key、完整 Prompt、完整模型原始响应或用户隐私数据。 |
| NFR-SEC-04 | 模型输出作为不可信输入处理；v0.3 禁止执行 HTML/JavaScript，v0.4 仅允许通过 FR-I101～110 的隔离路径执行。 |
| NFR-SEC-05 | `.env.local` 必须被 Git 忽略。 |
| NFR-SEC-06 | 无登录版本只能部署在本机或受信任网络，不能作为公开多用户服务暴露。 |
| NFR-SEC-07 | 数据库查询必须参数化或由受控 ORM 构造，不得拼接用户输入形成 SQL。 |
| NFR-SEC-08 | 互动 iframe 不得拥有同源权限、主页面 DOM、Cookie、localStorage 或外部网络访问能力。 |
| NFR-SEC-09 | 主页面必须按 `event.source` 绑定具体 iframe，并对所有 postMessage 数据执行严格 Schema。 |
| NFR-SEC-10 | 互动安全回归必须包含恶意 HTML fixture，验证主页面状态和凭据未被读取或修改。 |

### 5.2 可靠性

| 编号 | 需求 |
|---|---|
| NFR-REL-01 | 任何模型响应都必须先解析、再校验、后持久化。 |
| NFR-REL-02 | 400、401、403、422 类错误不得自动重试。 |
| NFR-REL-03 | 网络超时、429 和 5xx 最多自动重试 2 次，并采用退避。 |
| NFR-REL-04 | 单个模型请求最多进行 1 次格式修复调用。 |
| NFR-REL-05 | 一次自动生成运行最多发出 `1 + sceneCount` 个业务请求；单个 API 请求最多调用上游模型 4 次，不能无限循环。 |
| NFR-REL-06 | mock 模式必须完全确定性且不访问外部网络。 |
| NFR-REL-07 | 大纲或场景只有在 MySQL 事务提交成功后才能向客户端报告持久化成功。 |
| NFR-REL-08 | v1 课程必须通过确定性迁移读取，升级不得要求用户清空数据库。 |
| NFR-REL-09 | 互动运行失败不能改变 Course 内容或播放器的其他场景状态。 |
| NFR-REL-10 | 互动生成仍遵守单请求调用硬上限，不能因 HTML 运行失败进入无限模型修复。 |

### 5.3 可用性与兼容性

| 编号 | 需求 |
|---|---|
| NFR-UX-01 | 本地 UI 操作应在 200ms 内给出视觉反馈；模型耗时不计入该指标。 |
| NFR-UX-02 | 模型请求开始后 500ms 内显示 loading/progress 状态。 |
| NFR-UX-03 | 所有主要按钮支持键盘聚焦，并提供可读文本或 aria-label。 |
| NFR-UX-04 | MVP 支持最新稳定版 Chrome 和 Edge。 |
| NFR-UX-05 | 1280×720 及更大桌面视口必须完整可用。 |
| NFR-UX-06 | 互动场景必须支持键盘操作、可见焦点、最小 44×44px 操作目标和重置入口。 |
| NFR-UX-07 | iframe 加载、可操作、完成和失败状态必须对用户可见，不能用空白区域代表等待。 |

### 5.4 可维护性与可测试性

| 编号 | 需求 |
|---|---|
| NFR-MNT-01 | domain 层不得依赖 React、Next.js 或具体模型 SDK。 |
| NFR-MNT-02 | API、客户端 DTO 和 MySQL Repository 共享同一套领域 Schema。 |
| NFR-MNT-03 | AI 适配器、存储仓储和语音接口必须可替换为测试实现。 |
| NFR-MNT-04 | 业务方法新增时使用简洁中文注释说明职责和关键防御场景。 |
| NFR-MNT-05 | 每个里程碑结束时同步更新 README 和相关设计文档。 |
| NFR-MNT-06 | 每种新 Scene/Block 必须同时具有 Schema、模型 DTO、装配、Renderer、fixture 和测试。 |
| NFR-MNT-07 | LangGraph、多智能体、多模态与 RAG 不得成为 M7 的隐式依赖。 |

## 6. 验收场景

### 场景 A：无网络演示

**Given** `AI_MODE=mock` 且测试 MySQL 中没有历史数据  
**When** 用户输入“二叉树遍历”并确认大纲  
**Then** 系统生成 3～5 个场景，进入课堂，slide 和 quiz 均可操作，刷新后课程仍存在。

### 场景 B：非法模型输出

**Given** 模型返回缺少 content 或 order 重复的 JSON  
**When** 生成接口处理响应  
**Then** Schema/领域校验失败，不保存坏数据，接口返回 `INVALID_MODEL_OUTPUT`，用户可以重试。

### 场景 C：中间场景失败

**Given** 场景 1 已成功、场景 2 返回 429  
**When** 自动重试耗尽  
**Then** 场景 1 保持 ready，场景 2 标记 failed，后续可单独重试。

### 场景 D：未启用语音或浏览器无语音能力

**Given** 语音开关关闭或 `window.speechSynthesis` 不可用  
**When** 播放器执行 speech  
**Then** 讲解文本仍可见，播放器使用估算时间推进，不产生未处理异常。

### 场景 E：认证配置错误

**Given** `AI_MODE=remote` 且 Key 无效  
**When** 用户生成大纲  
**Then** 系统返回不可自动重试的配置/认证错误，草稿仍可再次打开，客户端不显示 Key。

### 场景 F：可选 Provider 扩展

**Given** 后续确有第二 Provider 的研究或部署需求<br>
**When** 操作者启用已有百炼兼容档或接入其他 OpenAI-compatible 服务<br>
**Then** 复用同一 AIAdapter、生成契约和元数据结构；该场景不作为当前 MVP 验收条件。

### 场景 G：默认课程质量上下文（v0.4）

**Given** 用户只填写“TCP 拥塞控制”且不展开课程设置<br>
**When** 系统创建草稿并生成大纲<br>
**Then** MySQL 中保存规范化 CourseBrief，Prompt v2 使用初学者、15 分钟、案例式和自动互动默认值，刷新后这些值不改变。

### 场景 H：互动脚本异常（v0.4）

**Given** 互动 HTML 尝试访问外部网络或运行时抛出异常<br>
**When** 课堂加载该场景<br>
**Then** CSP/sandbox 阻止越界能力，主页面显示 fallback 与错误状态，其他场景仍可播放，用户可以跳过或再生成。

### 场景 I：再生成失败（v0.4）

**Given** 一个 ready 场景已经可以播放<br>
**When** 用户要求增加案例，但候选输出未通过校验或提交时发生 revision conflict<br>
**Then** 原 ready 场景保持可用，接口返回稳定错误，刷新后数据库中不存在半替换结果。

## 7. 需求追踪

| 范围目标 | 主要需求 | 路线图 |
|---|---|---|
| 固定数据与固定渲染器 | FR-301～306 | M1 |
| MySQL 课程创建、历史与恢复 | FR-001～007、FR-501～509 | M2 |
| DeepSeek 与真实大纲 | FR-101～108、FR-601～605、FR-701～705 | M3 |
| 逐场景生成与失败隔离 | FR-201～209 | M4 |
| 课堂、测验和可选语音 | FR-401～408 | M5 |
| 可验收交付 | 全部 NFR、AC-01～12 | M6 |
| 质量上下文、Prompt v2 与丰富静态内容 | FR-Q101～205 | M7.1～M7.2 |
| 受控互动场景 | FR-I101～110、NFR-SEC-08～10 | M7.3 |
| 单场景再生成与质量验收 | FR-Q301～307 | M7.4 |
| 单一可度量研究问题 | 从 M7 数据中另行立项 | M8 |

当需求编号或范围发生变化时，必须同步更新 [01-scope.md](01-scope.md)、[03-architecture.md](03-architecture.md)、[06-roadmap.md](06-roadmap.md) 和 [09-v0.4-quality-and-interaction-plan.md](09-v0.4-quality-and-interaction-plan.md)。
