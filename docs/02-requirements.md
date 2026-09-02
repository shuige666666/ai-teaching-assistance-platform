# 02. 系统需求规格说明

> 文档版本：0.4
> 前置文档：[01-scope.md](01-scope.md)  
> 状态说明：FR-001～FR-705 对应已完成的 v0.3；FR-Q101～FR-Q117 的 M7.1 部分已实现并通过 MySQL 与 Chromium 回归，其余 `Q` 与 `I` 需求仍对应 M8～M10 计划，不能提前描述成已实现能力。

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
2. 用户选择 4～8 个场景，默认 5 个；在大纲页选择是否需要互动，默认关闭；
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

1. 用户填写必需的教学主题或自然语言课程描述；
2. 系统提供可折叠的受众、学习者水平和学习目标等高级设置，用户可以完全不填写；
3. 创建接口原样保存用户描述，并以“显式设置 + 服务端默认值”保存 provisional CourseBrief，不为解析描述增加独立模型调用；
4. `outline.v2` 在原有一次大纲调用中识别描述里明确出现的受众、难度、学习结果和附加约束，并同时生成大纲；
5. 服务端独占执行“显式设置 > 描述字段 > 默认值”合并，把 resolved Brief、每字段来源、警告和大纲在同一事务中保存；后续场景和再生成只从 MySQL 读取这份已解析要求；
6. 大纲页展示“系统理解的课程要求”，用户可在确认前纠正；修改后旧大纲失效并重新生成。

**异常流程**：非法枚举、超长目标或先修知识被请求 Schema 拒绝；描述与高级设置冲突时高级设置生效并显示警告；含糊描述只补确定性默认值，不允许模型伪造字段来源；客户端不能在大纲生成接口临时覆盖已保存的 CourseBrief。

### UC-08 学习互动场景（v0.4 计划）

**前置条件**：课程包含一个 ready 的 `interactive` 场景。
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
| FR-003 | 用户可以选择 4～8 个场景，默认 5 个。 |
| FR-004 | 点击创建后，服务端必须生成 courseId 并把 draft 写入 MySQL，成功后客户端才能跳转。 |
| FR-005 | 重复点击创建按钮不能产生并发重复提交。 |
| FR-006 | 首页必须通过 `GET /api/courses` 显示 MySQL 中的历史课程及其状态。 |
| FR-007 | 用户必须能够重新打开和删除历史课程。 |

### 4.2 大纲生成

| 编号 | 需求 |
|---|---|
| FR-101 | 系统必须通过 `POST /api/courses/{courseId}/outline/generate` 生成并保存大纲。 |
| FR-102 | 响应必须包含 courseTitle 和与请求数量一致的 4～8 个 SceneOutline。 |
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
| FR-Q101 | `POST /api/courses` 必须接受原始 `topic` 和可选 `briefOverrides`；`topic` 必须按用户提交内容原样持久化，不能被模型解析结果覆盖。 |
| FR-Q102 | CourseBrief 必须包含 audience、learnerLevel、learningGoal、prerequisites、durationMinutes、teachingStyle、interactionMode 和 additionalRequirements。 |
| FR-Q103 | 首页仍只要求 topic；高级设置必须可折叠且字段可选，未出现的字段不能被标记为用户显式设置。 |
| FR-Q104 | 创建阶段必须以显式设置和服务端默认值保存 provisional CourseBrief；大纲解析完成后，场景生成与再生成只能使用 MySQL 中同 revision 的 resolved CourseBrief。 |
| FR-Q105 | SceneOutline v2 必须包含教学场景角色；误区、评估重点和 widgetType 按场景需要出现。 |
| FR-Q106 | 场景 Prompt 必须接收有长度上限的已覆盖关键点、待覆盖目标和前文摘要，不能无限累计整课原文。 |
| FR-Q107 | slide 必须继续区分可见短内容和 narration，不得通过生成长段落伪造课程深度。 |
| FR-Q108 | 系统必须继续机器检查必需目标覆盖、明显重复、quiz 答案索引与 objective 对齐；这些结构信号不宣称事实正确或页面一定美观。 |
| FR-Q109 | `scene-slide.v2` 必须基于 CourseBrief、SceneOutline 和有上限的课程上下文，直接返回背景与带坐标的有限 PPTElement；不得生成课程实体 id、状态、revision、Action、React 组件或可执行 slide HTML。 |
| FR-Q110 | slide 响应解析失败、关键字段非法或规范化后没有可显示元素时，可以进入现有一次 repair；repair 与传输重试继续共享单请求最多四次上游调用预算，不增加自动排版或模型评审循环。 |
| FR-Q111 | `outline.v2` 只能提取原始描述中明确出现的教学要求，不能仅按学科难度推断受众、水平或用户偏好。 |
| FR-Q112 | CourseBrief 字段合并优先级必须固定为 `explicit_setting > prompt > default`；显式空数组与字段缺失必须保持不同语义。 |
| FR-Q113 | 正常路径下，Prompt 字段检测、解析警告和 outlines 必须由同一次 `outline.v2` 结构化响应返回，不增加独立 LLM 解析调用；模型不得重复回传服务端可确定计算的 resolved CourseBrief。 |
| FR-Q114 | 服务端必须按固定优先级独占计算 resolved CourseBrief；最终 Brief、来源、警告和大纲必须同事务提交。 |
| FR-Q115 | 每个 Brief 字段必须持久化 `explicit_setting`、`prompt` 或 `default` 来源；设置冲突、描述含糊和范围过宽必须形成可展示的结构化警告。 |
| FR-Q116 | 用户在大纲确认前修改 resolved Brief 时，新值必须作为显式设置保存并使旧大纲失效；M7.1 不支持场景生成后直接修改整课 Brief。 |
| FR-Q117 | 原始 topic 只能作为待解析数据进入 User Prompt，其中的指令不得覆盖 System Prompt、输出 Schema、字段优先级或安全校验。 |

