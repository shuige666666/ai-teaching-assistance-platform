# 05. AI 生成管线设计

> 文档版本：0.4
> 前置文档：[03-architecture.md](03-architecture.md)、[04-domain-model.md](04-domain-model.md)  
> 核心原则：模型输出先经过不可信边界，再进入领域装配和持久化。

> 实现状态（2026-09-01）：outline.v2.3、scene-slide.v2.1、scene-quiz.v2 与 scene-diagram/simulation/game/code.v2.3 已接入正式路径。quiz 支持单选和多选，答案统一为索引/ID 数组并采用完全匹配判分；人工编辑题目不调用模型。

## 1. 设计结论

v0.3 使用两层结构化生成：

```text
第一层：topic → CourseOutlineDTO
第二层：一个 SceneOutline + 紧凑课程上下文 → GeneratedSceneDTO
```

第二层按场景串行执行。模型生成可见内容和 narration，程序负责生成所有 id、引用、状态、时间戳和 Action。v0.4 保留两层与串行恢复边界：M7 把第一层扩展为 `原始 topic + provisional Brief → detectedBrief + CourseOutlineDTO`，resolved Brief 由服务端确定计算；M8 裁剪 OpenMAIC 的 slide Prompt，让模型直接返回带坐标的有限 PPTElement，再轻量规范化并组装 Slide；M9 增加 interactive 类型；M10 复用同一管线生成单场景候选。不改成 Agent 图或无限评审循环。

## 2. 与 OpenMAIC 的对应关系

OpenMAIC 的浏览器链路为：

```text
scene-outlines-stream
  → scene-content
  → scene-actions
  → optional TTS
  → incremental persistence
```

它还支持按场景类型路由模型、流式大纲、材料视觉输入、Web 搜索、角色生成、媒体生成和失败恢复。MVP 的对应裁剪是：

| OpenMAIC | 本项目 MVP |
|---|---|
| SSE 流式大纲 | 普通 JSON 响应，先保证结构正确 |
| content 与 actions 两次模型调用 | 一次生成 content + narration，程序装配 Action |
| 四类 Scene | slide、quiz |
| 按阶段/类型模型路由 | MVP 固定 DeepSeek；一次运行固定一个 Provider/模型 |
| 多种 JSON 修复策略 | 精确解析 + 代码围栏提取 + 一次模型修复 |
| 默认最多多次传输重试 | 有类型分类、总调用硬上限 |
| 首场景完成即自动切入课堂 | MVP 串行生成；全部完成才标记正式 ready，已有成功场景可手动部分预览 |
| 图片、视频、云 TTS | 不进入生成管线 |

v0.4 只追加 OpenMAIC 中最接近当前质量问题的四点：更完整的教学要求、专用场景 Prompt、PPT 式只读幻灯片，以及按教学目的选择的 diagram/simulation/game/code 互动页面。新生成的 slide 不再并行产生类 Markdown/纵向讲义版本。媒体、多智能体、3D/procedural-skill 和直接幻灯片编辑仍不复刻。

M8 不只参考 Prompt 文案，而是裁剪一条完整纵向链：[`slide-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/system.md) 与 [`user.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/slide-content/user.md) 约束直接坐标输出，[`pipeline-types.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/pipeline-types.ts) 定义模型响应，[`scene-generator.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-generator.ts) 解析并处理元素，[`normalize.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/dsl/src/normalize.ts) 补默认值，[`scene-builder.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/scene-builder.ts) 装配 Slide。项目保留自己的 AIAdapter、调用预算、MySQL 和错误恢复，只裁出 `text/shape/line/code` 并增加 text 白名单净化。