### 4.10 PPT 式只读幻灯片画布（M8 已实现）

| 编号 | 需求 |
|---|---|
| FR-Q201 | 新生成 slide 必须在 `content.canvas` 中保存与 OpenMAIC 同构的 `Slide`：`viewportSize=1000`、`viewportRatio=0.5625`、背景、主题和带稳定 id 的绝对坐标元素。这里的 canvas 是逻辑坐标容器，不是 HTML `<canvas>`。 |
| FR-Q202 | M8 首版只支持 `text/shape/line/code` 四类 PPTElement。模型可以直接返回 left、top、width、height、rotate 和样式，但不能控制元素 id、Course/Scene 标识、状态、revision 或 Action。 |
| FR-Q203 | `scene-slide.v2` 应从 OpenMAIC 的 `slide-content` Prompt 裁剪：保留 1000 × 562.5 画布、对齐、留白、字号、视觉层级和“幻灯片不是讲稿”等规则，删除图片、视频、图表、复杂公式及其他未实现元素。 |
| FR-Q204 | 通用只读 SlideCanvas 必须在 `1280×720` 及更大桌面视口等比缩放 16:9 逻辑画布并完整展示主要内容；M8～M10 不要求为移动端、平板或窄屏实现专门重排。 |
| FR-Q205 | `content.canvas` 是当前 Course v5 的唯一 slide 表达；v4 课程只对 Quiz 的 `correctOptionId` 执行无损读取升级，v1～v3 保留但隐藏并明确拒绝。未知或损坏的模型元素应在规范化时局部丢弃，不能导致整个课堂白屏。 |
| FR-Q206 | 服务端必须对模型元素执行轻量规范化：过滤未支持类型，补齐必要默认值，拒绝非有限坐标、非正尺寸和关键字段缺失，净化 text 富文本，并为保留元素分配 id；若最终元素为空则按场景生成失败处理。 |
| FR-Q207 | 展示字体只用于短标题或关键结论，关键正文和要点使用无衬线字体且不得低于 16px 等效字号；不能靠缩小、隐藏、画布外元素或内部滚动规避内容超载。 |
| FR-Q208 | M8 使用 3 个代表主题做 DeepSeek 真实生成，并以固定桌面视口 MHTML 供人工检查标题、正文、视觉关系和留白；不建立 PNG 档案或自动美学评分。 |
| FR-Q209 | 浏览器测试证明 16:9 等比缩放、`text/shape/line/code` 可渲染、主要内容没有被容器裁掉；移动端和窄屏视觉档案不属于 M8～M10 硬门。 |
| FR-Q210 | Course v4 slide 只采用 `content.canvas` 下的 PPT 式 `Slide/PPTElement` 表达；系统不同时提供新的类 Markdown、纵向讲义或同课第二套 Renderer，旧 block 路径不再读取。 |
| FR-Q211 | PPT 式页面必须执行统一视觉基线：四周安全边距、短标题与副标题层级、可选标题强调线、等宽卡片/步骤、稳定列间距和简洁要点；页面外层阴影与圆角只属于 Web 播放 chrome，不写入导出画布。 |
| FR-Q212 | 每张 slide 必须在 PPT 画布内包含一个 `textType=title` 标题；网页外层只保留场景编号等元信息，不能把未来导出所需标题放在画布外。 |

### 4.11 互动场景（M9）