M9 同样裁剪 [`diagram-content/system.md`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/templates/diagram-content/system.md)、[`interactive-post-processor.ts`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/packages/%40openmaic/generation/src/interactive-post-processor.ts)、[`interactive-renderer.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/interactive-renderer.tsx) 和 [`InteractiveIframeHost.tsx`](https://github.com/THU-MAIC/OpenMAIC/blob/59adbef03b63488a7ff1ea983cf0fbba51609f9f/components/scene-renderers/InteractiveIframeHost.tsx)。直接复用源码或 Prompt 时记录固定提交、保留 MIT 许可，并写清本项目的裁剪与修改。

后续若要研究“动作生成质量”，可以把 Action 生成重新拆成第三阶段，而不改变前两阶段与 CourseRepository。

## 3. 管线总览

```mermaid
flowchart TD
    Input["MySQL 中的 Course + expectedRevision"] --> RequestGate["请求与课程状态校验"]
    RequestGate --> OutlinePrompt["构造版本化大纲 Prompt"]
    OutlinePrompt --> Adapter["AI Adapter: mock / remote"]
    Adapter --> Raw["原始文本"]
    Raw --> Parse["JSON 提取与解析"]
    Parse --> OutlineSchema["Zod 结构校验"]
    OutlineSchema --> OutlineGate["课程级语义门"]
    OutlineGate --> AssembleOutline["装配 outline id 与顺序"]
    AssembleOutline --> SaveOutline["事务保存 outline_ready"]
    SaveOutline --> Review["用户审核并确认"]

    Review --> Loop{"逐个 SceneOutline"}
    Loop --> ScenePrompt["构造场景 Prompt"]
    ScenePrompt --> Adapter
    Adapter --> ParseScene["解析 + 判别联合校验"]
    ParseScene --> SceneGate["内容语义门"]
    SceneGate --> AssembleScene["装配实体、Action、时间戳"]
    AssembleScene --> Save["事务增量保存 Course"]
    Save --> Loop
    Loop --> Ready["Course ready / partial_failed"]

    Parse -.非法.-> Repair["一次格式修复"]
    OutlineSchema -.非法.-> Repair
    ParseScene -.非法.-> Repair
    SceneGate -.非法.-> Repair
    Repair --> Adapter
```

### 3.1 v0.4 增量管线（M8/M9 已接入）

```mermaid
flowchart TD
    Draft["MySQL: 原始 topic + provisional Brief"] --> OutlineV2["outline.v2.1<br/>一次返回解析结果与大纲"]
    OutlineV2 --> BriefResolver["服务端复算<br/>设置 > Prompt > 默认值"]
    BriefResolver --> OutlineGate["Brief/Outline Schema + 一致性门"]
    OutlineGate --> PersistOutline["同事务保存 resolved Brief + Resolution + Outline"]
    PersistOutline --> Review["用户审核"]
    Review --> Route{"Scene type"}

    Route -->|slide| SlideV2["scene-slide.v2<br/>adapted OpenMAIC prompt"]
    Route -->|quiz| QuizV2["scene-quiz.v2"]
    Route -->|interactive| DiagramV1["scene-interactive.v2"]

    Memory["covered / remaining / bounded summaries"] --> SlideV2
    Memory --> QuizV1
    Memory --> DiagramV1

    SlideV2 --> SlideSchema["GeneratedSlideData Schema"]
    SlideSchema --> Normalize["filter + defaults + sanitize + ids"]
    Normalize --> BuildSlide["assemble Slide / content.canvas"]
    BuildSlide --> SceneGate["assemble Scene"]
    QuizV1 --> SceneGate
    DiagramV1 --> HtmlGate["HTML parse + safety + runtime contract"]
    HtmlGate --> SceneGate
    SceneGate --> Persist["assemble + expectedRevision transaction"]

    SlideSchema -.invalid.-> RepairOnce["type-specific repair once"]
    Normalize -.no visible elements.-> RepairOnce
    SceneGate -.invalid.-> RepairOnce
    HtmlGate -.invalid.-> RepairOnce
    RepairOnce --> Route
```

互动运行错误不会触发浏览器内自动模型循环。用户看到 fallback 后可以重载同一份已保存 HTML 或跳过，不调用模型；生成失败仍在大纲页显式重试；这样费用、revision 和恢复证据仍可追踪。

生成校验不执行浏览器 JavaScript，`ready` 不等于玩法已验证。ResizeObserver 通知已在真实课程复现持续撑高，因此与未处理异常一样降级并卸载 iframe。ERROR 可带 filename/line/column；桥接缓存首个错误，在宿主 PING 时重放，避免漏掉初始化异常。历史桥接发来的 WARNING 仍可解析，但同样降级；新桥接不再发 WARNING，不改课程 Schema。仅更新宿主不会修补已保存 HTML；替换必须由用户显式点击再生成。

`layout-templates.ts` 仅提供生成参考，不在服务器强制套版：Canvas 由独立定位容器确定尺寸，只在 contentRect/像素比变化时更新缓冲区；render 不写尺寸。模拟/游戏示例明确数值转换、开始去重、正常失败留在页内、重置恢复默认参数，不额外增加模型调用或运行时自动修复。

## 4. AI Adapter

### 4.1 接口

```ts
export interface GenerateTextInput {
  requestId: string;
  stage: 'outline' | 'scene' | 'repair';
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
  maxOutputTokens: number;
}

export interface GenerateTextResult {
  text: string;
  provider: 'mock' | 'deepseek' | 'bailian';
  model: string;
  finishReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AIAdapter {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}
```

GenerationService 只依赖 AIAdapter，不导入具体 Provider SDK。实现包括：

- `MockAIAdapter`：读取确定性 fixture，不访问网络；
- `OpenAICompatibleAdapter`：只在服务端加载，接收经过校验的 ProviderConfig；
- `ProviderConfigResolver`：MVP 正式解析 DeepSeek 配置，同时保留可选百炼兼容档。

### 4.2 环境配置

```env
AI_MODE=mock
# MVP 的 AI_MODE=remote 使用 DeepSeek
AI_PROVIDER=deepseek

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash

```

远端模型名和服务地址可能变化，因此必须保持为环境配置而不是写死在业务代码中。MVP 只要求 DeepSeek 配置有效；`.env.example` 中保留的百炼变量仅用于未来确有第二 Provider 需求时的兼容扩展。

配置依据以官方文档为准：[DeepSeek API 快速开始](https://api-docs.deepseek.com/quick_start/pricing-details-cny/)。

启动时只校验当前激活配置档。remote 模式缺少 Key、Base URL 或 Model 时返回 `AI_NOT_CONFIGURED`，不等到用户点击后才抛出模糊错误。切换 Provider 需要修改服务端环境并重启，MVP 不允许浏览器按请求切换。

### 4.3 服务端边界

- AI Adapter 文件使用 `server-only` 或等价约束；
- Route Handler 不接受客户端传入 Key、Base URL 或任意模型名；
- 客户端不能按请求覆盖系统 Prompt；
- 每次调用都有 AbortSignal 和超时；
- SDK 自带重试关闭或纳入统一策略，避免双重重试失控。
- JSON mode 只作为 Provider capability 使用，解析和 Zod 校验永远不能省略。

## 5. 大纲生成接口

### 5.1 请求

`POST /api/courses/{courseId}/outline/generate`

```json
{
  "expectedRevision": 0
}
```

请求约束：

- Content-Type 必须为 JSON；
- courseId 来自 URL，服务端必须从 MySQL 加载 Course；
- expectedRevision 必须等于数据库当前 revision；
- Course 必须处于 draft、failed 或允许重新生成大纲的状态；
- topic 和 sceneCount 只使用数据库中的已校验值，客户端不能在此接口临时覆盖；
- 请求体设置大小上限；
- Route Handler 为请求分配 requestId。

### 5.2 成功响应

成功响应为 `ApiSuccess<CourseResponseDTO>`，其中 data.course 是已经提交到 MySQL 的完整 outline_ready Course，revision 已递增，outlineGeneration 保存实际 Provider、模型、promptVersion、requestId、token usage 和耗时。模型成功但事务失败时不得返回成功。

### 5.3 模型输出

模型输出不包含 id：

```json
{
  "courseTitle": "从网络拥塞到 TCP 拥塞控制",
  "outlines": [
    {
      "type": "slide",
      "title": "拥塞是怎样发生的",
      "teachingObjective": "理解发送速率与网络承载能力的关系",
      "keyPoints": ["队列积压", "时延上升", "丢包"],
      "order": 1,
      "estimatedMinutes": 4
    },
    {
      "type": "slide",
      "title": "拥塞窗口如何调节发送速率",
      "teachingObjective": "理解拥塞窗口对在途数据量的限制",
      "keyPoints": ["拥塞窗口", "发送速率", "反馈调节"],
      "order": 2,
      "estimatedMinutes": 5
    },
    {
      "type": "quiz",
      "title": "拥塞控制理解检查",
      "teachingObjective": "检查对拥塞现象和窗口调节的理解",
      "keyPoints": ["排队现象", "窗口变化"],
      "order": 3,
      "estimatedMinutes": 3
    }
  ]
}
```

### 5.4 大纲语义门

Zod 通过后继续检查：

- 大纲数量恰好等于 sceneCount；
- order 可重新排序但不能缺失内容；
- 只有 slide、quiz；
- 第一场景不是 quiz；
- 至少一个 quiz，最多两个 quiz；
- 标题不可重复；
- teachingObjective 不能全部相同；
- keyPoints 去重后仍满足数量下限；
- courseTitle 不是空白或原始 Prompt 模板片段。

可以确定性修正的内容，如首尾空白、顺序重新编号和重复 keyPoint，直接标准化；会改变教学意图的问题必须判失败或进入修复调用。

## 6. 场景生成接口

### 6.1 请求

`POST /api/courses/{courseId}/scenes/{outlineId}/generate`

```json
{
  "expectedRevision": 4
}
```

courseId 和 outlineId 来自 URL。服务端从 MySQL 加载完整 Course，验证 outline 属于该课程且状态为 pending/failed，再在内部构造 coursePlan 和 previousSummary。客户端不能提交另一份 outline、课程标题或前页摘要来覆盖数据库事实。

coursePlan 只取大纲标题和类型；previousSummary 最多取数据库中前一 ready 场景的短摘要，不累计整门课程，防止上下文无限增长。

### 6.2 slide 模型输出

```json
{
  "type": "slide",
  "title": "拥塞是怎样发生的",
  "content": {
    "subtitle": "当输入长期超过输出能力",
    "blocks": [
      {
        "type": "bullet_list",
        "items": ["路由器队列逐渐增长", "排队时延升高", "缓冲区满后发生丢包"]
      },
      {
        "type": "callout",
        "tone": "example",
        "title": "直觉类比",
        "text": "入口车辆持续多于出口通行能力时，排队会越来越长。"
      },
      {
        "type": "code",
        "language": "text",
        "caption": "发送端控制逻辑示意",
        "code": "if congestion_detected:\n  reduce_congestion_window()"
      }
    ]
  },
  "narration": "先把网络想象成一段有入口和出口的道路……",
  "summary": "网络拥塞源于输入速率长期超过可用转发能力。"
}
```

### 6.3 quiz 模型输出

```json
{
  "type": "quiz",
  "title": "理解检查",
  "content": {
    "questions": [
      {
        "type": "single_choice",
        "prompt": "当输入速率长期超过链路输出能力时，最先出现的趋势是什么？",
        "options": [
          { "label": "队列长度增加" },
          { "label": "往返时延立即归零" },
          { "label": "带宽自动无限增大" }
        ],
        "correctOptionIndexes": [0],
        "explanation": "多余数据首先在缓冲区排队，随后才可能因缓冲区耗尽而丢包。"
      }
    ]
  },
  "narration": "下面用一道题检查你是否理解拥塞形成过程。",
  "summary": "检查学习者对排队、时延和丢包先后关系的理解。"
}
```

模型输出统一使用 `correctOptionIndexes`：单选题数组长度为 1，多选题至少为 2。装配器生成 option id 后把下标转换为 `correctOptionIds`；重复或越界索引必须失败。

### 6.4 场景语义门

共同检查：

- 输出 type 必须等于请求 outline.type；
- title 与大纲主题一致，允许措辞调整但不能为空；
- narration 非空且长度受限；
- summary 非空且长度受限；
- 可见内容不能为空；
- 除 `slide.code.code` 的只读源码外，输出普通文本不包含 HTML/script、外部 URL 或未定义字段。

slide 检查：

- blocks 为 1～5 个；
- 总字符量不超过页面上限；
- 至少覆盖大纲关键点中的大部分，MVP 可以用规范化关键词命中率作弱门；
- 不允许连续多个完全相同 Block。
- code block 的 language、code、caption 满足长度约束；`code` 可包含 HTML/JSX/TSX 教学源码，但只按文本转义，不允许产生外部脚本加载或任何执行路径。

quiz 检查：

- 1～3 题；
- 选项 2～4 个且规范化后不重复；
- correctOptionIndexes 不重复且在范围内；单选恰好 1 项，多选至少 2 项；
- explanation 非空；
- 不出现“以上都对”但答案与其他选项矛盾等可机械发现的问题。

关键词门只能检查形式覆盖，不能宣称事实正确。

## 7. Prompt 设计

Prompt 分为版本化 System Prompt 和 User Prompt：

```text
prompts/
├─ outline.v1.ts
├─ scene-slide.v1.ts
├─ scene-quiz.v2.ts
└─ repair.v1.ts
```

System Prompt 负责角色、硬约束、允许字段和输出格式；User Prompt 只承载本次主题和上下文。模板导出 `PROMPT_VERSION`，日志记录版本，方便以后比较实验。

Prompt 要求：

- 明确“只返回一个 JSON 对象，不要 Markdown”；
- 给出完整但最小的 JSON 示例；
- 明确字段长度、数量和枚举；
- 明确不要生成 id、Action、可执行 HTML、链接和额外字段；只读 HTML/JSX/TSX 示例只能放在 `slide.code.code`；
- quiz 明确 correctOptionIndexes 的单选/多选语义；
- 不把 Zod Schema 原样无限展开到 Prompt，可维护一份紧凑格式说明；
- 不能依赖“模型应该懂”来代替运行时校验。

### 7.1 Prompt v2 设计（M8/M9 当前实现）

v2 不覆盖 v1 文件，而是新增并保留版本元数据：

```text
prompts/
├─ outline.v2.ts
├─ scene-slide.v2.ts
├─ scene-quiz.v2.ts
├─ scene-interactive.v2.ts
├─ scene-regenerate.v1.ts
└─ repair-interactive.v1.ts
```

所有 v2 User Prompt 都从 MySQL Course 构造，至少包含：

- 作为不可信数据传入的原始 topic；
- 已校验的显式高级设置、确定性默认值、字段合并优先级，以及当前 provisional/resolved CourseBrief；
- 完整但紧凑的课程计划和目标；
- 当前 SceneOutline 的 role、objective、keyPoints、misconceptions/assessmentFocus；
- 有上限的 `coveredKeyPoints`、`remainingObjectives` 和前文摘要；
- 当前场景的可见内容密度、允许类型和禁止字段。

`outline.v2.1` 的输出契约使用以下包裹层：

```ts
export interface OutlineGenerationV2DTO {
  detectedBrief: Partial<CourseBrief>;
  warnings: BriefResolutionWarning[];
  outlines: SceneOutlineV2[];
}
```

模型只能把原始描述中明确出现的内容放入 `detectedBrief`，不能按主题难度猜测受众或偏好；Prompt 要求模型在内部按 `explicit_setting > prompt > default` 理解最终要求并据此设计 outlines，但不再回传一份冗余 resolved Brief。服务端使用显式设置、detectedBrief 和默认值独占计算最终 Brief；检测字段越界或大纲数量/角色非法时进入大纲失败/受限 repair。

正常路径仍只有一次 `outline.v2.3` 上游调用，不先调用一个“Prompt 解析模型”再调用一个“大纲模型”。若结构或语义失败，repair 与传输重试继续共享单请求最多四次上游调用预算，但主要目标是通过完整 JSON 骨架、枚举说明和确定性归一实现首次成功。校验通过后，resolved Brief、字段来源、合并后的警告和 outlines 使用一个 expectedRevision 短事务落库；后续 `scene-*.v2` 只读取这个已保存版本。

`outline.v2.1` 单次上游调用的 `maxOutputTokens` 为 8,000，大纲业务超时默认 120 秒。旧版 2,000 和过渡期 6,000 都曾在 DeepSeek 推理阶段耗尽并返回 `empty_content + finish_reason=length`；8,000 + 120 秒的 6 主题真实测试全部以一次上游调用完成。M8 slide 同样使用 8,000，quiz 保持 3,500。

`deepseek-v4-flash` 当前默认启用 high thinking，而 `max_tokens` 同时约束隐藏推理和最终 JSON。M8 首轮实测在 8,000/12,000 下都曾把预算耗尽并返回空或截断 content，因此适配器只对 `stage=scene` 的 DeepSeek 请求显式发送 `thinking.disabled`；outline 与 repair 保持默认推理。分阶段策略使三个代表主题的首个 slide 均一次调用成功、0 repair、约 8.0～10.8 秒完成，而不会回退 M7.1 的大纲规划能力。

原始 topic 在 User Prompt 中使用清晰的数据边界和 JSON 转义传入。描述中即使包含“忽略此前规则”等文本，也只是课程需求数据，不能改变 System Prompt、字段优先级、输出 Schema、安全门或调用预算。Prompt 边界降低误遵循风险，严格解析、服务端复算和领域校验才是最终约束。

大纲内容应先围绕 resolved learningGoal 安排 hook、概念/机制、案例或练习和评估，但不能把固定版式强加给所有主题。`scene-slide.v2` 由 OpenMAIC `slide-content` Prompt 裁剪而来，明确“页面是视觉提示，不是讲稿”，细节进入 narration；模型返回完整 `{type, content, narration, summary}` 外壳，其中 content 只有背景和带坐标的 `text/shape/line/code`。服务端过滤、补默认值、净化文本、分配 id 并装配 Slide；quiz.v1 继续生成可机械验证的答案与解析。

互动按 widgetType 分流 Prompt，直接输出 HTML 而不是转义到 JSON 字符串；适配器不发送 JSON response_format。head 中 scene-meta 保存 narration/summary/fallback，缺省时从大纲取得纯文本替代内容。服务端提取元数据、检查完整文档与 256 KiB 大小、注入 CSP/InteractiveRuntime，再装配 Scene。允许 CDN，保留无同源 iframe 隔离；Prompt 不是安全证明。code 使用可终止 Worker 执行 Python/JavaScript。`scene-interactive.v2` 还会从 `lib/interactive/layout-templates.ts` 注入三种可改写布局骨架及 SVG/Canvas/reset 示例，并要求新脚本以课堂 16:9 单屏可见为首要约束，避免 `100vh` 和未约束高度把完成控件推出视口；课堂展示层固定最大 16:9 视口，独立 HTML 仍按自身 CSS 自适应。详细边界以 docs/09 第6节为准。

## 8. 解析与修复

### 8.1 解析顺序

1. 对原始 text 执行 `trim`；
2. 首先尝试精确 `JSON.parse`；
3. 若失败，只尝试提取一个完整的 ```json` 代码块或首个平衡 JSON 对象；
4. 对解析值执行严格 Zod `.strict()`；
5. 执行领域语义门；
6. 通过后才装配实体。

MVP 不进行大量正则替换和猜测性字段补全。过度“修好”JSON 可能把原本不可判定的内容悄悄变成错误课程。

### 8.2 一次模型修复

解析、Schema 或语义门失败时，可以调用一次 repair Prompt：

```text
给定：
- 原任务的紧凑约束
- 校验错误的字段路径和原因
- 有长度上限的原始输出

要求：
- 只修复格式与违反的约束
- 不改变未报错的教学内容
- 只返回完整 JSON
```

修复结果重新走完整解析和校验。仍失败则返回 `INVALID_MODEL_OUTPUT`，不继续循环。

## 9. 重试、预算与超时

### 9.1 自动重试分类

| 类型 | 示例 | 自动重试 |
|---|---|---|
| 配置/认证 | 400、401、403、422、缺少配置 | 否 |
| 限流/临时上游 | 408、429、5xx | 最多 2 次 |
| 网络 | timeout、连接重置、DNS 临时失败 | 最多 2 次 |
| 用户取消 | AbortError | 否，立即终止 |
| 2xx 响应不可用 | 空体、非 JSON、异常 envelope、空 content | 最多 2 次 |
| 输出不合法 | JSON/Schema/语义门失败 | 仅 1 次 repair |
| 内部编程错误 | 未知异常 | 否，记录并返回内部错误 |

退避采用 `baseDelay * 2^attempt + jitter`，同时尊重 AbortSignal。Adapter 对 2xx 响应先读取文本，再区分 `empty_body`、`invalid_json`、`invalid_envelope` 和 `empty_content`；这些内部诊断只进入脱敏结构化日志，对外仍使用稳定的 `AI_UPSTREAM_ERROR`。Adapter 只分类，outline/scene pipeline 是唯一的自动重试和预算决策者。

### 9.2 调用硬上限

一门课程最多 8 个场景，正常调用数量为：

```text
1 次 outline + N 次 scene，N ∈ [4,8]
正常总数 = 5～9 次
```

一次自动运行只允许 1 个 outline 请求和 N 个 scene 请求，因此业务请求上限为 `1 + sceneCount`，最多 9 个。单个 API 请求最多 4 次上游调用，初次调用、网络重试和 repair 共享；耗尽返回 `GENERATION_BUDGET_EXHAUSTED`。一次自动运行的理论硬上限为 36，正常值为 5～9；M9 不增加新的 repair 循环。

每个 Route Handler 独立限制本请求，数据库中的 Course 状态、activeOperation 和 revision 保证同一个 pending outline 在一次自动运行中只提交一次。手动重试是用户明确触发的新请求，仍受单请求上限控制；Course.sceneProgress.attempts 持续累计。响应和持久化 GenerationMetadata 都记录 upstreamCalls，不能只用 HTTP 请求数估算模型成本。

M6.5 日志事件 `ai.upstream.retrying` / `ai.upstream.rejected` 记录 `requestId`、stage、upstreamAttempt、willRetry、retryDelayMs、providerStatus、responseKind、contentType、responseBytes 和 finishReason。日志不记录 Prompt、主题、API Key、数据库 URL 或原始模型响应。

`outline.v2.1` 进一步补充 `ai.upstream.succeeded`、`outline.validation.failed` 和 `outline.repair.failed`。成功调用记录 attempt、finishReason 与 token usage；校验日志用 `json/schema/semantic` 区分失败阶段，并只保留问题路径、固定校验消息和总数。最终 `outline.generate.failed` 同步输出 code、retryable、upstreamCalls、validationKind 与最多 5 条 issues。失败 API、MySQL `lastError.details` 和生成页使用同一组脱敏字段，因此刷新后仍可按 requestId 追溯；任何路径都不保存 Prompt、模型原文、cause、Key 或连接信息。

建议超时：

- outline：90 秒；
- scene：120 秒；
- repair：60 秒；
- 客户端离开页面：立即 abort。

超时值必须可配置并有默认值，不能在多个组件散落魔法数字。

## 10. 统一 API 响应

成功：

```ts
interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: {
    requestId: string;
    provider: 'mock' | 'deepseek' | 'bailian';
    model: string;
    attempts: number;
    upstreamCalls: number;
    repaired: boolean;
    durationMs: number;
  };
}
```

失败：

```ts
interface ApiFailure {
  success: false;
  error: {
    code:
      | 'INVALID_REQUEST'
      | 'COURSE_NOT_FOUND'
      | 'INVALID_COURSE_STATE'
      | 'COURSE_CONFLICT'
      | 'DATABASE_UNAVAILABLE'
      | 'AI_NOT_CONFIGURED'
      | 'AI_AUTH_FAILED'
      | 'AI_RATE_LIMITED'
      | 'AI_TIMEOUT'
      | 'AI_UPSTREAM_ERROR'
      | 'INVALID_MODEL_OUTPUT'
      | 'GENERATION_BUDGET_EXHAUSTED'
      | 'INTERNAL_ERROR';
    message: string;
    retryable: boolean;
    requestId: string;
    upstreamCalls: number;
    issues?: Array<{ path: string; message: string }>;
  };
}
```

生产响应不返回完整原始模型文本。开发模式若需诊断，将截断后的响应写入受控服务端日志，不传给浏览器。

## 11. 客户端生成编排

```ts
async function generateCourse(courseId: string, signal: AbortSignal) {
  // 1. 从 Course API 加载 MySQL 中的最新聚合与 revision。
  // 2. 请求大纲 API；服务端生成、校验并事务保存，随后等待用户确认。
  // 3. 逐个请求 pending/failed 场景；每次都携带上次响应的 revision。
  // 4. 每次响应替换客户端 CourseDTO；冲突时停止并重新加载。
}
```

关键规则：

- 客户端不直接修改持久化状态；服务端在模型调用前登记 activeOperation；
- 成功响应再次用共享 Schema 校验，不能盲目信任本项目自己的 API；
- API 只有在 MySQL 提交成功后才返回成功 CourseDTO；
- 刷新时先重新读取数据库；只有超过 expiresAt 的遗留操作才能恢复；
- 重试只选择指定 outlineId；
- 生成中不允许同一 outline 发起第二个请求；
- 一次自动运行最多提交 `1 + sceneCount` 个业务请求，失败后的再次提交必须由用户明确触发；
- 串行完成前不引入并发设置。

## 12. Mock 模式

Mock 是第一个里程碑的主数据源，至少准备：

```text
tests/fixtures/
├─ outline.valid.json
├─ scene-slide.valid.json
├─ scene-quiz.valid.json
├─ outline.invalid.json
└─ scene.invalid.json
```

MockAIAdapter 根据 stage 和 outline.type 返回固定响应，并可通过测试注入错误。它必须经过和 remote 相同的 parse、Zod、语义门、装配器和 MySQL 事务链路，避免出现“mock 能跑、真实链路是另一套代码”。

## 13. 可观测性

每次上游调用记录聚合字段：

- requestId、courseId 的不可逆短哈希；
- stage：outline、scene 或 repair；
- outlineId（若有）；
- provider、model、promptVersion；
- attempt、repaired、finishReason；
- durationMs；
- input/output token usage（Provider 返回时）；
- parsePassed、schemaPassed、semanticGatePassed；
- errorCode。

禁止记录 API Key。默认不记录完整主题、Prompt、模型响应和讲解正文。面向论文的实验报告保存汇总数据和明确授权的测试用例，不保存真实用户隐私。

## 14. 质量门与测试

### 14.1 在线确定性门

- 请求 Schema；
- JSON 解析；
- 模型 DTO Schema；
- 领域不变量；
- 类型与 content 匹配；
- quiz 答案索引；
- 文本长度和数组数量；
- slide 元素类型、关键字段、有限坐标/正尺寸、text 净化、代码文本边界和空页；
- 不允许字段与危险内容；
- 调用预算、超时和重试分类。

### 14.2 离线测试

- Prompt golden test：关键规则和 JSON 示例未丢失；
- parser test：纯 JSON、代码围栏、截断和多对象；
- Schema test：每个字段边界；
- semantic gate test：重复标题、slide 全空、缺少 quiz、索引越界；
- slide test：四类元素 fixture、默认值、未支持元素过滤、非有限数字、负尺寸、富文本净化和 Renderer fallback；
- retry test：429/5xx 重试，401 不重试，Abort 立即停止；
- assembler test：模型无法控制 id，type/content 绑定正确；
- fixture contract test：所有 valid fixture 永远通过；
- API integration test：mock adapter 下响应结构和错误码；
- E2E：mock 模式完整课程生成。

### 14.3 明确不保证

Schema 通过只表示“数据形状合法且满足可机械检查的规则”，不表示：

- 陈述事实一定正确；
- 教学顺序一定最优；
- 解释一定适合所有学习者；
- 测验答案在现实学科中没有争议；
- 内容不存在模型偏见。

M7 必须建立小型固定人工评价集，M8/M10 使用同一冻结协议判断产品质量是否改善；若 MX 选择内容质量作为论文问题，再扩大样本、重复生成并补充一致性分析。LLM-as-judge 只能作为辅助信号，并报告 Judge 自身局限。

### 14.4 M8 视觉检查（计划）

在线链路只拒绝确定的结构问题：JSON/Schema 失败、未支持元素、非有限坐标、非正尺寸、危险富文本和规范化后空页。标题长短、页面留白、卡片关系、视觉层级和轻微重叠不建立独立在线报告；这些问题先通过 OpenMAIC Prompt 的输出前自检和 3 个 DeepSeek 真实主题的 `1280×720` MHTML 人工检查发现。

如果某类问题在真实样例中反复出现，再补一条小型、可解释的校验或 Prompt 规则，并为该具体回归增加测试。M8 不预先实现通用碰撞算法、自动美学评分或第二次模型评审。

### 14.5 人工成对评价（M10 退出门）

使用同一主题集、Provider、模型、温度和场景数量分别生成 v0.3 与 v0.4 课程，隐藏版本后评价事实正确性、目标匹配、结构连贯、解释/案例价值、可见内容可读性、视觉层级与版式适配和测验对齐。MHTML 使用相同视口；互动页另评教学必要性、控件可理解性、重置和完成反馈。报告同时给出生成完成率、修复率、耗时、token、人工发现的主要版式问题和关键事实错误，禁止只展示改善的维度。

## 15. 再生成与修订管线（M10 ready 场景已接入）

两个入口共享同一替换事务，但模型上下文严格分开：`/regenerate` 只用于运行失败的 ready interactive，接收 `expectedRevision` 和必填错误背景，不发送旧 HTML；`/revise` 接受 ready slide/interactive/quiz，接收 `expectedRevision`、必填 500 字内意见和 quiz 清理确认，并仅发送当前旧场景。interactive 修订参考会先移除平台注入的 Runtime 与 CSP。旧场景和用户输入都按不可信数据处理，不改变大纲、类型和输出契约。服务端流程为：

```text
读取 ready / partial_failed Course 与 ready 场景
  → expectedRevision 短事务登记既有 activeOperation 租约，保留旧 Scene
  → /regenerate 使用 CourseBrief + Outline + 错误背景；/revise 再加入当前旧场景与用户意见
  → 同一解析、装配和最多4次调用/一次repair预算
  → 再次核对 revision、operation id 和取消信号
  → 短事务仅替换本场景；quiz 同事务删除旧 sceneId 作答
  → 返回新 Course，课堂载入新 Scene id
```

本轮沿用既有租约而非新增候选状态表：请求中 Course.status 暂为 generating，目标进度仍 ready、attempts 加一，旧 Scene 始终保留。成功后只替换一个场景并清理租约；失败/取消在仍持有租约时恢复 ready/partial_failed，目标进度保留 ready 并记录 lastError。冲突不覆盖其他写入；进程中断后同场景过期租约可由用户显式重试接管。模型不决定 courseId、outlineId、type、order、状态或 ID。

课堂调度台对所有 ready 场景提供“修订本场”，使用模态面板填写必填的 500 字内意见。quiz 的提交按钮在用户确认清理旧作答前不可用。互动降级区仍区分“重新生成本场互动”和“重新加载原脚本”。生成期间禁止重复提交，但课程仍可浏览；支持取消等待，失败后读取最新 revision 供再次显式重试。取消可能与提交并发，不声称客户端取消能撤销已经成功提交的事务。无浏览器自动重生成、自动运行验收或编辑代理。

M10 剩余范围只有同题配对质量验收；不在此阶段增加编辑器、导出或生成后自动视觉门禁。

## 16. MX 研究接口

M7～M10 不为尚未确定的论文方向预建策略接口。MX 可以从实际数据中选择错误感知修复、质量—成本约束模型路由、教学策略 Prompt 对比或互动运行错误修复中的一个问题，再按该问题增加最小实验代码。实验必须与固定模型、固定 Prompt 版本和明确调用预算的基线比较；LangGraph、多智能体或多模态只有在成为该单一问题的必要变量时才评估。