| 编号 | 需求 |
|---|---|
| FR-I101 | Scene 判别联合增加 `interactive`，widgetType 支持 `diagram/simulation/game/code`，分类用于选择 Prompt，不锁定玩法。 |
| FR-I102 | 大纲页提供不需要/需要互动两项，默认 `off`，开启为 `required`。关闭时为 0 个；开启时 4 场景为 1 个、5～6 场景为 1～2 个、7～8 场景为 1～3 个。至少 2 个 slide、1 个 quiz，首场为 slide，互动不连续。`auto` 仅保留内部枚举，不开放 UI，最多按同档上限生成。 |
| FR-I103 | 模型直接输出完整 HTML 和 scene-meta 讲解元数据，服务端装配 fallback、runtimeContractVersion:1 与实体 ID。 |
| FR-I104 | HTML 注入后最大 256 KiB，允许外部脚本、样式与网络；不开放子 iframe、object/embed、下载和表单提交。 |
| FR-I105 | InteractiveRenderer 必须用 iframe `srcDoc` 渲染，sandbox 只能包含 `allow-scripts`。 |
| FR-I106 | iframe CSP 允许 HTTP(S) 资源/连接、动态执行与 blob Worker，禁止对象、子 frame、base URI 和表单提交；sandbox 不开放弹窗或顶层导航。 |
| FR-I107 | 父子页面消息必须经过来源检查和 Zod 校验，只支持 ready、reset、completed、error 及防止 READY 竞态的 ping 最小协议，忽略无关库消息。 |
| FR-I108 | 互动页 30 秒未 ready、未处理运行错误或已识别协议消息非法时必须显示固定 fallback，不能影响课堂导航和其他场景。 |
| FR-I109 | 互动场景使用 speech + learner pause；合法 completed 事件解除等待，切页或卸载必须拒绝迟到事件。 |
| FR-I110 | 互动 HTML、fallback、生成元数据和失败状态必须通过 CourseRepository 持久化并可在刷新后恢复。 |

### 4.12 单场景再生成与需求验收（M10 当前范围）

| 编号 | 需求 |
|---|---|
| FR-Q301 | 用户可以对 ready 场景提交不超过 500 字的修改指令；失败场景继续使用原有重试流程。 |
| FR-Q302 | 再生成必须读取现有场景作为受限 baseline，但模型不能修改 courseId、outlineId、order、status 或实体 ID。 |
| FR-Q303 | 新场景只有在解析、Schema、slide 规范化或互动安全边界，以及 MySQL expectedRevision 提交全部成功后才能替换旧场景。 |
| FR-Q304 | 再生成失败、取消或冲突时必须保留旧 ready 场景和其他场景。 |
| FR-Q305 | 项目必须保留固定评价集、Prompt/模型元数据、生成事实和固定视口视觉证据；评价产物不得包含真实用户隐私。人工量表和汇总分数不是当前 v0.4 必需产物。 |
| FR-Q306 | v0.4 退出前必须由项目负责人确认新版 slide 满足已确定的课堂页面需求；v0.3 仅作为历史参考，不要求与 v0.4 做成对人工比较。 |
| FR-Q307 | ready 场景再生成期间不改变 Course.status 或持久化 activeOperation；最终用 expectedRevision 原子替换。quiz 再生成必须经用户确认，并在同一事务删除旧 sceneId 的作答。 |

### 4.13 PPT 式编辑与简化资源包（M11/M12 可选）

| 编号 | 需求 |
|---|---|
| FR-X101 | M11 编辑器必须直接读取并更新 M8 的 `Slide/PPTElement`，复用同一只读 SlideCanvas 作为绘制层，不创建另一份编辑器专用页面格式。 |
| FR-X102 | M11 第一批能力限于选择、拖拽、缩放、删除、文字编辑、撤销重做和基于 expectedRevision 的 MySQL 保存；冲突或保存失败必须保留原版本。 |
| FR-X103 | M12 导出包固定为一个 ZIP：根目录一个课程 PPTX，`interactive/` 下按 `Scene.order` 保存自包含 HTML；不额外生成 manifest、README 或 assets 目录。 |
| FR-X104 | PPTX 只写入 slide 场景并保持其相对顺序；互动 HTML 文件名必须包含补零后的原始场景序号和安全化标题，例如 `03_流程互动.html`。 |
| FR-X105 | M12 再确认外部依赖的导出策略；当前互动页允许 CDN，不承诺单个 HTML 离线执行。 |
| FR-X106 | M11/M12 不属于 M7～M10/v0.4 退出门；只有 M10/v0.4 已完成且用户再次确认范围后，才进入实现和独立验收。 |

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
| NFR-SEC-08 | 互动 iframe 不得拥有同源权限或读取主页面 DOM、Cookie、localStorage；网络可用，不能视为防泄漏隔离。页内仅提供内存存储兼容。 |
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
| NFR-REL-06 | mock 生成必须完全确定性且不访问模型网络；基础 fixture 原生执行，显式运行 Python 练习时仍需下载 Pyodide。 |
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
| NFR-UX-08 | M7～M10 不承诺小于 1280px 的窄屏、平板或移动端适配；现有页面在这些视口的表现仅为 best-effort，不阻塞开发与退出。 |

### 5.4 可维护性与可测试性

| 编号 | 需求 |
|---|---|
| NFR-MNT-01 | domain 层不得依赖 React、Next.js 或具体模型 SDK。 |
| NFR-MNT-02 | API、客户端 DTO 和 MySQL Repository 共享同一套领域 Schema。 |
| NFR-MNT-03 | AI 适配器、存储仓储和语音接口必须可替换为测试实现。 |
| NFR-MNT-04 | 业务方法新增时使用简洁中文注释说明职责和关键防御场景。 |
| NFR-MNT-05 | 每个里程碑结束时同步更新 README 和相关设计文档。 |
| NFR-MNT-06 | 每种新 Scene 或新增 PPTElement 子集必须同时具有 Schema、模型输入契约、装配、Renderer、fixture 和最小主链测试。 |
| NFR-MNT-07 | LangGraph、多智能体、多模态与 RAG 不得成为 M7～M10 的隐式依赖。 |

## 6. 验收场景

### 场景 A：无网络演示

**Given** `AI_MODE=mock` 且测试 MySQL 中没有历史数据  
**When** 用户输入“二叉树遍历”并确认大纲  
**Then** 系统生成 4～8 个场景，进入课堂，slide、quiz 与已开启的互动均可操作，刷新后课程仍存在。

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
**Then** 原始 topic 不变；MySQL 中保存初学者、15 分钟、案例式和自动互动等确定性默认值，所有缺省字段来源为 `default`，刷新后这些值不改变。

### 场景 G-2：描述已经包含教学要求（v0.4）

**Given** 用户填写“面向大一零基础学生，用 15 分钟讲清 TCP 拥塞控制，学完能够解释慢启动与拥塞避免的切换条件，并包含一个对比案例”且不展开高级设置<br>
**When** 系统执行 `outline.v2`<br>
**Then** audience、learnerLevel、durationMinutes、learningGoal 和附加案例要求来自 `prompt`，未出现的字段使用 `default`；字段解析与大纲生成在同一次正常模型调用中完成。

### 场景 G-3：描述与高级设置冲突（v0.4）

**Given** 原始描述写“面向零基础学习者”，但用户在高级设置中选择 advanced<br>
**When** 系统解析并保存大纲<br>
**Then** learnerLevel 最终为 advanced、来源为 `explicit_setting`，同时保存并展示 `SETTING_PROMPT_CONFLICT`；用户确认前修改 Brief 时旧大纲失效。

### 场景 G-4：只读画布生成与恢复（M8）

**Given** DeepSeek 已按裁剪后的 OpenMAIC Prompt 返回带坐标的 `text/shape/line/code` 元素<br>
**When** 服务端规范化、装配并保存场景，用户在 `1280×720` 课堂中打开并刷新页面<br>
**Then** MySQL 中保存带服务端 id 的 `Slide/PPTElement`，只读 SlideCanvas 恢复同一页面；不支持或损坏的单个元素不会导致课堂白屏，主要内容在桌面视口中可见。

### 场景 H：互动脚本异常（v0.4）

**Given** 互动 HTML 尝试读取父页面 DOM 或抛出未处理异常<br>
**When** 课堂加载该场景<br>
**Then** CSP/sandbox 阻止越界能力，主页面显示 fallback 与错误状态，其他场景仍可播放，用户可以跳过或重新加载同一 HTML。

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
| 质量上下文与 outline v2 | FR-Q101～117 | M7.1 |
| PPT 式只读幻灯片画布 | FR-Q201～211 | M8 |
| 受控互动场景 | FR-I101～110、NFR-SEC-08～10 | M9 |
| 单场景再生成与质量验收 | FR-Q301～307 | M10 |
| PPT 式幻灯片编辑器 | FR-X101～102、106 | M11（可选） |
| PPTX + interactive HTML 简化资源包 | FR-X103～106 | M12（可选） |
| 单一可度量研究问题 | 从 M7～M10 数据中另行立项 | MX |

当需求编号或范围发生变化时，必须同步更新 [01-scope.md](01-scope.md)、[03-architecture.md](03-architecture.md)、[06-roadmap.md](06-roadmap.md) 和 [09-v0.4-quality-and-interaction-plan.md](09-v0.4-quality-and-interaction-plan.md)。
